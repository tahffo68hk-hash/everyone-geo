"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DistributionTask } from "@/lib/quick-start.types";

const LOCAL_DRAFTS_KEY = "geolens-demo-local-drafts";
const field = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

type LocalDraft = {
  taskId: string;
  title: string;
  body: string;
  hashtags: string[];
  platform: string;
  brand: string;
  savedAt: string;
};

export default function MockPublisherPage() {
  const [task, setTask] = useState<DistributionTask | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get("taskId");
    if (!taskId) {
      setError("缺少发布草稿任务，请从发布工作台选择一条草稿。 ");
      setLoading(false);
      return;
    }
    void api<DistributionTask>(`/distribution/tasks/${encodeURIComponent(taskId)}`)
      .then((value) => {
        setTask(value);
        setTitle(value.content.title);
        setBody(value.content.body);
        setHashtags(value.content.hashtags.join(" "));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "加载草稿失败"))
      .finally(() => setLoading(false));
  }, []);

  function saveLocalDraft() {
    if (!task) return;
    const draft: LocalDraft = {
      taskId: task.id,
      title: title.trim(),
      body: body.trim(),
      hashtags: hashtags.split(/\s+/).filter(Boolean),
      platform: task.platformLabel,
      brand: task.content.brand.name,
      savedAt: new Date().toISOString(),
    };
    try {
      const existing = JSON.parse(window.localStorage.getItem(LOCAL_DRAFTS_KEY) ?? "[]") as unknown;
      const drafts = Array.isArray(existing)
        ? existing.filter((item): item is LocalDraft =>
            typeof item === "object" && item !== null && "taskId" in item && item.taskId !== task.id,
          )
        : [];
      window.localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify([...drafts, draft]));
      setSavedAt(draft.savedAt);
      setError("");
    } catch {
      setError("浏览器未能写入本地测试草稿，请检查本机存储空间后重试。");
    }
  }

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-600">LOCAL PUBLISH SANDBOX</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">本地模拟发布</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">检查 AI 草稿并保存到本机浏览器的测试草稿箱，验证发布前最后一步。</p>
        </div>
        <Link href="/app/distribution" className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回发布工作台</Link>
      </div>

      <section className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
        <p className="font-semibold">安全目标：本机测试草稿箱</p>
        <p className="mt-1">点击保存只写入当前浏览器的 localStorage；不会登录或请求外部平台，不会公开发布。</p>
      </section>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {loading ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">正在加载发布草稿…</section>
      ) : task ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">测试草稿 · {task.platformLabel}</p>
              <p className="mt-1 text-xs text-slate-500">品牌：{task.content.brand.name} · 项目：{task.project.name}</p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">未公开发布</span>
          </div>

          <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-slate-600">
                发布标题
                <input aria-label="发布标题" className={field} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                发布正文
                <textarea aria-label="发布正文" className={`${field} min-h-56 resize-y`} value={body} onChange={(event) => setBody(event.target.value)} />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                话题标签
                <input aria-label="话题标签" className={field} value={hashtags} onChange={(event) => setHashtags(event.target.value)} />
              </label>
            </div>

            <aside className="h-fit rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
              <p className="text-sm font-semibold text-slate-900">发布动作</p>
              <p className="mt-2 text-xs leading-5 text-slate-600">模拟将编辑后的内容存入本机测试草稿箱，保留原平台任务供人工复核。</p>
              <button
                type="button"
                data-testid="mock-publish-action"
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                onClick={saveLocalDraft}
              >
                保存到本地测试草稿箱
              </button>
              <p className="mt-3 text-xs leading-5 text-slate-500">目标：GeoLens 本机浏览器 · 公开状态：未发生</p>
              {savedAt && (
                <p role="status" data-testid="mock-publish-confirmation" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium leading-5 text-emerald-800">
                  已保存本地测试草稿，时间 {new Date(savedAt).toLocaleString("zh-CN")}。没有向外部平台发送内容。
                </p>
              )}
            </aside>
          </div>
        </section>
      ) : null}
    </main>
  );
}
