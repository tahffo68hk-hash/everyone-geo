import {
  channels,
  Channel,
  contentPrompt,
  suggestionsPrompt,
  validateSuggestions,
  validateBody,
  parseObject,
} from "@/lib/content";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db, row } from "@/lib/db";
import { session } from "@/lib/session";
import {
  complete,
  defaults,
  infer,
  parseQuestions,
  questionsPrompt,
  VERSION,
  Config,
} from "@/lib/gateway";
import { mention, metrics } from "@/lib/metrics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handle(req, ctx);
}
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handle(req, ctx);
}
async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    if (
      req.method === "POST" &&
      req.headers.get("origin") &&
      req.headers.get("origin") !== req.nextUrl.origin
    )
      return NextResponse.json({ error: "不允许跨站请求" }, { status: 403 });
    const s = await session(),
      path = (await ctx.params).path;
    const b = req.method === "POST" ? await req.json() : {};
    const out = (v: any) =>
      NextResponse.json(v, { headers: { "Cache-Control": "no-store" } });
    if (path[0] === "reports" && path[1]) {
      const report = row(
        "SELECT r.*,b.name FROM reports p JOIN runs r ON r.id=p.run_id JOIN brands b ON b.id=r.brand_id WHERE p.id=? AND r.owner=?",
        path[1],
        s.id,
      );
      if (!report)
        return NextResponse.json(
          { error: "未找到当前会话的完整报告" },
          { status: 404 },
        );
      const responses = db()
        .prepare("SELECT * FROM responses WHERE run_id=? ORDER BY timestamp")
        .all(report.id) as any[];
      const evidenceMock = responses.some((r) => r.is_mock);
      const suggestions = () =>
        db()
          .prepare(
            "SELECT * FROM ai_suggestions WHERE report_id=? ORDER BY rowid DESC",
          )
          .all(report.id);
      if (req.method === "GET")
        return out({
          report,
          responses,
          suggestions: suggestions(),
          contents: db()
            .prepare(
              "SELECT c.*,g.generation,g.query_ids,g.evidence_mock FROM contents c JOIN content_generations g ON g.content_id=c.id WHERE report_id=? ORDER BY c.rowid DESC",
            )
            .all(report.id),
        });
      if (path[2] === "suggestions") {
        const result = await complete(
          s.cfg,
          suggestionsPrompt(responses),
          "suggestions",
          { responses },
          b.confirmed === true,
        );
        const payload = validateSuggestions(result.answer, responses);
        db()
          .prepare(
            "INSERT INTO ai_suggestions(id,report_id,payload,generation,evidence_mock) VALUES(?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            report.id,
            JSON.stringify(payload),
            JSON.stringify({
              ...result,
              provider: s.cfg.provider,
              prompt_version: "suggestions-v1",
            }),
            +evidenceMock,
          );
        return out({ ok: true });
      }
      if (path[2] === "generate") {
        if (
          typeof b.channel !== "string" ||
          !Object.hasOwn(channels, b.channel)
        )
          throw Error("请选择有效内容类型");
        const latest = suggestions()[0] as any;
        const result = await complete(
          s.cfg,
          contentPrompt(
            b.channel as Channel,
            report.name,
            responses,
            latest ? JSON.parse(latest.payload) : [],
          ),
          "content",
          { channel: b.channel, name: report.name, responses },
          b.confirmed === true,
        );
        const body = validateBody(parseObject(result.answer)),
          id = randomUUID();
        db().exec("BEGIN");
        try {
          db()
            .prepare(
              "INSERT INTO contents(id,report_id,channel,body,is_mock) VALUES(?,?,?,?,?)",
            )
            .run(
              id,
              report.id,
              b.channel,
              JSON.stringify(body),
              +result.is_mock,
            );
          db()
            .prepare(
              "INSERT INTO content_generations(content_id,generation,query_ids,evidence_mock) VALUES(?,?,?,?)",
            )
            .run(
              id,
              JSON.stringify({
                ...result,
                provider: s.cfg.provider,
                prompt_version: "content-v1",
              }),
              JSON.stringify(responses.map((r) => r.id)),
              +evidenceMock,
            );
          db().exec("COMMIT");
        } catch (e) {
          db().exec("ROLLBACK");
          throw e;
        }
        return out({ id });
      }
      if (path[2] === "save") {
        const body = validateBody(b.body);
        const changed = db()
          .prepare(
            "UPDATE contents SET body=?,status='DRAFT' WHERE id=? AND report_id=?",
          )
          .run(JSON.stringify(body), String(b.id), report.id);
        if (!changed.changes) throw Error("草稿不存在");
        return out({ ok: true });
      }
    }
    if (path[0] === "settings") {
      if (req.method === "POST") {
        if (!(b.provider in defaults)) throw Error("Provider 无效");
        if (typeof b.model !== "string" || !b.model.trim())
          throw Error("请输入模型");
        if (!b.extra || typeof b.extra !== "object" || Array.isArray(b.extra))
          throw Error("额外参数必须为 JSON 对象");
        const cfg: Config = {
          provider: b.provider,
          model: b.model.slice(0, 200),
          baseUrl: String(b.baseUrl || ""),
          extra: b.extra,
          key:
            typeof b.key === "string" && b.key
              ? b.key
              : s.cfg.provider === b.provider
                ? s.cfg.key
                : undefined,
        };
        if (cfg.provider !== "mock") {
          let url: URL;
          try {
            url = new URL(cfg.baseUrl);
          } catch {
            throw Error("请输入有效的 HTTPS Base URL");
          }
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            throw Error("Base URL 必须是无凭据、无查询参数的 HTTPS 地址");
        }
        const allowed = [
          "temperature",
          "top_p",
          "max_tokens",
          "presence_penalty",
          "frequency_penalty",
          "seed",
        ];
        if (
          Object.entries(cfg.extra).some(
            ([k, v]) =>
              !allowed.includes(k) ||
              typeof v !== "number" ||
              !Number.isFinite(v),
          )
        )
          throw Error("额外参数只支持列出的数值参数");
        if (
          cfg.extra.max_tokens !== undefined &&
          (Number(cfg.extra.max_tokens) < 1 ||
            !Number.isInteger(cfg.extra.max_tokens))
        )
          throw Error("max_tokens 必须为正整数");
        s.save(cfg);
        return out({ ok: true });
      }
      return out({
        provider: s.cfg.provider,
        baseUrl: s.cfg.baseUrl,
        model: s.cfg.model,
        extra: s.cfg.extra,
        hasKey: !!s.cfg.key,
      });
    }
    if (path[0] === "test") {
      return out(
        await complete(
          s.cfg,
          "只回复连接正常",
          "test",
          {},
          b.confirmed === true,
        ),
      );
    }
    if (path[0] === "runs" && path.length === 1) {
      if (req.method !== "POST")
        return out({
          runs: db()
            .prepare(
              "SELECT id,status,created_at FROM runs WHERE owner=? ORDER BY created_at DESC LIMIT 20",
            )
            .all(s.id),
        });
      const name = String(b.name || "").trim();
      if (!name || name.length > 100) throw Error("请输入100字以内的品牌名称");
      const id = randomUUID(),
        brand = randomUUID(),
        project = randomUUID();
      const context = Object.fromEntries(
        [
          "website",
          "description",
          "category",
          "audience",
          "competitors",
          "keywords",
          "market",
        ].map((k) => [k, String(b[k] || "").slice(0, 2000)]),
      );
      db()
        .prepare("INSERT INTO projects(id,name) VALUES(?,?)")
        .run(project, name);
      db()
        .prepare("INSERT INTO brands VALUES(?,?,?,?)")
        .run(brand, project, name, JSON.stringify(context));
      db()
        .prepare(
          "INSERT INTO runs(id,brand_id,owner,category,provider,model,is_mock) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          id,
          brand,
          s.id,
          context.category || infer(name, context.description),
          s.cfg.provider,
          s.cfg.model,
          +(s.cfg.provider === "mock"),
        );
      return out({ id });
    }
    if (path[0] === "runs" && path[1]) {
      const run = row(
        "SELECT r.*,b.name,b.context FROM runs r JOIN brands b ON b.id=r.brand_id WHERE r.id=? AND r.owner=?",
        path[1],
        s.id,
      );
      if (!run) return out({ error: "未找到当前会话的检测任务" });
      const getQ = () => row("SELECT * FROM query_sets WHERE run_id=?", run.id);
      if (req.method === "GET") {
        const q = getQ();
        const responses = db()
          .prepare("SELECT * FROM responses WHERE run_id=? ORDER BY timestamp")
          .all(run.id);
        return out({
          run: { ...run, context: JSON.parse(run.context) },
          questions: q ? JSON.parse(q.questions) : [],
          generation: q?.generation ? JSON.parse(q.generation) : null,
          responses,
          metrics: metrics(responses as any),
        });
      }
      if (run.status === "RUNNING") throw Error("检测执行中，请等待");
      const brand = {
        name: run.name,
        ...JSON.parse(run.context),
        category: String(b.category || run.category),
      };
      if (path[2] === "generate") {
        if (run.status !== "DRAFT")
          throw Error("已执行任务的问题已冻结，请新建检测");
        const r = await complete(
          s.cfg,
          questionsPrompt(brand),
          "questions",
          brand,
          b.confirmed === true,
        );
        const p = parseQuestions(r.answer);
        db()
          .prepare("INSERT OR REPLACE INTO query_sets VALUES(?,?,?,?,?)")
          .run(
            getQ()?.id || randomUUID(),
            run.id,
            JSON.stringify(p.questions),
            VERSION,
            JSON.stringify(r),
          );
        db()
          .prepare("UPDATE runs SET category=? WHERE id=?")
          .run(p.category || brand.category, run.id);
        return out({ ok: true });
      }
      if (path[2] === "save") {
        if (
          !Array.isArray(b.questions) ||
          b.questions.length < 1 ||
          b.questions.length > 12 ||
          b.questions.some(
            (q: any) =>
              typeof q.text !== "string" ||
              !q.text.trim() ||
              q.text.length > 1000 ||
              !["DISCOVERY", "BRANDED"].includes(q.kind) ||
              typeof q.intent !== "string",
          )
        )
          throw Error("请保留1–12条有效问题");
        if (run.status !== "DRAFT")
          throw Error("已执行任务的证据已冻结，请新建检测");
        db()
          .prepare("UPDATE query_sets SET questions=? WHERE run_id=?")
          .run(JSON.stringify(b.questions), run.id);
        db()
          .prepare("UPDATE runs SET category=? WHERE id=?")
          .run(brand.category, run.id);
        return out({ ok: true });
      }
      if (path[2] === "execute") {
        if (b.confirmed !== true) throw Error("请先确认本次请求数量与费用");
        const q = getQ();
        if (!q) throw Error("请先生成问题");
        const questions = JSON.parse(q.questions);
        if (run.status !== "DRAFT") throw Error("任务已经执行，请新建检测");
        const locked = db()
          .prepare(
            "UPDATE runs SET status='RUNNING',provider=?,model=?,is_mock=?,error=NULL WHERE id=? AND status='DRAFT'",
          )
          .run(
            s.cfg.provider,
            s.cfg.model,
            +(s.cfg.provider === "mock"),
            run.id,
          );
        if (!locked.changes) throw Error("任务已开始");
        // Await each request and persist immediately; polling GET exposes durable progress.
        try {
          for (const question of questions) {
            const r = await complete(
              s.cfg,
              question.text,
              "answer",
              brand,
              true,
            );
            const m = mention(r.answer, brand.name);
            const competitors = String(brand.competitors || "")
              .split(/[,，、\n]/)
              .map((x) => x.trim())
              .filter((x) => x && mention(r.answer, x).mentioned);
            db()
              .prepare(
                "INSERT INTO responses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              )
              .run(
                randomUUID(),
                run.id,
                question.text,
                question.kind,
                question.intent,
                s.cfg.provider,
                r.model,
                "geo-answer-v1",
                r.answer,
                new Date().toISOString(),
                +m.mentioned,
                m.position,
                JSON.stringify(competitors),
                JSON.stringify(r.citations),
                r.tokens ? JSON.stringify(r.tokens) : null,
                r.latency_ms,
                r.cost,
                +r.is_mock,
                0,
              );
          }
          const responses = db()
            .prepare("SELECT * FROM responses WHERE run_id=?")
            .all(run.id);
          db()
            .prepare("INSERT INTO reports(id,run_id,metrics) VALUES(?,?,?)")
            .run(run.id, run.id, JSON.stringify(metrics(responses as any)));
          db()
            .prepare("UPDATE runs SET status='COMPLETED' WHERE id=?")
            .run(run.id);
        } catch (e) {
          db()
            .prepare("UPDATE runs SET status='FAILED',error=? WHERE id=?")
            .run(e instanceof Error ? e.message : "检测失败", run.id);
          throw e;
        }
        return out({ ok: true });
      }
    }
    return NextResponse.json({ error: "接口不存在" }, { status: 404 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 400 },
    );
  }
}
