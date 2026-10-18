"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
const typeLabel: Record<string, string> = {
  image: "图文",
  article: "文章",
  video: "视频",
};
const states: Record<string, string> = {
  DRAFT: "草稿",
  FILLING: "准备中",
  FILLED_AWAITING_REVIEW: "已填写 · 待人工审核",
  NEEDS_LOGIN: "需要登录",
  FAILED: "准备失败",
  PUBLISHED_VERIFIED: "人工确认已发布",
};
export default function PublishWorkbench() {
  const [data, setData] = useState<any>(null),
    [contentId, setContent] = useState(""),
    [selected, setSelected] = useState<Record<string, boolean>>({}),
    [edits, setEdits] = useState<Record<string, any>>({}),
    [media, setMedia] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [claimCode, setClaimCode] = useState(""),
    [accountLabel, setAccountLabel] = useState(""),
    [accountPlatform, setAccountPlatform] = useState("xiaohongshu"),
    [urls, setUrls] = useState<Record<string, string>>({}),
    [wp, setWp] = useState({ site: "", username: "", password: "" });
  const load = async () => setData(await api("publish/workspace"));
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
    const timer = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!contentId || !data) return;
    const c = data.contents.find((c: any) => c.id === contentId),
      body = JSON.parse(c.body),
      next: Record<string, any> = {};
    for (const p of data.platforms) {
      const limit =
        p.id === "xiaohongshu" ? 20 : p.id === "bilibili" ? 80 : 100;
      next[p.id] = {
        title: body.title.slice(0, limit),
        body: p.id === "weibo" ? body.body.slice(0, 280) : body.body,
        tags: body.hashtags,
        type: p.types[0],
        accountId: "",
        mediaIds: [],
        coverId: "",
        declaration: "内容无需标注",
        selfMadeAuth: false,
      };
    }
    setEdits(next);
    api("media?contentId=" + contentId)
      .then((d) => setMedia(d.media))
      .catch((e) => setMessage(e.message));
  }, [contentId]);
  async function act(fn: () => Promise<any>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await load();
      setMessage("操作已完成；请查看任务状态");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const update = (id: string, k: string, v: any) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
  const action = (a: string, id: string, body: any = {}) =>
    act(() => api("publish/" + a + "/" + id, body));
  if (!data) return <p>加载发布工作台…{message}</p>;
  return (
    <>
      <div className="eyebrow">DISTRIBUTION · PREPARE_ONLY</div>
      <h1>内容发布工作台</h1>
      <p className="subtitle">
        适配草稿、上传媒体、自动填写，最后由你审核并手动发布。
      </p>
      <div className="notice">
        所有真实平台：未真实验证。浏览器会停在审核前；封面、分类、原创与 AI
        声明请人工复核；B站自动设置封面与创作声明，分类仍需人工设置。
        {data.display
          ? "检测到 DISPLAY；请在云桌面操作，用户端接管仍需实际确认。"
          : "无 DISPLAY，无法扫码接管；需要登录时返回 NEEDS_LOGIN。"}{" "}
        WordPress 仅创建 REST 草稿。
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="card">
        <h2>绑定云端已登录账号</h2>
        <input
          aria-label="绑定码"
          placeholder="XXXXX-XXXXX"
          value={claimCode}
          onChange={(e) => setClaimCode(e.target.value)}
        />
        <button
          disabled={busy || !claimCode.trim()}
          onClick={() =>
            act(async () => {
              await api("publish/claim", { code: claimCode });
              setClaimCode("");
            })
          }
        >
          绑定账号
        </button>
      </section>
      <section className="card">
        <h2>1. 选择内容与账号</h2>
        <label>
          来源草稿
          <select
            value={contentId}
            onChange={(e) => setContent(e.target.value)}
          >
            <option value="">选择已保存的内容</option>
            {data.contents.map((c: any) => (
              <option key={c.id} value={c.id}>
                {JSON.parse(c.body).title}{" "}
                {c.is_mock ? "· 模拟数据/未真实验证" : ""}
              </option>
            ))}
          </select>
        </label>
        {!data.contents.length && (
          <p>先从 GEO 报告进入内容中心生成并保存草稿。</p>
        )}
        <div className="publish-account">
          <select
            aria-label="账号平台"
            value={accountPlatform}
            onChange={(e) => setAccountPlatform(e.target.value)}
          >
            {data.platforms.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            aria-label="账号名称"
            placeholder="账号名称（无需密码或 Cookie）"
            value={accountLabel}
            onChange={(e) => setAccountLabel(e.target.value)}
          />
          <button
            disabled={busy || !accountLabel.trim()}
            onClick={() =>
              act(async () => {
                await api("publish/accounts", {
                  platform: accountPlatform,
                  label: accountLabel,
                });
                setAccountLabel("");
              })
            }
          >
            添加本地账号
          </button>
        </div>
        <p className="small">
          每个账号有独立的本地浏览器
          profile。登录状态只代表最近一次检查；不会读取其他账号会话。
        </p>
      </section>
      <section className="card">
        <h2>平台能力矩阵</h2>
        <div className="publish-platforms">
          {data.platforms.map((p: any) => (
            <label className="publish-platform" key={p.id}>
              <input
                type="checkbox"
                disabled={!contentId}
                checked={!!selected[p.id]}
                onChange={(e) =>
                  setSelected({ ...selected, [p.id]: e.target.checked })
                }
              />
              <strong>{p.label}</strong>
              <span>
                {p.types.map((t: string) => typeLabel[t]).join(" / ")}
              </span>
              <small>
                {p.validation} ·{" "}
                {p.id === "wordpress"
                  ? "REST 草稿"
                  : p.id === "test"
                    ? "headless 验证"
                    : "浏览器辅助"}
              </small>
            </label>
          ))}
        </div>
      </section>
      {data.platforms
        .filter((p: any) => selected[p.id] && edits[p.id])
        .map((p: any) => {
          const edit = edits[p.id],
            accounts = data.accounts.filter((a: any) => a.platform === p.id);
          return (
            <section className="card" key={p.id}>
              <h2>{p.label} · 适配预览与编辑</h2>
              <p className="small">
                沿用来源草稿，按平台限制裁切标题；请审核语气、长度与事实。视频需上传成片，文案不会自动生成视频。
              </p>
              <label>
                目标账号
                <select
                  value={edit.accountId}
                  onChange={(e) => update(p.id, "accountId", e.target.value)}
                >
                  <option value="">选择账号</option>
                  {accounts.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.label} · {a.login_status}
                      {a.checked_at ? " / " + a.checked_at : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                内容类型
                <select
                  value={edit.type}
                  onChange={(e) => {
                    update(p.id, "type", e.target.value);
                    update(p.id, "mediaIds", []);
                  }}
                >
                  {p.types.map((t: string) => (
                    <option key={t} value={t}>
                      {typeLabel[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                标题
                <input
                  value={edit.title}
                  onChange={(e) => update(p.id, "title", e.target.value)}
                />
              </label>
              <label>
                正文 / 简介
                <textarea
                  rows={7}
                  value={edit.body}
                  onChange={(e) => update(p.id, "body", e.target.value)}
                />
              </label>
              <label>
                话题
                <input
                  value={edit.tags}
                  onChange={(e) => update(p.id, "tags", e.target.value)}
                />
              </label>
              <label>
                上传真实媒体（25MB以内）
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,video/mp4"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      act(async () => {
                        const form = new FormData();
                        form.append("contentId", contentId);
                        form.append("file", file);
                        const res = await fetch("/api/media", {
                          method: "POST",
                          body: form,
                        });
                        const d = await res.json();
                        if (!res.ok) throw Error(d.error);
                        setMedia(
                          (await api("media?contentId=" + contentId)).media,
                        );
                      });
                  }}
                />
              </label>
              <div>
                {media
                  .filter((m) =>
                    edit.type === "video"
                      ? m.mime.startsWith("video/")
                      : m.mime.startsWith("image/"),
                  )
                  .map((m) => (
                    <label className="publish-media" key={m.id}>
                      <input
                        type="checkbox"
                        checked={edit.mediaIds.includes(m.id)}
                        onChange={(e) =>
                          update(
                            p.id,
                            "mediaIds",
                            e.target.checked
                              ? [...edit.mediaIds, m.id]
                              : edit.mediaIds.filter(
                                  (id: string) => id !== m.id,
                                ),
                          )
                        }
                      />
                      {m.mime.startsWith("image/") ? (
                        <img src={"/api/media/" + m.id} alt="用户上传素材" />
                      ) : (
                        <video src={"/api/media/" + m.id} controls />
                      )}
                      <span>{m.mime} · 用户素材</span>
                    </label>
                  ))}
              </div>
              {p.id === "bilibili" && (
                <>
                  <label>
                    创作声明
                    <select
                      value={edit.declaration}
                      onChange={(e) =>
                        update(p.id, "declaration", e.target.value)
                      }
                    >
                      {[
                        "内容无需标注",
                        "含AI生成内容",
                        "含虚构演绎内容",
                        "内容含营销信息",
                        "个人观点，仅供参考",
                        "内容为转载",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={edit.selfMadeAuth}
                      onChange={(e) =>
                        update(p.id, "selfMadeAuth", e.target.checked)
                      }
                    />
                    内容为自制：未经作者允许，禁止转载
                  </label>
                </>
              )}
              <label>
                可选封面（用户图片）
                <select
                  value={edit.coverId}
                  onChange={(e) => update(p.id, "coverId", e.target.value)}
                >
                  <option value="">
                    {p.id === "bilibili" ? "使用首个推荐帧" : "人工设置封面"}
                  </option>
                  {media
                    .filter((m) => m.mime.startsWith("image/"))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                </select>
              </label>
              <p className="small">
                演示素材不会自动带入任务。封面建议：
                {
                  JSON.parse(
                    data.contents.find((c: any) => c.id === contentId)?.body ||
                      "{}",
                  ).coverSuggestion
                }
              </p>
            </section>
          );
        })}
      <button
        className="primary"
        disabled={busy || !contentId || !Object.values(selected).some(Boolean)}
        onClick={() =>
          act(() =>
            api("publish/create", {
              contentId,
              targets: Object.keys(selected)
                .filter((id) => selected[id])
                .map((id) => ({ platform: id, ...edits[id] })),
            }),
          )
        }
      >
        保存独立平台任务
      </button>
      <section className="card" style={{ marginTop: 24 }}>
        <h2>2. 自动填写与人工确认</h2>
        {!data.jobs.length && <p>保存任务后，在这里检查登录并开始自动填写。</p>}
        {data.jobs.map((j: any) => (
          <article className="publish-job" key={j.id}>
            <h3>
              {data.platforms.find((p: any) => p.id === j.platform)?.label} ·{" "}
              {data.accounts.find((a: any) => a.id === j.account_id)?.label}{" "}
              <span className="badge">{states[j.status]}</span>
            </h3>
            <p>
              {data.contents.some((c: any) => c.id === j.content_id)
                ? JSON.parse(j.payload).title
                : "手动验证任务（无关联草稿）"}
            </p>
            {!!j.is_mock && <div className="notice">模拟数据/未真实验证</div>}
            <p role="status">{j.progress}</p>
            {j.error && <p className="error">{j.error}</p>}
            {j.readback && (
              <details>
                <summary>回读记录 / 草稿凭据</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(JSON.parse(j.readback), null, 2)}
                </pre>
              </details>
            )}
            <div className="actions">
              {j.platform !== "wordpress" ? (
                <>
                  <button
                    disabled={busy || !!j.pid}
                    onClick={() => action("check", j.id)}
                  >
                    检查登录
                  </button>
                  <button
                    disabled={busy || !!j.pid}
                    onClick={() => action("open", j.id)}
                  >
                    打开浏览器 / 人工接管
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy || !!j.pid || j.status === "PUBLISHED_VERIFIED"
                    }
                    onClick={() => action("fill", j.id)}
                  >
                    开始自动填写
                  </button>
                </>
              ) : (
                <details>
                  <summary>WordPress REST 草稿</summary>
                  <input
                    placeholder="https://站点"
                    value={wp.site}
                    onChange={(e) => setWp({ ...wp, site: e.target.value })}
                  />
                  <input
                    placeholder="用户名"
                    value={wp.username}
                    onChange={(e) => setWp({ ...wp, username: e.target.value })}
                  />
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="应用密码（仅本次请求）"
                    value={wp.password}
                    onChange={(e) => setWp({ ...wp, password: e.target.value })}
                  />
                  <button
                    disabled={busy}
                    onClick={() => {
                      action("wordpress", j.id, { ...wp, confirmed: true });
                      setWp({ ...wp, password: "" });
                    }}
                  >
                    确认创建草稿（不公开）
                  </button>
                  <p>媒体与分类请在 WordPress 后台手动设置。</p>
                </details>
              )}
              <a href={"/api/publish/export/" + j.id}>下载人工发布包 ZIP</a>
              {j.status === "FILLED_AWAITING_REVIEW" && (
                <button
                  disabled={busy}
                  onClick={() => action("review", j.id, { confirmed: true })}
                >
                  确认已人工审核（仍未发布）
                </button>
              )}
            </div>
            {j.pid && (
              <p className="small">
                执行器 PID {j.pid}
                。通过云桌面接管，关闭该浏览器后可重试。请勿同时打开相同账号
                profile。
              </p>
            )}
            {j.platform !== "test" && (
              <div className="publish-account">
                <input
                  aria-label="发布链接"
                  placeholder="手动发布后，粘贴真实公开 URL"
                  value={urls[j.id] || ""}
                  onChange={(e) => setUrls({ ...urls, [j.id]: e.target.value })}
                />
                <button
                  disabled={busy || !urls[j.id] || !!j.pid}
                  onClick={() =>
                    action("confirm", j.id, {
                      url: urls[j.id],
                      confirmed: true,
                    })
                  }
                >
                  确认我已发布并核实链接
                </button>
              </div>
            )}
            {j.url && (
              <p>
                人工提供链接（未独立联网核验）：
                <a href={j.url} target="_blank" rel="noreferrer">
                  {j.url}
                </a>
              </p>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
