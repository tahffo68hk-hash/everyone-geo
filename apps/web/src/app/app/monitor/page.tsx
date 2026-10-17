"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, EmptyState } from "@/components/ui";
import { EMPTY_TEXT, formatSourceType, formatStatus, friendlyError } from "@/lib/labels";
import { EvidenceDialog } from "./evidence-dialog";
import { TaskMetrics } from "./task-metrics";

type Options = {
  projects: Array<{ id: string; name: string; queries: Array<{ id: string; text: string }> }>;
  engines: Array<{
    id: string; key: string; name: string;
    provider: string; sourceType: string | null; model: string | null; configured: boolean;
  }>;
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
const buttonClass = "rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

function errorText(error: unknown) {
  return friendlyError(error);
}

export default function MonitorPage() {
  const { projectId: contextProjectId } = useProjectContext();
  const [options, setOptions] = useState<Options | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [queryIds, setQueryIds] = useState<string[]>([]);
  const [engineIds, setEngineIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
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
        const preferredId = (contextProjectId && data.projects.some((p) => p.id === contextProjectId))
          ? contextProjectId
          : (data.projects[0]?.id ?? "");
        setProjectId(preferredId);
        const preferredProject = data.projects.find((p) => p.id === preferredId);
        // 生产门禁：不默认勾选任何引擎，必须由用户明确选择
        setEngineIds([]);
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
      setSelectedRunId(null);
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
  const engines = new Map(options?.engines.map((engine) => [engine.id, engine] as const));
  const engineLabel = (engine: { name: string; provider: string }) => engine.provider === "mock" ? `${engine.name} · 演示数据` : `${engine.name} · 真实数据`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="GEO 持续监测"
        description="选择项目、检测问题与检测引擎（DeepSeek API 为真实模型服务，Mock 为模拟测试）创建任务并实时查看执行进度。"
      />

        <section aria-labelledby="create-heading" className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 id="create-heading" className="mb-4 text-lg font-semibold">创建任务</h2>
          {optionsLoading ? <p role="status">正在加载项目和引擎…</p> : optionsError ? (
            <div>
              <p role="alert" className="mb-3 text-sm text-red-700">{optionsError}</p>
              <button className={buttonClass} onClick={() => setOptionsRetry((value) => value + 1)}>重新加载</button>
              <Link href="/login" className="ml-4 text-sm text-blue-700 hover:underline">前往登录</Link>
            </div>
          ) : !options?.projects.length ? <p className="text-sm text-slate-500">{EMPTY_TEXT.projects}，请先加入有项目的组织。</p> : (
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
                <legend className="mb-2 text-sm font-medium">检测问题（已选 {queryIds.length} 项）</legend>
                {!project?.queries.length ? <p className="text-sm text-slate-500">{EMPTY_TEXT.queries}，暂时无法创建任务。</p> : (
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
              <fieldset disabled={creating} className="space-y-4">
                <legend className="mb-2 text-sm font-medium">检测引擎（已选 {engineIds.length} 项）</legend>
                {!options.engines.length ? (
                  <p className="text-sm text-slate-500">{EMPTY_TEXT.engines}</p>
                ) : (
                  <div className="space-y-4">
                    {/* 1. 正式监测引擎 */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-800">正式检测引擎（第三方 API 真实调用）</span>
                        <span className="text-[11px] text-slate-500">产生实际 API 费用</span>
                      </div>
                      {options.engines.filter((e) => e.provider !== "mock").length === 0 ||
                      options.engines.some((e) => e.provider !== "mock" && !e.configured) ? (
                        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 mb-2">
                          当前真实 AI 引擎未就绪（需配置 <code className="font-mono bg-white px-1 rounded">ENABLE_REAL_PROVIDERS=true</code> 且填入对应 API 密钥）。未配置时不可选。
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-4">
                        {options.engines.filter((e) => e.provider !== "mock").map((engine) => {
                          const unavailable = !engine.configured;
                          return (
                            <label key={engine.id} className={`flex items-center gap-2 text-sm ${unavailable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                              <input
                                type="checkbox"
                                disabled={unavailable}
                                checked={engineIds.includes(engine.id)}
                                onChange={() => toggle(engine.id, engineIds, setEngineIds)}
                              />
                              <span className="font-medium text-slate-800">{engine.name}</span>
                              <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${unavailable ? "bg-slate-200 text-slate-600" : "bg-blue-100 text-blue-800"}`}>
                                {unavailable ? "未配置密钥" : `真实数据 · ${formatSourceType(engine.sourceType)}`}
                              </span>
                              {engine.model ? <span className="text-xs text-slate-400 font-mono">{engine.model}</span> : null}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* 2. 离线模拟引擎 */}
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">开发测试模拟（离线 Mock / 零费用）</span>
                        <span className="text-[11px] text-slate-400">仅供开发调试与流程演练</span>
                      </div>
                      <p className="mb-2 text-[11px] text-slate-500">
                        离线模拟不会产生任何外部 API 调用或费用，结果仅为本地样例数据，不可用于正式 GEO 报告与商业决策。
                      </p>
                      <div className="flex flex-wrap gap-4">
                        {options.engines.filter((e) => e.provider === "mock").map((engine) => (
                          <label key={engine.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={engineIds.includes(engine.id)}
                              onChange={() => toggle(engine.id, engineIds, setEngineIds)}
                            />
                            <span className="text-slate-800">{engine.name}</span>
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                              开发模拟（Mock）
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </fieldset>
              {(() => {
                const selectedReal = (options?.engines || []).filter(e => engineIds.includes(e.id) && e.provider !== "mock");
                if (selectedReal.length === 0) return null;
                return (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-semibold">⚠️ 真实付费调用授权提示</p>
                    <p className="mt-0.5">您已勾选真实引擎（{selectedReal.map(e => e.name).join("、")}）。创建任务将向第三方大模型 API 发起实际付费调用，请确认您已获得授权并同意产生相应费用。</p>
                  </div>
                );
              })()}
              <p className="text-sm text-slate-500">本次共 {queryIds.length * engineIds.length} 次运行。</p>
              {createError && <p role="alert" className="text-sm text-red-700">{createError}</p>}
              {(() => {
                const selectedReal = (options?.engines || []).filter(e => engineIds.includes(e.id) && e.provider !== "mock");
                return (
                  <button type="submit" disabled={!canCreate} className="ui-button primary">
                    {creating ? "正在创建…" : selectedReal.length > 0 ? `创建监测任务（含 ${selectedReal.length} 个真实付费引擎）` : "创建监测任务（演示模拟）"}
                  </button>
                );
              })()}
            </form>
          )}
        </section>

        {taskId && (
          <section aria-labelledby="task-heading" className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 id="task-heading" className="text-lg font-semibold">任务进度</h2>
            <p className="mt-1 break-all text-xs text-slate-500">任务 ID：{taskId}</p>
            {pollError && <div role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>{pollError}</p><button type="button" className="mt-2 underline" onClick={() => setPollRetry((value) => value + 1)}>立即重试</button></div>}
            {!task ? <p role="status" className="mt-4 text-sm text-slate-500">正在读取任务…</p> : (
              <>
                <div role="status" className="mt-4 text-sm">
                  <p>{formatStatus(task.status)} · {task.progress}%</p>
                  <progress aria-label="任务完成进度" className="mt-2 h-3 w-full accent-blue-700" value={task.progress} max={100} />
                  <p className="mt-2 text-slate-500">共 {task.totalRuns} 次运行 · 已完成 {task.completedRuns} · 失败 {task.failedRuns}</p>
                </div>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">各查询与引擎的运行状态</caption>
                    <thead className="border-b border-slate-200 text-slate-500"><tr><th scope="col" className="p-2">检测问题</th><th scope="col" className="p-2">检测引擎</th><th scope="col" className="p-2">状态</th><th scope="col" className="p-2">尝试次数</th><th scope="col" className="p-2">错误</th><th scope="col" className="p-2">原始证据</th></tr></thead>
                    <tbody>{task.runs.map((run) => { const runEngine = engines.get(run.engineId); return <tr key={run.id} className="border-b border-slate-100 align-top"><td className="min-w-48 break-words p-2">{queries.get(run.queryId) ?? run.queryId}</td><td className="p-2">{runEngine ? engineLabel(runEngine) : run.engineId}</td><td className="whitespace-nowrap p-2">{formatStatus(run.status)}</td><td className="p-2">{run.attempt}</td><td className="max-w-80 break-words p-2 text-red-700">{[run.errorCode, run.errorMessage].filter(Boolean).join("：") || "—"}</td><td className="p-2"><button type="button" className="whitespace-nowrap text-blue-700 underline" onClick={() => setSelectedRunId(run.id)} aria-label={`查看运行证据：${queries.get(run.queryId) ?? run.queryId} · ${runEngine ? engineLabel(runEngine) : run.engineId}`}>查看证据</button></td></tr>; })}</tbody>
                  </table>
                  {!task.runs.length && <p className="py-4 text-sm text-slate-500">{EMPTY_TEXT.runs}</p>}
                </div>
              </>
            )}
          </section>
        )}
        {taskId && <TaskMetrics key={taskId} taskId={taskId} taskStatus={task?.status} />}
        {selectedRunId && <EvidenceDialog key={selectedRunId} runId={selectedRunId} onClose={() => setSelectedRunId(null)} />}
    </div>
  );
}
