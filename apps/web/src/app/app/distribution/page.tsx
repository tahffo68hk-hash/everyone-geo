"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DistributionTask } from "@/lib/quick-start.types";

const button = "inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50";

function videoScriptText(metadata: Record<string, unknown> | null | undefined) {
  const savedText = metadata?.videoScriptText;
  if (typeof savedText === "string") return savedText;
  const value = metadata?.videoScript;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const script = value as Record<string, unknown>;
  if (typeof script.voiceover === "string") {
    const shots = Array.isArray(script.shotSuggestions)
      ? script.shotSuggestions.filter((item): item is string => typeof item === "string")
      : [];
    return [script.voiceover, ...shots].join("\n\n");
  }
  return [
    typeof script.opening === "string" ? script.opening : "",
    typeof script.narration === "string" ? script.narration : "",
    Array.isArray(script.outline)
      ? script.outline.flatMap((item) => {
          if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
          const section = item as Record<string, unknown>;
          return [
            typeof section.heading === "string" ? section.heading : "",
            ...(Array.isArray(section.keyPoints) ? section.keyPoints.filter((point): point is string => typeof point === "string") : []),
          ];
        }).filter(Boolean).join("\n")
      : "",
    typeof script.ending === "string" ? script.ending : "",
  ].filter(Boolean).join("\n\n");
}

function contentRiskNotes(metadata: Record<string, unknown> | null | undefined) {
  const read = (key: string) => {
    const value = metadata?.[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  return [...read("riskNotes"), ...read("qualityWarnings")];
}

function contentSummary(metadata: Record<string, unknown> | null | undefined) {
  if (typeof metadata?.summaryText === "string") return metadata.summaryText;
  return typeof metadata?.summary === "string" ? metadata.summary : "";
}

export default function DistributionWorkbenchPage() {
  const [tasks, setTasks] = useState<DistributionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");

  async function loadTasks() {
    setLoading(true);
    setError("");
    try {
      setTasks(await api<DistributionTask[]>("/distribution/tasks"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载发布任务失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTasks();
  }, []);

  async function copyContent(task: DistributionTask) {
    try {
      const script = videoScriptText(task.content.metadata);
      const scriptSection = script ? `\n\n视频脚本\n${script}` : "";
      const summary = contentSummary(task.content.metadata);
      const summarySection = summary ? `\n\n摘要\n${summary}` : "";
      const hashtags = task.content.hashtags.join(" ");
      const hashtagSection = hashtags ? `\n\n${hashtags}` : "";
      await navigator.clipboard.writeText(`${task.content.title}${summarySection}\n\n${task.content.body}${hashtagSection}${scriptSection}`);
      setCopiedId(task.id);
      window.setTimeout(() => setCopiedId(""), 1600);
    } catch {
      setError("浏览器没有开放剪贴板权限，请手动选择并复制内容。");
    }
  }

  return (
    <main>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-600">DISTRIBUTION WORKSPACE</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">发布工作台</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">从内容中心带入的草稿会保存在正式项目中，在这里查看、复制和安排人工复核。</p>
          </div>
          <Link href="/app/quick-start" className="inline-flex min-h-10 items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">生成新内容</Link>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-900">
          <strong>人工复核边界</strong>
          <span className="ml-1">当前项目没有配置官方平台连接器。下面的任务仍是内容草稿；复制或填写内容都不会被记录为公开发布。</span>
        </div>

        {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><span>{error}</span><button className="font-semibold underline underline-offset-2" onClick={() => void loadTasks()}>重新加载</button></div>}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">正在加载分发草稿…</div>
        ) : tasks.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center shadow-sm">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-lg font-semibold text-blue-700">↗</div>
            <h2 className="mt-4 text-base font-semibold text-slate-900">还没有分发任务</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">完成快速开始的检测和内容编辑后，可以把草稿带到这里。</p>
            <Link href="/app/quick-start" className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">前往快速开始</Link>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{tasks.length} 个分发草稿任务</span>
              <button className="font-medium text-blue-700 hover:text-blue-800" onClick={() => void loadTasks()}>刷新列表</button>
            </div>
            <ul className="space-y-4">
              {tasks.map((task) => (
                <li key={task.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{task.platformLabel}</span>
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">待人工复核</span>
                        {task.content.isMock && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">模拟生成/未真实验证</span>}
                      </div>
                      <h2 className="mt-3 text-base font-semibold leading-6 text-slate-900">{task.content.title}</h2>
                      <p className="mt-1 text-xs text-slate-500">项目：{task.project.name} · 品牌：{task.content.brand.name} · 任务状态：草稿</p>
                      {contentSummary(task.content.metadata) && <p className="mt-2 text-sm leading-6 text-slate-600">{contentSummary(task.content.metadata)}</p>}
                    </div>
                    <button className={button} onClick={() => void copyContent(task)}>{copiedId === task.id ? "已复制" : "复制整份草稿"}</button>
                  </div>
                  <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div>
                      <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">{task.content.body}</p>
                      {videoScriptText(task.content.metadata) && <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">查看视频脚本</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{videoScriptText(task.content.metadata)}</p></details>}
                      {task.content.hashtags.length > 0 && <p className="mt-4 text-xs leading-6 text-blue-700">{task.content.hashtags.join(" ")}</p>}
                      {contentRiskNotes(task.content.metadata).length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><strong>发布前人工核对</strong><ul className="mt-1 list-disc space-y-1 pl-4">{contentRiskNotes(task.content.metadata).map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul><p className="mt-2">自动检查不能证明内容事实真伪。</p></div>}
                    </div>
                    <aside className="h-fit rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                      <p className="text-xs font-semibold text-slate-800">发布准备</p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{task.note}</p>
                      <div className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">
                        <p>平台连接器：<span className="font-medium text-slate-700">尚未接入</span></p>
                        <p className="mt-1">公开发布状态：<span className="font-medium text-slate-700">未发生</span></p>
                      </div>
                      <button className={`${button} mt-3 w-full`} onClick={() => void copyContent(task)}>{copiedId === task.id ? "已复制，可人工复核" : "复制后由人工发布"}</button>
                    </aside>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
