"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Options = {
  projects: Array<{ id: string; name: string; queries: Array<{ id: string; text: string }> }>;
  engines: Array<{ id: string; key: string; name: string }>;
};

type MonitorTask = {
  id: string;
  status: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  progress: number;
  runs: Array<{
    id: string;
    queryId: string;
    engineId: string;
    status: string;
    attempt: number;
    errorCode: string | null;
    errorMessage: string | null;
  }>;
};

const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"]);
const statusLabels: Record<string, string> = {
  PENDING: "待执行", QUEUED: "排队中", RUNNING: "执行中", RETRYING: "重试中",
  SUCCEEDED: "成功", FAILED: "失败", PARTIAL: "部分成功", CANCELLED: "已取消",
};
const buttonClass = "rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}

export default function MonitorPage() {
  const [options, setOptions] = useState<Options | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [queryIds, setQueryIds] = useState<string[]>([]);
  const [engineIds, setEngineIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<MonitorTask | null>(null);
  const [pollError, setPollError] = useState("");
  const [pollRetry, setPollRetry] = useState(0);
  const activeTask = useRef<string | null>(null);
  const createRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const savedTaskId = new URL(window.location.href).searchParams.get("task");
    if (savedTaskId) {
      activeTask.current = savedTaskId;
      setTaskId(savedTaskId);
    }
    return () => createRequest.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError("");
    api<Options>("/monitor-tasks/options", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setOptions(data);
        setProjectId(data.projects[0]?.id ?? "");
        setQueryIds(data.projects[0]?.queries.slice(0, 5).map((query) => query.id) ?? []);
        setEngineIds(data.engines.filter((engine) => ["mock-alpha", "mock-beta", "mock-gamma"].includes(engine.key)).map((engine) => engine.id));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setOptionsError(errorText(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRetry]);

  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    async function poll() {
      try {
        const data = await api<MonitorTask>(`/monitor-tasks/${encodeURIComponent(taskId!)}`, { signal: controller.signal });
        if (controller.signal.aborted || activeTask.current !== taskId) return;
        setTask(data);
        setPollError("");
        failures = 0;
        if (!terminalStatuses.has(data.status)) timer = setTimeout(poll, 1000);
      } catch (error) {
        if (controller.signal.aborted || activeTask.current !== taskId) return;
        failures += 1;
        const delay = Math.min(1000 * 2 ** Math.min(failures, 4), 15000);
        setPollError(`${errorText(error)} 将在 ${delay / 1000} 秒后重试。`);
        timer = setTimeout(poll, delay);
      }
    }
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [taskId, pollRetry]);

  const project = options?.projects.find((item) => item.id === projectId);
  const canCreate = !creating && !optionsLoading && Boolean(projectId) && queryIds.length > 0 && engineIds.length > 0;

  function toggle(id: string, selected: string[], update: (ids: string[]) => void) {
    update(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  async function createTask() {
    if (!canCreate) return;
    const controller = new AbortController();
    createRequest.current?.abort();
    createRequest.current = controller;
    setCreating(true);
    setCreateError("");
    try {
      const data = await api<MonitorTask>("/monitor-tasks", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ projectId, queryIds, engineIds }),
      });
      if (controller.signal.aborted) return;
      activeTask.current = data.id;
      setTask(data);
      setTaskId(data.id);
      setPollError("");
      const url = new URL(window.location.href);
      url.searchParams.set("task", data.id);
      window.history.replaceState(null, "", url);
    } catch (error) {
      if (!controller.signal.aborted) setCreateError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setCreating(false);
    }
  }

  const queries = new Map(options?.projects.flatMap((item) => item.queries.map((query) => [query.id, query.text] as const)));
  const engines = new Map(options?.engines.map((engine) => [engine.id, engine.name] as const));

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <Link href="/app" className="text-sm text-blue-700 hover:underline">← 返回工作台</Link>
          <h1 className="mt-3 text-2xl font-semibold">监测任务</h1>
          <p className="mt-2 text-sm text-slate-500">选择项目、查询和模拟引擎，创建任务并查看执行进度。</p>
        </header>

        <section aria-labelledby="create-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 id="create-heading" className="mb-4 text-lg font-semibold">创建任务</h2>
          {optionsLoading ? <p role="status">正在加载项目和引擎…</p> : optionsError ? (
            <div>
              <p role="alert" className="mb-3 text-sm text-red-700">{optionsError}</p>
              <button className={buttonClass} onClick={() => setOptionsRetry((value) => value + 1)}>重新加载</button>
              <Link href="/login" className="ml-4 text-sm text-blue-700 hover:underline">前往登录</Link>
            </div>
          ) : !options?.projects.length ? <p className="text-sm text-slate-500">暂无可访问的项目，请先加入有项目的组织。</p> : (
            <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void createTask(); }}>
              <div>
                <label htmlFor="project" className="mb-2 block text-sm font-medium">项目</label>
                <select id="project" value={projectId} disabled={creating} className="w-full rounded-lg border border-slate-300 p-2" onChange={(event) => {
                  setProjectId(event.target.value);
                  setQueryIds(options.projects.find((item) => item.id === event.target.value)?.queries.slice(0, 5).map((query) => query.id) ?? []);
                }}>
                  {options.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <fieldset disabled={creating}>
                <legend className="mb-2 text-sm font-medium">查询（已选 {queryIds.length} 项）</legend>
                {!project?.queries.length ? <p className="text-sm text-slate-500">该项目暂无查询，暂时无法创建任务。</p> : (
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
                    {project.queries.map((query) => (
                      <label key={query.id} className="flex items-start gap-2 text-sm">
                        <input className="mt-1" type="checkbox" checked={queryIds.includes(query.id)} onChange={() => toggle(query.id, queryIds, setQueryIds)} />
                        <span>{query.text}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <fieldset disabled={creating}>
                <legend className="mb-2 text-sm font-medium">模拟引擎（已选 {engineIds.length} 项）</legend>
                {!options.engines.length ? <p className="text-sm text-slate-500">暂无启用的模拟引擎。</p> : (
                  <div className="flex flex-wrap gap-4">
                    {options.engines.map((engine) => (
                      <label key={engine.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={engineIds.includes(engine.id)} onChange={() => toggle(engine.id, engineIds, setEngineIds)} />
                        {engine.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <p className="text-sm text-slate-500">本次共 {queryIds.length * engineIds.length} 次运行。</p>
              {createError && <p role="alert" className="text-sm text-red-700">{createError}</p>}
              <button type="submit" disabled={!canCreate} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{creating ? "正在创建…" : "创建监测任务"}</button>
            </form>
          )}
        </section>

        {taskId && (
          <section aria-labelledby="task-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 id="task-heading" className="text-lg font-semibold">任务进度</h2>
            <p className="mt-1 break-all text-xs text-slate-500">任务 ID：{taskId}</p>
            {pollError && <div role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>{pollError}</p><button type="button" className="mt-2 underline" onClick={() => setPollRetry((value) => value + 1)}>立即重试</button></div>}
            {!task ? <p role="status" className="mt-4 text-sm text-slate-500">正在读取任务…</p> : (
              <>
                <div role="status" className="mt-4 text-sm">
                  <p>{statusLabels[task.status] ?? task.status} · {task.progress}%</p>
                  <progress aria-label="任务完成进度" className="mt-2 h-3 w-full accent-blue-700" value={task.progress} max={100} />
                  <p className="mt-2 text-slate-500">共 {task.totalRuns} 次运行 · 已完成 {task.completedRuns} · 失败 {task.failedRuns}</p>
                </div>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">各查询与引擎的运行状态</caption>
                    <thead className="border-b border-slate-200 text-slate-500"><tr><th scope="col" className="p-2">查询</th><th scope="col" className="p-2">引擎</th><th scope="col" className="p-2">状态</th><th scope="col" className="p-2">尝试次数</th><th scope="col" className="p-2">错误</th></tr></thead>
                    <tbody>{task.runs.map((run) => <tr key={run.id} className="border-b border-slate-100 align-top"><td className="min-w-48 break-words p-2">{queries.get(run.queryId) ?? run.queryId}</td><td className="p-2">{engines.get(run.engineId) ?? run.engineId}</td><td className="whitespace-nowrap p-2">{statusLabels[run.status] ?? run.status}</td><td className="p-2">{run.attempt}</td><td className="max-w-80 break-words p-2 text-red-700">{[run.errorCode, run.errorMessage].filter(Boolean).join("：") || "—"}</td></tr>)}</tbody>
                  </table>
                  {!task.runs.length && <p className="py-4 text-sm text-slate-500">暂无运行记录。</p>}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
