// Must precede Prisma/application imports: refuses databases other than geo_test.
import '../../../packages/database/scripts/test-env.cjs';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@geo/database';
import { AppModule } from '../src/app.module';

/**
 * M5 DeepSeek engine availability guards + metrics data integrity (e2e).
 * Env is toggled per-test because MonitorTasksService reads process.env at
 * request time; every mutated key is restored in afterAll.
 */
describe('DeepSeek provider guards (M5 e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let agent: ReturnType<typeof request.agent>;
  const ids = { users: [] as string[], orgs: [] as string[], projects: [] as string[], tasks: [] as string[], engines: [] as string[] };
  const suffix = randomUUID();
  let mockEngineId = '';
  let deepseekEngineId = '';

  const configuredEnv = { ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: 'sk-e2e-test-secret', DEEPSEEK_MODEL: 'deepseek-chat' };

  beforeAll(async () => {
    // Deterministic baseline: real providers off, no API key visible.
    delete process.env.ENABLE_REAL_PROVIDERS;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK;

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();
    agent = request.agent(http);
    const response = await agent.post('/auth/register').send({ email: `deepseek-${suffix}@m5e2e.test.com`, name: 'DeepSeek User', password: 'm5-deepseek-pass-123' }).expect(201);
    ids.users.push(response.body.user.id);
    ids.orgs.push(response.body.organization.id);
    const project = await prisma.project.create({ data: { organizationId: response.body.organization.id, name: `DeepSeek ${suffix}` } });
    ids.projects.push(project.id);
    // 真实产品路径：可用监测 Query 必须挂接 enabled && !archived 的 BenchmarkQuery
    // （镜像 Query 与 BenchmarkQuery 成对存在）。create() 以 BenchmarkQuery 启用/归档为
    // "可用"判定（R2 修复 #3），故此处补齐镜像，避免 DeepSeek 守卫测试被可用性校验拦截。
    const suite = await prisma.benchmarkSuite.create({ data: { projectId: project.id, name: `M5 Suite ${suffix}`, version: '1' } });
    for (let i = 0; i < 2; i++) {
      const q = await prisma.query.create({ data: { projectId: project.id, text: `M5 e2e query ${suffix} ${i}` } });
      await prisma.benchmarkQuery.create({ data: { suiteId: suite.id, projectQueryId: q.id, queryText: q.text, category: 'custom', intent: '自定义', enabled: true, sortOrder: i } });
    }
    const mockEngine = await prisma.engine.create({ data: { key: `m5-mock-${suffix}`, name: 'M5 Mock', provider: 'mock', config: { delayMs: 5 } as never } });
    mockEngineId = mockEngine.id;
    ids.engines.push(mockEngine.id);
    const deepseekEngine = await prisma.engine.create({ data: { key: `m5-deepseek-${suffix}`, name: 'DeepSeek API', provider: 'deepseek', config: {} as never } });
    deepseekEngineId = deepseekEngine.id;
    ids.engines.push(deepseekEngine.id);
  });

  afterAll(async () => {
    try {
      await prisma.monitorTask.deleteMany({ where: { projectId: { in: ids.projects } } });
      await prisma.engine.deleteMany({ where: { id: { in: ids.engines } } });
      await prisma.project.deleteMany({ where: { id: { in: ids.projects } } });
      await prisma.organization.deleteMany({ where: { id: { in: ids.orgs } } });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    } finally {
      delete process.env.ENABLE_REAL_PROVIDERS;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_BASE_URL;
      delete process.env.DEEPSEEK_MODEL;
      delete process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK;
      await app?.close();
      await prisma.$disconnect();
    }
  });

  async function queryIds(): Promise<string[]> {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.projects[0] } });
    const rows = await prisma.query.findMany({ where: { projectId: project.id }, select: { id: true } });
    return rows.map(row => row.id);
  }

  it('options：返回全部启用 Engine（含 deepseek），configured/sourceType/model 无 secret', async () => {
    const { body } = await agent.get('/monitor-tasks/options').expect(200);
    const engines = body.engines as Array<{ id: string; key: string; provider: string; sourceType: string | null; model: string | null; configured: boolean }>;
    const mock = engines.find(engine => engine.id === mockEngineId);
    assert(mock, 'mock engine 必须在 options 中');
    expect(mock).toMatchObject({ provider: 'mock', sourceType: 'mock', model: 'geolens-mock', configured: true });
    const deepseek = engines.find(engine => engine.id === deepseekEngineId);
    assert(deepseek, 'deepseek engine 必须在 options 中（即使未配置）');
    expect(deepseek).toMatchObject({ provider: 'deepseek', sourceType: 'official_api', model: 'deepseek-chat', configured: false });
    const serialized = JSON.stringify(engines);
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('DEEPSEEK_API_KEY');
  });

  it('create：DeepSeek 未配置时明确拒绝（400），任务不落库', async () => {
    const qs = await queryIds();
    const { body } = await agent.post('/monitor-tasks')
      .send({ projectId: ids.projects[0], queryIds: qs, engineIds: [deepseekEngineId] })
      .expect(400);
    expect(JSON.stringify(body)).toContain('DeepSeek Provider 未配置或未启用');
    const count = await prisma.monitorTask.count({ where: { projectId: ids.projects[0] } });
    expect(count).toBe(0);
  });

  it('create：mock engine 在 DeepSeek 未配置时仍可正常创建（Mock 不依赖真实 Provider）', async () => {
    const qs = await queryIds();
    const { body } = await agent.post('/monitor-tasks')
      .send({ projectId: ids.projects[0], queryIds: qs.slice(0, 1), engineIds: [mockEngineId] })
      .expect(202);
    expect(body.totalRuns).toBe(1);
    ids.tasks.push(body.id);
    await prisma.monitorTask.delete({ where: { id: body.id } });
  });

  it('create：真实调用上限（REAL_PROVIDER_MAX_RUNS_PER_TASK=1，2 Query × 1 DeepSeek → 拒绝且不 silent truncate）', async () => {
    Object.assign(process.env, configuredEnv, { REAL_PROVIDER_MAX_RUNS_PER_TASK: '1' });
    const qs = await queryIds();
    expect(qs.length).toBeGreaterThanOrEqual(2);
    const { body } = await agent.post('/monitor-tasks')
      .send({ projectId: ids.projects[0], queryIds: qs, engineIds: [deepseekEngineId] })
      .expect(400);
    expect(JSON.stringify(body)).toContain('上限为 1');
    expect(JSON.stringify(body)).toContain('真实 Provider 单任务运行数上限');
    const count = await prisma.monitorTask.count({ where: { projectId: ids.projects[0] } });
    expect(count).toBe(0);
    delete process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK;
  });

  it('create：配置完整（ENABLE_REAL_PROVIDERS + DEEPSEEK_API_KEY）且未超限 → 202', async () => {
    Object.assign(process.env, configuredEnv, { REAL_PROVIDER_MAX_RUNS_PER_TASK: '10' });
    const { body: optionsBody } = await agent.get('/monitor-tasks/options').expect(200);
    const deepseek = (optionsBody.engines as Array<{ id: string; configured: boolean }>).find(engine => engine.id === deepseekEngineId);
    expect(deepseek?.configured).toBe(true);
    const qs = await queryIds();
    const { body } = await agent.post('/monitor-tasks')
      .send({ projectId: ids.projects[0], queryIds: qs.slice(0, 1), engineIds: [deepseekEngineId] })
      .expect(202);
    expect(body.totalRuns).toBe(1);
    ids.tasks.push(body.id);
    await prisma.monitorTask.delete({ where: { id: body.id } });
    delete process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK;
  });

  it('metrics：混合 mock+real 任务 → metricSource=mixed，指标只基于 real runs（不被 Demo 污染）', async () => {
    Object.assign(process.env, configuredEnv, { REAL_PROVIDER_MAX_RUNS_PER_TASK: '10' });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.projects[0] } });
    const task = await prisma.monitorTask.create({ data: { organizationId: ids.orgs[0], projectId: project.id, totalRuns: 3, status: 'PARTIAL' } });
    ids.tasks.push(task.id);
    const mkRun = async (engineId: string, status: 'SUCCEEDED' | 'FAILED') => {
      const query = await prisma.query.create({ data: { projectId: project.id, text: `metrics ${randomUUID()}` } });
      const run = await prisma.run.create({ data: { monitorTaskId: task.id, queryId: query.id, engineId, status } });
      return run;
    };
    // 2 real runs: 1 SUCCEEDED(with analysis) + 1 FAILED; 1 mock run SUCCEEDED(with analysis)
    const realOk = await mkRun(deepseekEngineId, 'SUCCEEDED');
    await mkRun(deepseekEngineId, 'FAILED');
    const mockOk = await mkRun(mockEngineId, 'SUCCEEDED');
    for (const [run, brandMentioned, recommended] of [[realOk, true, true], [mockOk, false, false]] as const) {
      const evidence = await prisma.evidence.create({ data: {
        runId: run.id, queryText: 'q', rawPrompt: 'p', rawResponse: 'r', provider: run.engineId === deepseekEngineId ? 'deepseek' : 'mock',
        engineKey: 'k', engineName: 'n',
        requestedModel: run.engineId === deepseekEngineId ? 'deepseek-chat' : 'geolens-mock',
        responseModel: run.engineId === deepseekEngineId ? 'deepseek-v4-flash' : 'geolens-mock',
        model: 'm', modelVersion: null,
        retrievalMode: run.engineId === deepseekEngineId ? 'api_plain' : 'unknown',
        sourceType: run.engineId === deepseekEngineId ? 'official_api' : 'mock',
        metadata: {}, entitySnapshot: {},
      } });
      await prisma.analysis.create({ data: {
        evidenceId: evidence.id, analysisVersion: 'm4-rule-v1', brandMentioned,
        mentionPosition: brandMentioned ? 1 : null, recommended, sentiment: recommended ? 'positive' : 'neutral',
        mentions: brandMentioned ? { create: [{ entityType: 'brand', entityId: 'brand-x', canonicalName: 'X', displayName: 'X', position: 1, context: 'r', sentiment: 'positive', startOffset: 0, endOffset: 1 }] } : undefined,
      } });
    }
    const { body } = await agent.get(`/monitor-tasks/${task.id}/metrics`).expect(200);
    expect(body.metricSource).toBe('mixed');
    expect(body.totalRuns).toBe(2); // real subset only
    expect(body.successfulRuns).toBe(1);
    expect(body.failedRuns).toBe(1);
    expect(body.analyzedRuns).toBe(1);
    expect(body.visibilityRate).toBe(1);
    expect(body.analysisMissingRuns).toBe(0);
    await prisma.monitorTask.delete({ where: { id: task.id } });
    delete process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK;
  });
});

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
