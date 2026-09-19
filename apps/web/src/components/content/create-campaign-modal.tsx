"use client";

import { useEffect, useState } from "react";
import {
  createContentCampaign,
  type ContentCampaign,
  type ContentStrategy,
} from "@/lib/content-api";
import { friendlyError } from "@/lib/labels";
import { useProjectContext } from "@/components/project-context";

interface CreateCampaignModalProps {
  strategies: ContentStrategy[];
  initialStrategyId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (campaign: ContentCampaign) => void;
}

export function CreateCampaignModal({
  strategies,
  initialStrategyId,
  isOpen,
  onClose,
  onCreated,
}: CreateCampaignModalProps) {
  const { projectId } = useProjectContext();
  const [strategyId, setStrategyId] = useState<string>("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [primaryGeoGap, setPrimaryGeoGap] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      const selectedId = initialStrategyId || (strategies.length > 0 ? strategies[0].id : "");
      setStrategyId(selectedId);

      const targetStrat = strategies.find((s) => s.id === selectedId);
      if (targetStrat) {
        setName(`${targetStrat.title} 营销战役`);
        setObjective(targetStrat.perceptionGoal || targetStrat.targetAudience || "GEO 品牌可见度与推荐率提升");
        setPrimaryGeoGap(targetStrat.geoGap || "GEO Visibility Gap");
      } else {
        setName("");
        setObjective("");
        setPrimaryGeoGap("");
      }

      const today = new Date();
      const inTwoWeeks = new Date(today.getTime() + 14 * 86400000);
      setStartDate(today.toISOString().slice(0, 10));
      setEndDate(inTwoWeeks.toISOString().slice(0, 10));
      setTimezone("Asia/Shanghai");
      setError("");
    }
  }, [isOpen, initialStrategyId, strategies]);

  function handleStrategyChange(id: string) {
    setStrategyId(id);
    const targetStrat = strategies.find((s) => s.id === id);
    if (targetStrat) {
      setName(`${targetStrat.title} 营销战役`);
      setObjective(targetStrat.perceptionGoal || targetStrat.targetAudience || "GEO 品牌可见度与推荐率提升");
      setPrimaryGeoGap(targetStrat.geoGap || "GEO Visibility Gap");
    }
  }

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!strategyId || !projectId) {
      setError("请选择有效的来源内容战略");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const campaign = await createContentCampaign({
        strategyId,
        projectId,
        name: name.trim() || undefined,
        objective: objective.trim() || undefined,
        primaryGeoGap: primaryGeoGap.trim() || undefined,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
      });
      onCreated(campaign);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-campaign-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <span className="inline-flex items-center gap-1 rounded bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-800">
              战役实例化
            </span>
            <h3 id="create-campaign-modal-title" className="mt-1 text-lg font-bold text-slate-900">
              创建运营战役 (Campaign)
            </h3>
            <p className="text-xs text-slate-500">
              基于选定的内容战略自动实例化为可执行营销战役，并一键生成全矩阵初始生产排期。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭弹窗"
          >
            ✕
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="strategy-select" className="block text-xs font-semibold text-slate-700">
              关联来源内容战略 (Strategy) *
            </label>
            <select
              id="strategy-select"
              required
              value={strategyId}
              onChange={(e) => handleStrategyChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
            >
              {strategies.length === 0 && <option value="">暂无可用内容战略，请先生成战略</option>}
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({new Date(s.createdAt).toLocaleDateString("zh-CN")})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="campaign-name-input" className="block text-xs font-semibold text-slate-700">
              战役名称 *
            </label>
            <input
              id="campaign-name-input"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：PawClean 2026 秋季新品推广战役"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="campaign-start-input" className="block text-xs font-semibold text-slate-700">
                战役开始日期
              </label>
              <input
                id="campaign-start-input"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label htmlFor="campaign-end-input" className="block text-xs font-semibold text-slate-700">
                战役结束日期
              </label>
              <input
                id="campaign-end-input"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="campaign-objective-input" className="block text-xs font-semibold text-slate-700">
                战役核心目标 (自动自战略同步)
              </label>
              <input
                id="campaign-objective-input"
                type="text"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="例如：提升 AI 问答推荐率"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label htmlFor="campaign-timezone-select" className="block text-xs font-semibold text-slate-700">
                排期基准时区
              </label>
              <select
                id="campaign-timezone-select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
              >
                <option value="Asia/Shanghai">Asia/Shanghai (北京时间 GMT+8)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (东京时间 GMT+9)</option>
                <option value="UTC">UTC (世界协调时)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="campaign-gap-input" className="block text-xs font-semibold text-slate-700">
              主要解决的 GEO 缺口 (Gap)
            </label>
            <textarea
              id="campaign-gap-input"
              rows={2}
              value={primaryGeoGap}
              onChange={(e) => setPrimaryGeoGap(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={creating || strategies.length === 0}
              className="rounded-lg bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 shadow-xs disabled:opacity-50"
            >
              {creating ? "正在实例化战役…" : "确认创建战役"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
