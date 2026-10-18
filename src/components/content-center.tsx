"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { channels, Channel, fields, ContentBody } from "@/lib/content";
const labels: Record<string, string> = {
  title: "标题",
  body: "正文 / 简介",
  hashtags: "话题标签",
  coverSuggestion: "封面建议",
  imageSuggestions: "配图建议",
  videoScript: "视频脚本",
  storyboard: "分镜结构",
};
export function Suggestions({ id }: { id: string }) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const load = () => api("reports/" + id).then(setData);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [id]);
  const latest = data?.suggestions[0];
  return (
    <section className="card">
      <h2>AI GEO 优化建议</h2>
      <p className="small">
        基于本报告已保存的逐题回答。点击生成发送1次请求，真实模型可能收费（金额未知），Mock费用为0。不会自动调用。
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        我确认当前设置的模型与潜在费用
      </label>
      <button
        disabled={busy || !confirmed || !data}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api(`reports/${id}/suggestions`, { confirmed });
            await load();
            setConfirmed(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "生成中…" : latest ? "重新生成优化建议" : "生成 AI 优化建议"}
      </button>
      {latest && (
        <>
          <Provenance
            generation={latest.generation}
            evidenceMock={latest.evidence_mock}
          />
          {JSON.parse(latest.payload).map((s: any, i: number) => (
            <div className="topic" key={i}>
              <h3>{s.title}</h3>
              <p>{s.action}</p>
              {s.queryIds.map((qid: string) => (
                <p key={qid}>
                  <a href={"#answer-" + qid}>
                    查看对应问题与回答 · {qid.slice(0, 8)}
                  </a>
                </p>
              ))}
            </div>
          ))}
        </>
      )}
      <p role="alert" className="error">
        {error}
      </p>
    </section>
  );
}
function Provenance({
  generation,
  evidenceMock,
}: {
  generation: string;
  evidenceMock: number;
}) {
  const g = JSON.parse(generation);
  return (
    <div className="notice">
      {g.is_mock ? "模拟数据/未真实验证" : "真实 API 生成，内容仍需人工核实"}
      {evidenceMock ? " · 输入含模拟数据/未真实验证" : ""}
      <p className="small">
        {g.provider} / {g.model} · {g.prompt_version} · {g.latency_ms} ms ·
        Token {g.tokens?.total_tokens ?? "未知"} · 费用 {g.cost ?? "未知"}
      </p>
    </div>
  );
}
export function ContentCenter({ id }: { id: string }) {
  const [data, setData] = useState<any>(),
    [channel, setChannel] = useState<Channel>("geo"),
    [selected, setSelected] = useState(""),
    [body, setBody] = useState<ContentBody>(),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState(""),
    [media, setMedia] = useState<any[]>([]),
    [demoConfirmed, setDemoConfirmed] = useState(false);
  const load = () =>
    api("reports/" + id).then((d) => {
      setData(d);
      return d;
    });
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, [id]);
  const current = data?.contents.find((c: any) => c.id === selected);
  async function choose(c: any) {
    setSelected(c.id);
    setBody(JSON.parse(c.body));
    setChannel(c.channel);
    setDemoConfirmed(false);
    const r = await fetch("/api/media?contentId=" + c.id);
    setMedia((await r.json()).media);
  }
  async function generate() {
    setBusy(true);
    setMessage("");
    try {
      const r = await api(`reports/${id}/generate`, { channel, confirmed });
      const d = await load();
      await choose(d.contents.find((c: any) => c.id === r.id));
      setConfirmed(false);
      setMessage("已生成并保存新草稿；旧版本保留。");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">AI 内容中心</div>
      <div className="between">
        <h1>把检测线索变成有用的内容</h1>
        <Link href={"/reports/" + id}>返回关联报告 →</Link>
      </div>
      <p>
        报告 {id} · {data?.report.name} · 所有内容均保留回答证据关联。
      </p>
      <section className="card">
        <label>
          内容类型
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            {Object.entries(channels).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <p>{channels[channel].guide}</p>
        <p className="small">
          生成或重新生成每次仅发送1次请求。使用顶部模型设置；真实调用可能收费，金额未知，输出上限2,400
          tokens。Mock费用为0。
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我确认模型与本次潜在费用
        </label>
        <button onClick={generate} disabled={busy || !confirmed || !data}>
          {busy ? "生成中…" : selected ? "重新生成（保留旧草稿）" : "生成内容"}
        </button>
        <p role="status">{message}</p>
      </section>
      <div className="two-col">
        <section className="card">
          <h2>报告内容草稿</h2>
          {data?.contents.map((c: any) => (
            <p key={c.id}>
              <button className="secondary" onClick={() => choose(c)}>
                {channels[c.channel as Channel]?.label} ·{" "}
                {JSON.parse(c.body).title} · {c.is_mock ? "模拟" : "AI"} / DRAFT
              </button>
            </p>
          ))}
          {!data?.contents.length && (
            <p>选择渠道，点击生成以创建第一份草稿。</p>
          )}
        </section>
        {body && current && (
          <section className="card">
            <h2>编辑与保存</h2>
            <Provenance
              generation={current.generation}
              evidenceMock={current.evidence_mock}
            />
            {fields.map((k) => (
              <label key={k}>
                {labels[k]}
                {k === "title" ? (
                  <input
                    value={body[k]}
                    onChange={(e) => setBody({ ...body, [k]: e.target.value })}
                  />
                ) : (
                  <textarea
                    rows={k === "body" ? 10 : 3}
                    value={body[k]}
                    onChange={(e) => setBody({ ...body, [k]: e.target.value })}
                  />
                )}
              </label>
            ))}
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`reports/${id}/save`, { id: selected, body });
                  await load();
                  setMessage("草稿已保存");
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存为草稿
            </button>
            <details>
              <summary>生成依据 · 问题与原始回答</summary>
              {JSON.parse(current.query_ids).map((qid: string) => {
                const r = data.responses.find((r: any) => r.id === qid);
                return (
                  <div key={qid}>
                    <Link href={`/reports/${id}#answer-${qid}`}>
                      {qid} · {r?.query}
                    </Link>
                    <p className="raw">{r?.raw_answer}</p>
                  </div>
                );
              })}
            </details>
          </section>
        )}
      </div>
      <section className="card">
        <h2>媒体预览与上传</h2>
        <p>
          演示素材由本项目本地绘制并生成，CC0
          授权。仅预览；不会自动附加到发布任务。发布模式默认 PREPARE_ONLY。
        </p>
        <div className="two-col">
          <figure>
            <img
              className="media-preview"
              src="/demo/cover.svg"
              alt="演示素材：GEO内容封面"
            />
            <figcaption>演示素材 · 图文封面</figcaption>
          </figure>
          <figure>
            <video
              className="media-preview"
              controls
              preload="metadata"
              poster="/demo/cover.svg"
              src="/demo/preview.mp4"
            />
            <figcaption>演示素材 · 视频预览</figcaption>
          </figure>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={demoConfirmed}
            onChange={(e) => setDemoConfirmed(e.target.checked)}
          />
          我明确选择演示素材用于当前内容预览（不授权发布）
        </label>
        {demoConfirmed && (
          <p className="notice">已确认预览演示素材；未创建任何发布任务。</p>
        )}
        <label>
          上传自己的图片或 MP4（每个文件最多25MB，先选择草稿）
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4"
            disabled={!selected || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                const form = new FormData();
                form.set("file", file);
                form.set("contentId", selected);
                const r = await fetch("/api/media", {
                    method: "POST",
                    body: form,
                  }),
                  v = await r.json();
                if (!r.ok) throw Error(v.error);
                setMedia([...media, v]);
                setMessage("用户素材已上传并关联草稿");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
                e.target.value = "";
              }
            }}
          />
        </label>
        <div className="two-col">
          {media.map((m) => (
            <figure key={m.id}>
              {m.mime === "video/mp4" ? (
                <video
                  controls
                  className="media-preview"
                  src={"/api/media/" + m.id}
                />
              ) : (
                <img
                  className="media-preview"
                  src={"/api/media/" + m.id}
                  alt="用户上传素材"
                />
              )}
              <figcaption>用户素材 · {m.id.slice(0, 8)}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}
