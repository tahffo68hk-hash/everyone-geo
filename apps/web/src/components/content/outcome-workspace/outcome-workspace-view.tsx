"use client";

import { useEffect, useState } from "react";
import {
  createRetestRun,
  generateRetestOutcomes,
  getAssetOutcomeWorkspace,
  listVerificationAssets,
  processRetestRun,
  type AssetOutcomeWorkspace,
  type VerificationAssetListItem,
} from "@/lib/outcome-api";
import { api } from "@/lib/api";
import { PageHeader, LoadingSkeleton } from "@/components/ui";
import { PublishedAssetsTable } from "./published-assets-table";
import { AssetOutcomeOverview } from "./asset-outcome-overview";

interface OutcomeWorkspaceViewProps {
  projectId: string;
  initialAssetId?: string;
}

export function OutcomeWorkspaceView({
  projectId,
  initialAssetId,
}: OutcomeWorkspaceViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<VerificationAssetListItem[]>([]);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    initialAssetId || null
  );
  const [workspaceData, setWorkspaceData] = useState<AssetOutcomeWorkspace | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [rerunningRetest, setRerunningRetest] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function loadAssetsList() {
    if (!projectId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await listVerificationAssets(projectId);
      setAssets(res.items);
    } catch (err: any) {
      setError(err?.message || "无法加载效果验证落地资产列表");
    } finally {
      setLoading(false);
    }
  }

  async function loadWorkspace(assetId: string, retestRunId?: string) {
    try {
      setLoadingWorkspace(true);
      setError(null);
      const res = await getAssetOutcomeWorkspace(assetId, retestRunId);
      setWorkspaceData(res);
      setSelectedAssetId(assetId);
    } catch (err: any) {
      setError(err?.message || "无法加载该资产的效果验证与归因明细");
    } finally {
      setLoadingWorkspace(false);
    }
  }

  useEffect(() => {
    void loadAssetsList();
  }, [projectId]);

  useEffect(() => {
    if (initialAssetId) {
      void loadWorkspace(initialAssetId);
    }
  }, [initialAssetId]);

  async function handleSelectAsset(assetId: string) {
    await loadWorkspace(assetId);
  }

  const [queryModalAssetId, setQueryModalAssetId] = useState<string | null>(null);
  const [projectQueries, setProjectQueries] = useState<Array<{ id: string; text: string }>>([]);
  const [selectedQueryIds, setSelectedQueryIds] = useState<string[]>([]);
  const [loadingQueries, setLoadingQueries] = useState(false);

  async function openQuerySelector(assetId: string) {
    setQueryModalAssetId(assetId);
    setLoadingQueries(true);
    try {
      const res = await api<{ items: Array<{ id: string; text: string }> }>(`/projects/${projectId}/queries`);
      const items = res.items || [];
      setProjectQueries(items);
      if (items.length > 0) {
        setSelectedQueryIds([items[0].id]);
      }
    } catch {
      setProjectQueries([]);
    } finally {
      setLoadingQueries(false);
    }
  }

  async function handleTriggerRetest(assetId: string, explicitQueryIds?: string[]) {
    if (rerunningRetest) return; // 防重复提交
    try {
      setRerunningRetest(true);
      setError(null);
      setFeedback("正在发起 GEO 复测任务…");
      const retest = await createRetestRun(assetId, true, true, explicitQueryIds);
      let runStatus = retest.status;
      if (runStatus !== "COMPLETED") {
        setFeedback("复测任务已排队，正在执行评测采信…");
        const execRes = await processRetestRun(retest.id);
        runStatus = execRes?.status || "COMPLETED";
      }

      if (runStatus === "COMPLETED" || runStatus === "PARTIAL") {
        setFeedback("复测已完成，正在生成前后评测对比快照…");
        try {
          await generateRetestOutcomes(retest.id);
        } catch (outcomeErr) {
          console.warn("自动生成 Outcome 对比失败，等待后端异步聚合", outcomeErr);
        }
      }

      setFeedback("数据刷新中…");
      await loadAssetsList();
      if (selectedAssetId === assetId) {
        await loadWorkspace(assetId, retest.id);
      }

      if (runStatus === "COMPLETED") {
        setFeedback("GEO 复测与对比分析已完成，最新对比与归因数据已就绪。");
      } else if (runStatus === "PARTIAL") {
        setFeedback("GEO 复测部分完成，部分条目已就绪，可查看阶段结果。");
      } else if (runStatus === "FAILED") {
        setFeedback("GEO 复测执行失败，请检查模型接入与网络配置。");
      } else {
        setFeedback("GEO 复测任务已处理，正在等待最终归因。");
      }
      setTimeout(() => setFeedback(null), 4000);
      setQueryModalAssetId(null);
    } catch (err: any) {
      if (err?.message?.includes("无法从发布资产血缘中推导") || err?.message?.includes("queryIds")) {
        // DIST-07: 普通独立稿无推导血缘时，拉起查询选择弹窗供用户勾选
        setError(null);
        void openQuerySelector(assetId);
      } else {
        setError(err?.message || "触发 GEO 复测失败");
      }
    } finally {
      setRerunningRetest(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 顶部标题与说明 */}
      {!selectedAssetId && (
        <PageHeader
          title="效果验证与归因工作台"
          description="追踪已发布落地资产的 GEO 复测表现、测试条件一致性、前后评测观测事实与归因关联推断。"
          actions={
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadAssetsList()}
              className="ui-button text-xs"
            >
              刷新列表
            </button>
          }
        />
      )}

      {/* 反馈通知 */}
      {feedback && (
        <div className="surface p-3 text-xs text-teal-900 border-teal-200 bg-teal-50/80 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">✓</span> {feedback}
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-teal-600 hover:text-teal-800 text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="surface p-3 text-xs text-rose-800 border-rose-200 bg-rose-50/80 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-600 hover:text-rose-800 text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* 主视图切换 */}
      {selectedAssetId && workspaceData ? (
        loadingWorkspace ? (
          <LoadingSkeleton rows={5} />
        ) : (
          <AssetOutcomeOverview
            workspace={workspaceData}
            onBack={() => {
              setSelectedAssetId(null);
              setWorkspaceData(null);
              void loadAssetsList();
            }}
            onSelectRun={(runId) => void loadWorkspace(selectedAssetId, runId)}
            onRerunRetest={() => void handleTriggerRetest(selectedAssetId)}
            isRerunning={rerunningRetest}
          />
        )
      ) : loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <PublishedAssetsTable
          assets={assets}
          onSelectAsset={(id) => void handleSelectAsset(id)}
          onTriggerRetest={(id) => void handleTriggerRetest(id)}
          isTriggering={rerunningRetest}
        />
      )}

      {/* DIST-07: 独立普通稿发起复测时的 Query 选择弹窗 */}
      {queryModalAssetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4 border border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>🎯</span> 选择 GEO 复测评测问题
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                该发布内容为独立发布稿件，无预设策略血缘。请勾选本项目中的评测问题集以执行对比测量。
              </p>
            </div>

            {loadingQueries ? (
              <LoadingSkeleton rows={3} />
            ) : projectQueries.length === 0 ? (
              <div className="text-xs text-slate-500 p-4 text-center bg-slate-50 rounded-lg">
                本项目下暂无已录入的评测问题，请先在【问题集库】创建基准问题。
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-1.5 border border-slate-200 rounded-lg p-2.5">
                {projectQueries.map((q) => {
                  const checked = selectedQueryIds.includes(q.id);
                  return (
                    <label
                      key={q.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-slate-850"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedQueryIds((prev) =>
                            checked ? prev.filter((id) => id !== q.id) : [...prev, q.id]
                          );
                        }}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                      />
                      <span className="truncate">{q.text}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setQueryModalAssetId(null)}
                className="ui-button secondary text-xs py-1.5 px-3"
              >
                取消
              </button>
              <button
                type="button"
                disabled={rerunningRetest || selectedQueryIds.length === 0}
                onClick={() => handleTriggerRetest(queryModalAssetId, selectedQueryIds)}
                className="ui-button primary text-xs py-1.5 px-4 font-semibold"
              >
                {rerunningRetest ? "启动中…" : `确认发起复测 (${selectedQueryIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
