"use client";

import { useEffect, useState } from "react";
import {
  createRetestRun,
  getAssetOutcomeWorkspace,
  listVerificationAssets,
  processRetestRun,
  type AssetOutcomeWorkspace,
  type VerificationAssetListItem,
} from "@/lib/outcome-api";
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

  async function loadWorkspace(assetId: string) {
    try {
      setLoadingWorkspace(true);
      setError(null);
      const res = await getAssetOutcomeWorkspace(assetId);
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

  async function handleTriggerRetest(assetId: string) {
    try {
      setRerunningRetest(true);
      setFeedback("正在发起 GEO 复测任务…");
      const retest = await createRetestRun(assetId, true);
      setFeedback("复测任务已创建，正在执行模拟评测…");
      await processRetestRun(retest.id);
      setFeedback("GEO 复测执行完成，正在刷新数据…");
      await loadAssetsList();
      if (selectedAssetId === assetId) {
        await loadWorkspace(assetId);
      }
      setFeedback("GEO 复测已完成并更新归因分析。");
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      setError(err?.message || "触发 GEO 复测失败");
    } finally {
      setRerunningRetest(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* 顶部标题与说明 */}
      {!selectedAssetId && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">效果验证与归因工作台</h1>
              <p className="mt-1 text-xs text-slate-500 max-w-2xl leading-relaxed">
                追踪已发布落地资产的 GEO 复测表现、测试条件一致性、前后评测观测事实与归因关联推断。
              </p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadAssetsList()}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition"
            >
              刷新列表
            </button>
          </div>
        </div>
      )}

      {/* 反馈通知 */}
      {feedback && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 flex items-center justify-between animate-fadeIn">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-blue-500 hover:text-blue-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-500 hover:text-rose-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* 主视图切换 */}
      {selectedAssetId && workspaceData ? (
        loadingWorkspace ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-700 border-r-transparent align-[-0.125em]" />
            <p className="mt-4 text-xs text-slate-500">正在加载效果验证与归因明细…</p>
          </div>
        ) : (
          <AssetOutcomeOverview
            workspace={workspaceData}
            onBack={() => {
              setSelectedAssetId(null);
              setWorkspaceData(null);
              void loadAssetsList();
            }}
            onRerunRetest={() => void handleTriggerRetest(selectedAssetId)}
            isRerunning={rerunningRetest}
          />
        )
      ) : loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-700 border-r-transparent align-[-0.125em]" />
          <p className="mt-4 text-xs text-slate-500">正在加载已发布落地资产与复测数据…</p>
        </div>
      ) : (
        <PublishedAssetsTable
          assets={assets}
          onSelectAsset={(id) => void handleSelectAsset(id)}
          onTriggerRetest={(id) => void handleTriggerRetest(id)}
          isTriggering={rerunningRetest}
        />
      )}
    </div>
  );
}
