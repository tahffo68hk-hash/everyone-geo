/**
 * M6B Competitor Discovery e2e（真实 PostgreSQL geo_test）。
 * 硬保护：setupFiles 已加载 test-env.cjs 强制 geo_test；fixture 全部直连落库，
 * 不调用任何真实 Provider（0 次 DeepSeek 请求）。
 *
 * 覆盖（对照 M6B 测试清单）：
 *   1 mock Evidence excluded / 2 demo excluded（24 Demo Evidence = 0 输入）
 *   3 eligible REAL included（official_api + manual + browser）
 *   4 ProjectMentor 自身排除
 *   5 duplicate normalization / 6 alias merge（ChatGPT + chatgpt 跨证据归并）
 *   7 candidate evidence linkage（GET detail 返回 links）
 *   8 query coverage（queryCount）
 *   9 recommendation count（词法信号）
 *  10 tenant isolation
 *  11 approve / 12 reject / 13 competitorType manual assignment（无类型拒绝）
 *  14 create v1 / 15 active immutable / 16 create v2 / 17 v1 unchanged
 *  18 A/B/C 排除（seed 占位不入候选、不入新分析）
 *  19 Evidence immutable（re-analysis 不改 rawResponse、m4 保留）
 *  20 old/new Analysis coexist（m4-rule-v1 + m6b-competitors-v1）
 *  21 competitorSetVersion recorded（analysis 行记录 set v1/v2）
 *  22 SoV uses explicit set（默认取最新 ACTIVE；?competitorSetId= 显式绑定）
 *  23 Demo/Real isolation（metric 侧由 M6A 覆盖；此处 candidate 输入隔离）
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";
import { M6B_ANALYSIS_VERSION } from "../src/competitors/competitors.service";

describe("Competitor M6B e2e", () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const emailA = `cmp-a-${suffix}@m6e2e.test.com`;
  const emailB = `cmp-b-${suffix}@m6e2e.test.com`;
  const password = "m6b-e2e-pass-123";

  const ids: Record<string, string> = {};
  const candidateIds: Record<string, string> = {};
  const setIds: Record<string, string> = { v1: "", v2: "" };
  const demoEvidenceCount = 24;
  let rejectedCandidateId = "";

  const realEngine = async (key: string) =>
    prisma.engine.create({ data: { key, name: key, provider: "deepseek" } });
  const mockEngine = async (key: string) =>
    prisma.engine.create({ data: { key, name: key, provider: "mock", config: { delayMs: 10 } } });

  /** 建一条独立 MonitorTask + SUCCEEDED run + Evidence（每个证据独立 task，规避
   *  (monitorTaskId, queryId, engineId) 唯一约束；provider/sourceType/rawResponse 可控）。 */
  const mkEvidence = async (args: {
    organizationId: string; projectId: string; queryId: string; engineId: string; provider: string;
    sourceType: string; rawResponse: string; queryText?: string;
  }) => {
    const task = await prisma.monitorTask.create({ data: {
      organizationId: args.organizationId, projectId: args.projectId, totalRuns: 1, status: "SUCCEEDED",
    } });
    const run = await prisma.run.create({ data: {
      monitorTaskId: task.id, queryId: args.queryId, engineId: args.engineId,
      status: "SUCCEEDED", analysisStatus: "SUCCEEDED", executionToken: randomUUID(),
    } });
    const evidence = await prisma.evidence.create({ data: {
      runId: run.id, queryText: args.queryText ?? "fixture-query",
      rawPrompt: "fixture prompt", rawResponse: args.rawResponse,
      provider: args.provider, engineKey: args.engineId, engineName: "Engine",
      model: args.provider === "mock" ? "geolens-mock" : "deepseek-chat",
      modelVersion: "1", retrievalMode: args.sourceType === "official_api" ? "api_plain" : "unknown",
      sourceType: args.sourceType as never, metadata: {}, entitySnapshot: [],
    } });
    // m4 基线分析（真实链路 M4 会产生；用于 old/new coexist 断言）
    await prisma.analysis.create({ data: {
      evidenceId: evidence.id, analysisVersion: "m4-rule-v1", brandMentioned: false,
      mentionPosition: null, recommended: false, sentiment: "unknown",
    } });
    return { run, evidence };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();
    owner = request.agent(http);
    outsider = request.agent(http);

    const register = async (email: string) => {
      const res = await request(http).post("/auth/register").send({ email, name: "Cmp User", password });
      expect(res.status).toBe(201);
      return res.body as { user: { id: string }; organization: { id: string } };
    };
    const a = await register(emailA);
    const b = await register(emailB);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;

    // ---- tenant A：ProjectMentor 项目（自身品牌 + A/B/C legacy 占位）----
    const projectA = await prisma.project.create({ data: {
      organizationId: ids.orgA, name: `Competitor A ${suffix}`, industry: "SaaS",
    } });
    ids.projectA = projectA.id;
    const brand = await prisma.brand.create({ data: {
      projectId: projectA.id, name: "ProjectMentor",
      aliases: ["Project Mentor", "项目导师", "PMentor"],
    } });
    ids.brandA = brand.id;
    for (const name of ["Competitor A", "Competitor B", "Competitor C"]) {
      await prisma.competitor.create({ data: { projectId: projectA.id, name, aliases: [`Comp${name.slice(-1)}`] } });
    }
    const queriesA: string[] = [];
    for (const text of [`q1-cmp ${suffix}`, `q2-cmp ${suffix}`]) {
      const q = await prisma.query.create({ data: { projectId: projectA.id, text } });
      queriesA.push(q.id);
    }

    const mockEng = await mockEngine(`cmp-mock-${suffix}`);
    const realEng = await realEngine(`cmp-ds-${suffix}`);
    ids.mockEngine = mockEng.id;
    ids.realEngine = realEng.id;
    ids.queryA1 = queriesA[0];
    ids.queryA2 = queriesA[1];

    // ---- REAL eligible evidence（唯一会进入 discovery 的输入）----
    // E1：ChatGPT + Claude（推荐 cue）
    await mkEvidence({ organizationId: ids.orgA, projectId: projectA.id, queryId: queriesA[0], engineId: realEng.id, provider: "deepseek", sourceType: "official_api", queryText: `q1-cmp ${suffix}`, rawResponse: "很多人推荐 ChatGPT 和 Claude，Claude 也不错。ProjectMentor 适合团队项目。" });
    // E2：openai chatgpt lowercase + Gemini（跨证据大小写/别名归并）
    await mkEvidence({ organizationId: ids.orgA, projectId: projectA.id, queryId: queriesA[0], engineId: realEng.id, provider: "deepseek", sourceType: "official_api", queryText: `q1-cmp ${suffix}`, rawResponse: "openai chatgpt 的表现与 Gemini 接近，chatgpt 生态更大。" });
    // E3：ChatGPT（比较语境）+ Claude 推荐 + Notion AI + 自身品牌出现（应排除品牌自身）
    await mkEvidence({ organizationId: ids.orgA, projectId: projectA.id, queryId: queriesA[1], engineId: realEng.id, provider: "deepseek", sourceType: "official_api", queryText: `q2-cmp ${suffix}`, rawResponse: "相比 Notion AI，ChatGPT 更适合项目管理，也有人直接推荐 Claude。ProjectMentor 用于内部项目。" });
    // manual + browser 也属 REAL 输入
    await mkEvidence({ organizationId: ids.orgA, projectId: projectA.id, queryId: queriesA[1], engineId: realEng.id, provider: "manual", sourceType: "manual", queryText: `q2-cmp ${suffix}`, rawResponse: "手动核实：ChatGPT 在企业采用率最高。" });
    await mkEvidence({ organizationId: ids.orgA, projectId: projectA.id, queryId: queriesA[0], engineId: realEng.id, provider: "deepseek", sourceType: "browser", queryText: `q1-cmp ${suffix}`, rawResponse: "浏览结果里 Gemini 也常被提到。" });
    // estimated：REAL provider 但 sourceType=estimated → 必须排除
    await mkEvidence({ organizationId: ids.orgA, projectId: projectA.id, queryId: queriesA[1], engineId: realEng.id, provider: "deepseek", sourceType: "estimated", queryText: `q2-cmp ${suffix}`, rawResponse: "估算（不可用）：ChatGPT 占 40%。" });

    // ---- 24 条 Demo（mock）Evidence：绝不进入 discovery ----
    for (let i = 0; i < demoEvidenceCount; i++) {
      await mkEvidence({ organizationId: ids.orgA, projectId: projectA.id, queryId: queriesA[0], engineId: mockEng.id, provider: "mock", sourceType: "mock", queryText: `demo-q ${suffix}`, rawResponse: `DemoBrand${i} 是热门选择。` });
    }

    // ---- tenant B：隔离项目（真实证据提及 Bing）----
    const projectB = await prisma.project.create({ data: {
      organizationId: ids.orgB, name: `Competitor B ${suffix}`,
    } });
    ids.projectB = projectB.id;
    await prisma.brand.create({ data: { projectId: projectB.id, name: "AcmePilot" } });
    const qB = await prisma.query.create({ data: { projectId: projectB.id, text: `q-b ${suffix}` } });
    ids.queryB = qB.id;
    await mkEvidence({ organizationId: ids.orgB, projectId: projectB.id, queryId: qB.id, engineId: realEng.id, provider: "deepseek", sourceType: "official_api", queryText: `q-b ${suffix}`, rawResponse: "Bing Copilot 都可用于搜索。" });

    await owner.post("/auth/login").send({ email: emailA, password }).expect(200);
    await outsider.post("/auth/login").send({ email: emailB, password }).expect(200);
  }, 60000);

  afterAll(async () => {
    if (!ids.orgA) return;
    try {
      // 依赖逆序清理
      await prisma.competitorCandidateEvidence.deleteMany({ where: { candidate: { project: { organizationId: { in: [ids.orgA, ids.orgB] } } } } });
      await prisma.competitorCandidate.deleteMany({ where: { project: { organizationId: { in: [ids.orgA, ids.orgB] } } } });
      await prisma.competitorSetEntry.deleteMany({ where: { competitorSet: { project: { organizationId: { in: [ids.orgA, ids.orgB] } } } } });
      await prisma.competitorSet.deleteMany({ where: { project: { organizationId: { in: [ids.orgA, ids.orgB] } } } });
      await prisma.benchmarkRun.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.monitorTask.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.engine.deleteMany({ where: { id: { in: [ids.mockEngine, ids.realEngine] } } });
      await prisma.project.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
      await prisma.user.deleteMany({ where: { email: { contains: "@m6e2e.test.com" } } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  // ---------- 1/2/3/4/23 demo·mock·estimated 排除 + REAL 纳入 + 自身品牌排除 ----------
  it("Discovery 只消费 REAL Evidence：24 Demo = 0 输入；mock/estimated 全部排除", async () => {
    const { body } = await owner.post(`/projects/${ids.projectA}/competitor-discovery`).expect(201);
    expect(body.scope).toBe("real-evidence-only");
    expect(body.eligibility.realEvidenceEligible).toBe(5); // 3 official_api + manual + browser
    expect(body.eligibility.excludedEvidence["mock/demo"]).toBe(demoEvidenceCount);
    expect(body.eligibility.excludedEvidence.estimated).toBe(1);
    expect(body.outcome.candidatesDiscovered).toBe(4); // chatgpt / claude / gemini / notion

    const candidates = (await owner.get(`/projects/${ids.projectA}/competitor-candidates`).expect(200)).body as Array<Record<string, unknown>>;
    expect(candidates).toHaveLength(4);
    const names = candidates.map(c => String(c.canonicalName));
    expect(names).not.toContain("DemoBrand");
    expect(names).not.toContain("ProjectMentor");          // 4 自身品牌排除
    expect(names).not.toContain("Competitor A");           // 18 A/B/C 不入候选
    expect(names).not.toContain("Competitor B");
    expect(names).not.toContain("Competitor C");
    for (const name of names) {
      expect(candidates.find(c => c.canonicalName === name)).toMatchObject({ status: "DISCOVERED", competitorType: "UNKNOWN" });
    }
    for (const row of candidates) {
      candidateIds[String(row.canonicalName).toLowerCase().replace(/\s+/g, "")] = String(row.id);
    }
  });

  // ---------- 5/6 重复归一化 + 别名归并（ChatGPT + openai chatgpt + chatgpt）----------
  it("ChatGPT 变体（大写/小写/带前缀）跨证据归并为同一候选，aliases 保留变体", async () => {
    const candidates = (await owner.get(`/projects/${ids.projectA}/competitor-candidates`).expect(200)).body as Array<{
      canonicalName: string; aliases: string[]; evidenceCount: number; queryCount: number; mentionCount: number; recommendationCount: number;
    }>;
    const chatgpt = candidates.find(c => c.canonicalName === "ChatGPT");
    expect(chatgpt).toBeTruthy();
    expect(chatgpt?.aliases).toContain("ChatGPT");
    // E1(1 大写) + E2(2 小写 chatgpt) + E3(1 大写) + manual(1) = 5 occurrences
    expect(chatgpt?.mentionCount).toBeGreaterThanOrEqual(5);
    expect(chatgpt?.evidenceCount).toBe(4);   // E1/E2/E3/manual（browser 未提 ChatGPT）
    expect(chatgpt?.queryCount).toBe(2);      // q1 + q2
    expect((chatgpt?.recommendationCount ?? 0)).toBeGreaterThanOrEqual(2); // E1 推荐 + E3 适合 + manual 推荐
    const claude = candidates.find(c => c.canonicalName === "Claude");
    expect(claude?.evidenceCount).toBe(2);
    expect(claude?.queryCount).toBe(2);
  });

  // ---------- 7 linkage / 8 query coverage / 9 recommendation ----------
  it("Candidate 详情：evidence linkage 可追溯到 Evidence/Run/Query 且信号计数一致", async () => {
    const chatgpt = (await owner.get(`/competitor-candidates/${candidateIds.chatgpt}`).expect(200)).body as {
      evidenceLinks: Array<{ evidenceId: string; runId: string; queryText: string; mentionText: string; mentionPosition: number; recommended: boolean }>;
      counts: { evidenceCount: number; queryCount: number; mentionCount: number; recommendationCount: number };
    };
    expect(chatgpt.evidenceLinks).toHaveLength(4);
    for (const link of chatgpt.evidenceLinks) {
      expect(link.evidenceId).toBeTruthy();
      expect(link.runId).toBeTruthy();
      expect(link.queryText).toMatch(/^q[12]-cmp/);
      expect(link.mentionText.toLowerCase()).toContain("chatgpt");
      expect(link.mentionPosition).toBeGreaterThanOrEqual(1);
    }
    // 与行级计数器一致（7 linkage / 8 query coverage / 9 recommendation）
    expect(chatgpt.counts.evidenceCount).toBe(chatgpt.evidenceLinks.length);
    expect(chatgpt.counts.queryCount).toBe(2);
    expect(chatgpt.counts.recommendationCount).toBe(chatgpt.evidenceLinks.filter(l => l.recommended).length);
    expect(chatgpt.counts.recommendationCount).toBeGreaterThanOrEqual(2);
  });

  // ---------- 幂等 refresh ----------
  it("重复 Discovery：幂等 refresh，计数与候选数保持不变（无重复链接）", async () => {
    const { body } = await owner.post(`/projects/${ids.projectA}/competitor-discovery`).expect(201);
    expect(body.outcome.candidatesDiscovered).toBe(0);
    expect(body.outcome.candidatesRefreshed).toBe(4);
    const candidates = (await owner.get(`/projects/${ids.projectA}/competitor-candidates`).expect(200)).body as Array<{ id: string }>;
    expect(candidates).toHaveLength(4);
  });

  // ---------- 10 tenant isolation ----------
  it("跨租户：外租户无法读取/运行/审阅 A 项目候选；B 项目独立", async () => {
    await outsider.get(`/projects/${ids.projectA}/competitor-candidates`).expect(404);
    await outsider.get(`/competitor-candidates/${candidateIds.chatgpt}`).expect(404);
    await outsider.post(`/projects/${ids.projectA}/competitor-discovery`).expect(404);
    await outsider.patch(`/competitor-candidates/${candidateIds.chatgpt}`).send({ status: "REJECTED" }).expect(404);
    await outsider.post(`/projects/${ids.projectA}/competitor-sets`).send({ name: "X", version: "1" }).expect(404);
    // B 项目自己的 discovery 独立
    const { body } = await outsider.post(`/projects/${ids.projectB}/competitor-discovery`).expect(201);
    const names = body.candidates.map((c: { canonicalName: string }) => c.canonicalName);
    expect(names).toContain("Bing Copilot");
    expect(names).not.toContain("ChatGPT");
  });

  // ---------- 11/12/13 人工评审 ----------
  it("Approve 必须显式类型（DIRECT/ADJACENT/SUBSTITUTE）；无类型 → 400", async () => {
    await owner.patch(`/competitor-candidates/${candidateIds.chatgpt}`).send({ status: "APPROVED" }).expect(400);
    await owner.patch(`/competitor-candidates/${candidateIds.chatgpt}`).send({ status: "APPROVED", competitorType: "UNKNOWN" }).expect(400);
    await owner.patch(`/competitor-candidates/${candidateIds.chatgpt}`).send({ status: "APPROVED", competitorType: "DIRECT" }).expect(200);
    const row = (await owner.get(`/competitor-candidates/${candidateIds.chatgpt}`).expect(200)).body;
    expect(row).toMatchObject({ status: "APPROVED", competitorType: "DIRECT" });
  });

  it("Reject → NON_COMPETITOR；REJECTED 候选可重新 Approve（人工可控）", async () => {
    const geminiId = candidateIds.gemini;
    const rejected = (await owner.patch(`/competitor-candidates/${geminiId}`).send({ status: "REJECTED" }).expect(200)).body;
    expect(rejected).toMatchObject({ status: "REJECTED", competitorType: "NON_COMPETITOR" });
    rejectedCandidateId = geminiId;
    // 再次 discovery：REJECTED 候选被跳过（不重建链接），并可作为人工重新批准
    const { body } = await owner.post(`/projects/${ids.projectA}/competitor-discovery`).expect(201);
    expect(body.outcome.candidatesSkippedRejected).toBeGreaterThanOrEqual(1);
    const approvedAgain = (await owner.patch(`/competitor-candidates/${geminiId}`).send({ status: "APPROVED", competitorType: "ADJACENT" }).expect(200)).body;
    expect(approvedAgain).toMatchObject({ status: "APPROVED", competitorType: "ADJACENT" });
  });

  it("人工编辑 canonicalName / aliases + Approve Claude；与既有候选冲突 → 400", async () => {
    const claudeId = candidateIds.claude;
    // 编辑 + Approve 在同一请求完成：v1（默认 = 全部 APPROVED）需要 Claude AI 进入集合
    const edited = (await owner.patch(`/competitor-candidates/${claudeId}`).send({
      status: "APPROVED", competitorType: "SUBSTITUTE",
      canonicalName: "Claude AI", aliases: ["Claude", "Claude AI", "克劳德"],
    }).expect(200)).body;
    expect(edited.canonicalName).toBe("Claude AI");
    expect(edited.aliases).toContain("克劳德");
    expect(edited).toMatchObject({ status: "APPROVED", competitorType: "SUBSTITUTE" });
    await owner.patch(`/competitor-candidates/${candidateIds.notion}`).send({ canonicalName: "ChatGPT" }).expect(400);
  });

  // ---------- 14/15/16/17 版本化 Competitor Set ----------
  it("创建 v1（默认 = 全部 APPROVED）、激活冻结；重复激活/同名同版本 → 拒绝", async () => {
    // 当前 APPROVED：chatgpt(DIRECT)、claude(APPROVED, renamed Claude AI)、gemini(ADJACENT, 已重批准)
    const set = (await owner.post(`/projects/${ids.projectA}/competitor-sets`).send({
      name: "ProjectMentor Competitor Set", version: "1",
    }).expect(201)).body;
    setIds.v1 = set.id;
    expect(set.status).toBe("DRAFT");
    expect(set.entryCount).toBe(3);
    expect(set.entries.map((e: { canonicalName: string }) => e.canonicalName).sort())
      .toEqual(["ChatGPT", "Claude AI", "Gemini"].sort());

    const activated = (await owner.post(`/competitor-sets/${set.id}/activate`).expect(201)).body;
    expect(activated.status).toBe("ACTIVE");
    expect(activated.activatedAt).toBeTruthy();
    // 冻结：不可重复激活；同名同版本不可再建（无修改端点 → 集合不可变）
    await owner.post(`/competitor-sets/${set.id}/activate`).expect(400);
    await owner.post(`/projects/${ids.projectA}/competitor-sets`).send({
      name: "ProjectMentor Competitor Set", version: "1", entries: [{ candidateId: candidateIds.chatgpt }],
    }).expect(400);
  });

  it("激活后 Set 内容冻结：任何后续变更不影响 v1（语义快照）", async () => {
    const v1 = (await owner.get(`/competitor-sets/${setIds.v1}`).expect(200)).body;
    const entriesBefore = JSON.stringify(v1.entries.map((e: { canonicalName: string; competitorType: string }) => [e.canonicalName, e.competitorType]));

    // 模拟未来变更：approve Notion、把 Gemini 改为 DIRECT（对 v1 无影响）
    const notionId = candidateIds.notion;
    await owner.patch(`/competitor-candidates/${notionId}`).send({ status: "APPROVED", competitorType: "SUBSTITUTE" }).expect(200);
    await owner.patch(`/competitor-candidates/${candidateIds.gemini}`).send({ competitorType: "DIRECT" }).expect(200);

    const after = (await owner.get(`/competitor-sets/${setIds.v1}`).expect(200)).body;
    expect(JSON.stringify(after.entries.map((e: { canonicalName: string; competitorType: string }) => [e.canonicalName, e.competitorType])))
      .toBe(entriesBefore);
  });

  it("创建 v2（含 Notion）并激活 → v1 自动归档且内容不变；v1 语义保持冻结", async () => {
    const v2 = (await owner.post(`/projects/${ids.projectA}/competitor-sets`).send({
      name: "ProjectMentor Competitor Set", version: "2",
    }).expect(201)).body;
    setIds.v2 = v2.id;
    expect(v2.entryCount).toBe(4); // ChatGPT / Claude AI / Gemini / Notion

    const activatedV2 = (await owner.post(`/competitor-sets/${v2.id}/activate`).expect(201)).body;
    expect(activatedV2.status).toBe("ACTIVE");

    const v1After = (await owner.get(`/competitor-sets/${setIds.v1}`).expect(200)).body;
    expect(v1After.status).toBe("ARCHIVED"); // 同 name 新版本激活 → 旧版本归档（保留）
    expect(v1After.entryCount).toBe(3);
    expect(v1After.entries.map((e: { canonicalName: string }) => e.canonicalName).sort())
      .toEqual(["ChatGPT", "Claude AI", "Gemini"].sort());
    expect(v1After.entries[0].aliases).toBeDefined();
  });

  // ---------- 19/20/21 re-analysis（m6b-competitors-v1）----------
  it("未激活 Set 不可 re-analysis；Evidence immutable：m4 保留、只增 m6b 分析、不改 rawResponse", async () => {
    // 重建一个 DRAFT 集验证守卫
    const draft = (await owner.post(`/projects/${ids.projectA}/competitor-sets`).send({
      name: "Draft Set", version: "1",
    }).expect(201)).body;
    await owner.post(`/projects/${ids.projectA}/competitor-reanalysis`).send({ competitorSetId: draft.id }).expect(400);

    const evidenceBefore = await prisma.evidence.findFirst({
      where: { queryText: { contains: "q1-cmp" }, sourceType: "official_api", rawResponse: { contains: "ChatGPT" } },
      orderBy: { createdAt: "asc" },
    });
    const rawBefore = evidenceBefore?.rawResponse ?? null;
    const m4CountBefore = evidenceBefore ? await prisma.analysis.count({ where: { evidenceId: evidenceBefore.id, analysisVersion: "m4-rule-v1" } }) : 0;
    expect(m4CountBefore).toBe(1);

    // 用 v1 做 re-analysis（v1 当前 ARCHIVED？激活 v2 时 v1 被归档 → 已冻结不允许 re-analysis？）
    // 规则：Re-analysis 要求 ACTIVE —— v1 已归档 → 应拒绝；先用当前 ACTIVE 的 v2。
    const v1Resp = await owner.post(`/projects/${ids.projectA}/competitor-reanalysis`).send({ competitorSetId: setIds.v1 });
    expect(v1Resp.status).toBe(400);
    expect(String(v1Resp.body.message)).toContain("Activate");

    const re = (await owner.post(`/projects/${ids.projectA}/competitor-reanalysis`).send({ competitorSetId: setIds.v2 }).expect(201)).body;
    expect(re.analysisVersion).toBe(M6B_ANALYSIS_VERSION);
    expect(re.competitorSet.version).toBe("2");
    expect(re.evidenceEligible).toBe(5);
    expect(re.reanalyzed).toBe(5);
    expect(re.skippedExisting).toBe(0);

    // Evidence 未修改
    const evidenceAfter = await prisma.evidence.findUniqueOrThrow({ where: { id: evidenceBefore!.id } });
    expect(evidenceAfter.rawResponse).toBe(rawBefore);
    // m4 与 m6b 并存（20 old/new coexist）
    const versions = await prisma.analysis.findMany({ where: { evidenceId: evidenceBefore!.id }, orderBy: { analysisVersion: "asc" } });
    expect(versions.map(v => v.analysisVersion).sort()).toEqual(["m4-rule-v1", M6B_ANALYSIS_VERSION]);
    const m6bRow = versions.find(v => v.analysisVersion === M6B_ANALYSIS_VERSION)!;
    expect(m6bRow.competitorSetId).toBe(setIds.v2);       // 21 competitorSetVersion recorded
    expect(m6bRow.competitorSetVersion).toBe("2");
  });

  it("重复 re-analysis 幂等：同一 ACTIVE Set 再次运行 → skippedExisting 全部跳过", async () => {
    const re = (await owner.post(`/projects/${ids.projectA}/competitor-reanalysis`).send({ competitorSetId: setIds.v2 }).expect(201)).body;
    expect(re.reanalyzed).toBe(0);
    expect(re.skippedExisting).toBe(5);
    const m6bCount = await prisma.analysis.count({ where: { competitorSetId: setIds.v2, analysisVersion: M6B_ANALYSIS_VERSION } });
    expect(m6bCount).toBe(5);
  });

  // ---------- 22 SoV（显式绑定 Competitor Set version）----------
  it("SoV 必须显式绑定 ACTIVE Set：v1(已归档) → pending；默认取最新 ACTIVE v2 且 ready", async () => {
    // v1 归档后其 m6b 分析已被 v2 re-analysis 替换 → 显式查 v1 应 pending（无该 set 的分析）
    const sovV1 = (await owner.get(`/projects/${ids.projectA}/competitor-sov?competitorSetId=${setIds.v1}`).expect(200)).body;
    expect(sovV1.status).toBe("pending");
    expect(sovV1.reason).toBe("not-reanalyzed");

    // 默认 = 最新 ACTIVE（v2）
    const sov = (await owner.get(`/projects/${ids.projectA}/competitor-sov`).expect(200)).body;
    expect(sov.status).toBe("ready");
    expect(sov.competitorSet.version).toBe("2");
    expect(sov.analysisVersion).toBe(M6B_ANALYSIS_VERSION);
    expect(sov.scope).toBe("real-evidence-only");
    expect(sov.pool.eligibleEvidence).toBe(5);
    // v2 entries: ChatGPT / Claude AI / Gemini / Notion（Gemini 与 Notion 在真实语料中出现）
    const byName = Object.fromEntries(sov.competitors.map((c: { canonicalName: string }) => [c.canonicalName, c]));
    expect(Object.keys(byName).sort()).toEqual(["ChatGPT", "Claude AI", "Gemini", "Notion"].sort());
    expect(byName.ChatGPT.mentionCount).toBeGreaterThanOrEqual(3);
    expect(byName.Gemini.mentionCount).toBeGreaterThanOrEqual(1);
    expect(byName.Notion.mentionCount).toBe(1);
    const totalShare = sov.competitors.reduce((sum: number, c: { shareOfVoice: number | null }) => sum + (c.shareOfVoice ?? 0), 0);
    expect(totalShare).toBeCloseTo(1, 5);
    expect(sov.note).toContain("Competitor Set");
  });

  // ---------- auth / 401 ----------
  it("未认证访问全部 competitors 端点 → 401", async () => {
    await request(http).post(`/projects/${ids.projectA}/competitor-discovery`).expect(401);
    await request(http).get(`/projects/${ids.projectA}/competitor-candidates`).expect(401);
    await request(http).get(`/competitor-candidates/${candidateIds.chatgpt}`).expect(401);
    await request(http).patch(`/competitor-candidates/${candidateIds.chatgpt}`).send({}).expect(401);
    await request(http).get(`/projects/${ids.projectA}/competitor-sets`).expect(401);
    await request(http).post(`/projects/${ids.projectA}/competitor-sets`).send({}).expect(401);
    await request(http).get(`/competitor-sets/${randomUUID()}`).expect(401);
    await request(http).post(`/competitor-sets/${randomUUID()}/activate`).expect(401);
    await request(http).post(`/projects/${ids.projectA}/competitor-reanalysis`).send({}).expect(401);
    await request(http).get(`/projects/${ids.projectA}/competitor-sov`).expect(401);
  });

  // ---------- A/B/C 不进入新分析（18 的 analysis 侧）----------
  it("m6b 分析不包含 A/B/C legacy 占位（新分析只消费真实候选）", async () => {
    const m6bMentions = await prisma.mention.findMany({
      where: { analysis: { analysisVersion: M6B_ANALYSIS_VERSION, competitorSetId: setIds.v2 } },
      select: { canonicalName: true, entityType: true },
    });
    const names = m6bMentions.map(m => m.canonicalName);
    expect(names).not.toContain("Competitor A");
    expect(names).not.toContain("Competitor B");
    expect(names).not.toContain("Competitor C");
    expect(names).not.toContain("CompA");
  });
});
