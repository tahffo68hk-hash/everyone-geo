"use client";
import Link from "next/link";
import { Suggestions } from "./content-center";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { defaults, Provider, Question } from "@/lib/gateway";
import { api } from "@/lib/client-api";
export function Shell({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(false);
  return (
    <>
      <header>
        <div className="nav">
          <Link href="/" className="logo">
            <span className="logo-icon">G</span>GeoLens{" "}
            <span className="mini">MINI</span>
          </Link>
          <nav>
            <Link href="/">GEO 检测</Link>
            <Link href="/publish">内容发布</Link>
            <button className="ghost" onClick={() => setSettings(true)}>
              ⚙ 模型设置
            </button>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer>
        GeoLens Mini · 从每一次回答，看见品牌的机会
        <span>API 回答 ≠ 实时联网搜索</span>
      </footer>
      {settings && <Settings close={() => setSettings(false)} />}
    </>
  );
}
function Settings({ close }: { close: () => void }) {
  const [c, setC] = useState<any>({
      provider: "mock",
      ...defaults.mock,
      extra: {},
    }),
    [key, setKey] = useState(""),
    [extra, setExtra] = useState("{}"),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    api("settings")
      .then((v) => {
        setC(v);
        setExtra(JSON.stringify(v.extra, null, 2));
      })
      .catch((e) => setMsg(e.message));
  }, []);
  async function save(test = false) {
    setBusy(true);
    setMsg("");
    try {
      await api("settings", { ...c, key, extra: JSON.parse(extra) });
      setKey("");
      if (test) {
        const r = await api("test", { confirmed: confirm });
        setMsg(
          r.is_mock
            ? "模拟连接正常 · 模拟数据/未真实验证"
            : "真实连接正常 · 本次已产生1次请求",
        );
      } else {
        setMsg("设置已保存，仅当前服务端会话生效");
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="between">
          <h2 id="settings-title">模型与连接设置</h2>
          <button className="ghost" onClick={close}>
            关闭
          </button>
        </div>
        <p>
          密钥仅保存在服务端会话内存，服务重启后失效；不会回传或写入浏览器存储。
        </p>
        <label>
          Provider
          <select
            value={c.provider}
            onChange={(e) => {
              const provider = e.target.value as Provider;
              setC({ provider, ...defaults[provider], extra: {} });
              setKey("");
              setConfirm(false);
            }}
          >
            <option value="mock">Mock（模拟数据/未真实验证）</option>
            <option value="deepseek">DeepSeek</option>
            <option value="qwen">Qwen / DashScope</option>
            <option value="compatible">OpenAI-compatible</option>
          </select>
        </label>
        <label>
          API Base URL
          <input
            value={c.baseUrl}
            disabled={c.provider === "mock"}
            onChange={(e) => setC({ ...c, baseUrl: e.target.value })}
          />
        </label>
        <label>
          API Key {c.hasKey ? "（已配置，留空保留）" : ""}
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={c.provider === "mock"}
          />
        </label>
        <label>
          Model
          <input
            value={c.model}
            onChange={(e) => setC({ ...c, model: e.target.value })}
          />
        </label>
        <label>
          额外参数（JSON；temperature / top_p / max_tokens 等）
          <textarea value={extra} onChange={(e) => setExtra(e.target.value)} />
        </label>
        {c.provider !== "mock" && (
          <label className="check">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            我确认测试会发送 1 次真实请求，可能产生费用
          </label>
        )}
        <div className="actions">
          <button onClick={() => save()} disabled={busy}>
            保存设置
          </button>
          <button
            className="secondary"
            disabled={busy || (c.provider !== "mock" && !confirm)}
            onClick={() => save(true)}
          >
            测试连接
          </button>
        </div>
        <p role="status">{msg}</p>
      </section>
    </div>
  );
}
export function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recent, setRecent] = useState<any[]>([]);
  useEffect(() => {
    api("runs")
      .then((v) => setRecent(v.runs))
      .catch(() => {});
  }, []);
  return (
    <div className="home">
      <div className="eyebrow">品牌的下一站，是 AI 的答案</div>
      <h1>让你的品牌更容易被 AI 推荐</h1>
      <p className="lead">
        了解 AI 如何回答用户的问题，找到品牌内容的优化方向。
      </p>
      <form
        className="brand-form card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const data = Object.fromEntries(new FormData(e.currentTarget));
            const r = await api("runs", data);
            router.push("/runs/" + r.id);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="brand-label">
          品牌或产品名称 <span>必填</span>
          <input
            name="name"
            required
            maxLength={100}
            placeholder="输入你想监测的品牌或产品名称"
          />
        </label>
        <details>
          <summary>
            补充品牌信息 <span>选填，让问题更贴近你的业务</span>
          </summary>
          <div className="fields">
            {[
              ["website", "品牌官网"],
              ["description", "产品或服务介绍"],
              ["category", "行业/产品类别"],
              ["audience", "目标用户"],
              ["competitors", "竞争品牌"],
              ["keywords", "核心关键词"],
              ["market", "目标市场"],
            ].map(([k, v]) => (
              <label key={k}>
                {v}（选填）
                <input
                  name={k}
                  maxLength={2000}
                  placeholder={k === "competitors" ? "用逗号分隔多个品牌" : v}
                />
              </label>
            ))}
          </div>
        </details>
        <button className="primary wide" disabled={busy}>
          {busy ? "正在创建…" : "开始 GEO 检测"} <span>→</span>
        </button>
        <p className="small">
          只需一个品牌名即可开始。下一步确认类别、问题与模型，再执行检测。
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <div className="steps">
        <div>
          <b>01</b>
          <h3>提出真实问题</h3>
          <p>从用户需求出发，生成可编辑的监测问题。</p>
        </div>
        <div>
          <b>02</b>
          <h3>保留回答证据</h3>
          <p>逐题检测，记录模型回答、提及与引用。</p>
        </div>
        <div>
          <b>03</b>
          <h3>找到内容机会</h3>
          <p>用本次检测数据，定位值得优先覆盖的主题。</p>
        </div>
      </div>
      {recent.length > 0 && (
        <section className="recent">
          <h2>当前会话的检测</h2>
          {recent.map((r) => (
            <Link key={r.id} href={"/runs/" + r.id}>
              {r.id.slice(0, 8)} · {r.status} <span>查看 →</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
export function Run({ id }: { id: string }) {
  const [data, setData] = useState<any>(),
    [qs, setQs] = useState<Question[]>([]),
    [category, setCategory] = useState(""),
    [cfg, setCfg] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  async function load(initial = false) {
    const [d, c] = await Promise.all([api("runs/" + id), api("settings")]);
    setData(d);
    setCfg(c);
    if (initial) {
      setQs(d.questions);
      setCategory(d.run.category);
    }
  }
  useEffect(() => {
    load(true).catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [id]);
  async function action(type: string) {
    setBusy(true);
    setError("");
    try {
      if (type === "execute")
        await api(`runs/${id}/save`, { questions: qs, category });
      await api(`runs/${id}/${type}`, { category, confirmed, questions: qs });
      await load(true);
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="card">
        <h1>GEO 检测</h1>
        <p>{error || "正在读取任务…"}</p>
      </section>
    );
  const frozen = data.run.status !== "DRAFT",
    running = data.run.status === "RUNNING";
  return (
    <>
      <div className="eyebrow">GEO 检测 / {data.run.name}</div>
      <div className="between">
        <div>
          <h1>让问题更贴近你的用户</h1>
          <p>先确认品牌类别与监测问题，再开始逐题检测。</p>
        </div>
        <span className="badge">{data.run.status}</span>
      </div>
      <div className="grid-run">
        <section className="card">
          <label>
            识别的行业 / 产品类别 · 推断结果，未经核实
            <input
              value={category}
              disabled={frozen || busy}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
          <div className="between">
            <h2>
              监测问题 <span className="muted">{qs.length} 条</span>
            </h2>
            <button
              className="secondary"
              disabled={
                busy || frozen || (cfg?.provider !== "mock" && !confirmed)
              }
              onClick={() => action("generate")}
            >
              {qs.length ? "重新生成" : "生成监测问题"}
            </button>
          </div>
          {!qs.length && (
            <div className="empty">
              点击生成监测问题。Mock 生成仅用于演示；真实 Provider 使用 AI
              生成。
            </div>
          )}
          <div className="questions">
            {qs.map((q, i) => (
              <div className="question" key={i}>
                <div className="between">
                  <span className="tag">
                    {q.kind} · {q.intent}
                  </span>
                  <button
                    className="ghost"
                    disabled={frozen || busy}
                    onClick={() => setQs(qs.filter((_, j) => j !== i))}
                  >
                    删除
                  </button>
                </div>
                <textarea
                  aria-label={"问题 " + (i + 1)}
                  value={q.text}
                  disabled={frozen || busy}
                  onChange={(e) =>
                    setQs(
                      qs.map((q, j) =>
                        j === i ? { ...q, text: e.target.value } : q,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          {qs.length > 0 && !frozen && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => action("save")}
            >
              保存问题与类别
            </button>
          )}
        </section>
        <aside>
          <section className="card sticky">
            <h2>检测配置</h2>
            <p>
              Provider <strong>{cfg?.provider}</strong>
            </p>
            <p>
              Model <strong>{cfg?.model}</strong>
            </p>
            <p className="small">
              点击顶部「模型设置」切换服务。执行后配置与问题冻结保留。
            </p>
            {cfg?.provider === "mock" && (
              <div className="notice">
                模拟数据/未真实验证
                <br />
                不代表品牌的真实 AI 可见度。
              </div>
            )}
            <hr />
            <h3>调用与费用预估</h3>
            <p>
              生成问题：1 次请求
              <br />
              执行检测：{qs.length} 次请求
              <br />
              Token 粗估：每题约 500–2,500
            </p>
            <p className="small">
              {cfg?.provider === "mock"
                ? "Mock 费用 ¥0，Token 不计量。"
                : "实际费用取决于供应商定价，金额未知；单次输出上限 2,400 tokens，无自动重试。生成问题和测试连接也可能收费。"}
            </p>
            <label className="check">
              <input
                type="checkbox"
                disabled={busy || frozen}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我确认本次调用数量、模型与潜在费用
            </label>
            <button
              className="wide"
              disabled={!confirmed || !qs.length || busy || frozen}
              onClick={() => action("execute")}
            >
              {busy || running ? "执行中…" : "确认并开始检测"}
            </button>
            <p role="status">
              进度：{data.responses.length} / {data.questions.length}{" "}
              条回答已保存
            </p>
            <progress
              value={data.responses.length}
              max={data.questions.length || 1}
            />
            {frozen && (
              <Link className="button secondary wide" href={"/reports/" + id}>
                查看{data.run.status === "COMPLETED" ? "检测" : "部分"}报告 →
              </Link>
            )}
            {data.run.error && (
              <p className="error">
                {data.run.error}。已保存证据保留，可新建任务重试。
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
export function Report({ id }: { id: string }) {
  const [d, setD] = useState<any>(),
    [err, setErr] = useState("");
  useEffect(() => {
    api("runs/" + id)
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [id]);
  if (!d) return <p>{err || "正在读取报告…"}</p>;
  const m = d.metrics;
  const gaps = d.responses.filter((r: any) => !r.brand_mentioned);
  const strengths = d.responses.filter((r: any) => r.brand_mentioned);
  const percent = (rate: number | null) =>
    rate === null ? "—" : Math.round(rate * 100) + "%";
  return (
    <>
      <div className="eyebrow">GEO 报告 · {d.run.name}</div>
      <div className="between">
        <div>
          <h1>每一次回答，都是一条线索</h1>
          <p>
            {d.run.provider} / {d.run.model} · {d.run.status} ·{" "}
            {d.run.created_at} UTC
          </p>
        </div>
        <Link className="button secondary" href={"/runs/" + id}>
          返回检测
        </Link>
      </div>
      {(d.run.is_mock || d.responses.some((r: any) => r.is_mock)) && (
        <div className="notice">
          模拟数据/未真实验证：以下指标由已保存的模拟回答计算，仅用于演示，不能用于品牌效果结论。
        </div>
      )}
      {d.run.status !== "COMPLETED" && (
        <div className="notice">
          检测尚未完成，当前为部分报告。指标分母仅包含已成功保存的回答（
          {m.total}/{d.questions.length}）。
        </div>
      )}
      {d.generation?.is_mock && !d.run.is_mock && (
        <div className="notice">
          监测问题由 Mock 生成（模拟数据/未真实验证），回答来源见逐题证据。
        </div>
      )}
      <div className="stats">
        <div className="card">
          <p>本次检测提及率</p>
          <strong>{percent(m.rate)}</strong>
          <p>
            {m.mentioned} / {m.total} 个已回答问题提及品牌
          </p>
        </div>
        <div className="card">
          <p>DISCOVERY 自然发现</p>
          <strong>{percent(m.discovery.rate)}</strong>
          <p>
            {m.discovery.mentioned} / {m.discovery.total} · 评估无品牌提示的问题
          </p>
        </div>
        <div className="card">
          <p>BRANDED 品牌认知</p>
          <strong>{percent(m.branded.rate)}</strong>
          <p>
            {m.branded.mentioned} / {m.branded.total} · 问题已包含品牌名
          </p>
        </div>
      </div>
      <section className="card">
        <h2>逐题回答与原始证据</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>问题 / 意图</th>
                <th>提及情况</th>
                <th>模型与用量</th>
                <th>回答证据</th>
              </tr>
            </thead>
            <tbody>
              {d.responses.map((r: any) => (
                <tr key={r.id} id={"answer-" + r.id}>
                  <td>
                    {r.query}
                    <div className="small">
                      {r.kind} · {r.intent}
                    </div>
                  </td>
                  <td>
                    {r.brand_mentioned ? "已提及" : "未提及"}
                    <p className="small">
                      规范化字符起始位置：{r.mention_position ?? "—"}
                    </p>
                    <p className="small">
                      竞品：{JSON.parse(r.competitors).join("、") || "未检出"}
                    </p>
                  </td>
                  <td>
                    {r.provider}
                    <br />
                    {r.model}
                    <p className="small">
                      {r.latency_ms} ms ·{" "}
                      {r.tokens
                        ? (JSON.parse(r.tokens).total_tokens ?? "未知")
                        : "Token 未提供"}
                      <br />
                      费用：{r.cost === null ? "未知" : r.cost}
                      <br />
                      {r.timestamp}
                      <br />
                      {r.prompt_version}
                      <br />
                      web_search=false
                    </p>
                  </td>
                  <td>
                    <details>
                      <summary>查看原始回答</summary>
                      <p className="raw">{r.raw_answer}</p>
                      <p className="small">
                        {r.is_mock ? "模拟数据/未真实验证" : "真实 API 回答"}
                      </p>
                      {JSON.parse(r.citations).length ? (
                        JSON.parse(r.citations).map((url: string) => (
                          <p key={url}>
                            <a href={url} target="_blank" rel="noreferrer">
                              Provider 返回引用：{url}
                            </a>
                          </p>
                        ))
                      ) : (
                        <p className="small">
                          Provider 未返回结构化引用；不补造来源。
                        </p>
                      )}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!m.total && <p>尚无回答。请先完成检测。</p>}
      </section>
      <div className="two-col">
        <section className="card">
          <h2>优势与不足</h2>
          <p>
            已覆盖：{strengths.length}{" "}
            条问题中检出品牌名称。文字提及本身不证明推荐、认可或事实正确。
          </p>
          <p>潜在缺口：{gaps.length} 条已回答问题未检出品牌名称。</p>
          <h3>竞争品牌出现情况</h3>
          {Object.entries(m.competitors).map(([name, count]) => (
            <p key={name}>
              {name} · {String(count)} 个回答
            </p>
          ))}
          {!Object.keys(m.competitors).length && (
            <p>未检出用户配置的竞争品牌。</p>
          )}
        </section>
        <section className="card">
          <h2>优先覆盖的主题</h2>
          <p className="small">
            规则建议，根据本次未提及问题生成；并非 AI 已验证的优化结论。
          </p>
          {gaps.slice(0, 5).map((r: any) => (
            <div className="topic" key={r.id}>
              <strong>{r.intent}</strong>
              <p>{r.query}</p>
              <p className="small">
                建议补充可核实的相关说明、使用场景和比较依据；对应回答见上表。
              </p>
            </div>
          ))}
          {!gaps.length && (
            <p>当前没有检出的未提及问题；可扩大自然发现问题样本继续观察。</p>
          )}
          <Link className="button secondary" href={"/content/" + id}>
            根据分析生成内容 →
          </Link>
        </section>
      </div>
      {d.run.status === "COMPLETED" && <Suggestions id={id} />}
      <section className="card">
        <h2>检测方法与局限性</h2>
        <p>
          本报告对存储的原始回答进行名称匹配，英文按词边界、不区分大小写；提及位置是
          NFKC 规范化文本的字符偏移（从 1
          开始），不是推荐排名。竞品仅检测用户输入的名称，不推断别名、情感或事实正确性。
        </p>
        <p>
          普通模型 API，web_search=false；不能代表实时网页搜索、消费者 AI
          产品、互联网市场占有率或全平台可见度。DISCOVERY 与 BRANDED
          分开计算，品牌提示可能提高提及率。样本量、模型版本和措辞均会影响结果。缺失的
          Token、费用、引用保留为未知。
        </p>
      </section>
    </>
  );
}
