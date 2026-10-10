"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useProjectContext } from "@/components/project-context";
import { api } from "@/lib/api";
import { PageHeader, LoadingSkeleton, EmptyState, SaaSCard } from "@/components/ui";
import {
  formatVersion, friendlyError, formatTargetEntityType, QUERY_WORKSPACE_NAV,
} from "@/lib/labels";
import { AiActionButton } from "@/components/ai/ai-action-button";
import { AiGenerationModal } from "@/components/ai/ai-generation-modal";
import { generateAiQuerySet, detectAiGeoTopics, type AiResponseMeta } from "@/lib/ai-api";

type TargetBrief = {
  brandId: string | null; canonicalName: string; entityType: string;
  productCategory: string | null; aliases: Array<{ alias: string; enabled: boolean }>;
};
type Suite = {
  id: string; name: string; version: string; description: string | null; status: string;
  queryCount: number; discoveryCount: number; sanityQueryCount: number; customCount: number;
  createdAt: string;
};

export default function QueriesPage() {
  const { projectId, loading: projectLoading } = useProjectContext();
  const [target, setTarget] = useState<TargetBrief | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newSuite, setNewSuite] = useState({ name: "", version: "1" });

  // AI 智能状态
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiModalType, setAiModalType] = useState<"queryset" | "geotopic">("queryset");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProvider, setAiProvider] = useState<"auto" | "deepseek" | "qwen">("auto");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<AiResponseMeta | null>(null);
  const [aiQueryResult, setAiQueryResult] = useState<{
    querySetName: string;
    description: string;
    queries: Array<{ text: string; category: string; intent: string; queryType: string; rationale: string }>;
  } | null>(null);
  const [aiGeoResult, setAiGeoResult] = useState<{
    coreTopics: string[];
    geoTopics: Array<{ name: string; description: string; userIntent: string; importance: string }>;
    entities: Array<{ name: string; type: string; aliases: string[] }>;
    comparisonDimensions: string[];
    decisionDimensions: string[];
  } | null>(null);

  async function handleAiGenerateQuerySet() {
    if (!projectId) return;
    setAiModalType("queryset");
    setIsAiModalOpen(true);
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await generateAiQuerySet(projectId, {
        provider: aiProvider,
        brandName: target?.canonicalName || "",
        category: target?.productCategory || "企业级行业软件",
        queryCount: 6,
      });
      setAiMeta(res);
      setAiQueryResult(res.data);
    } catch (e: any) {
      setAiError(e?.message || "AI 生成问题集失败");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiDetectGeo() {
    if (!projectId) return;
    setAiModalType("geotopic");
    setIsAiModalOpen(true);
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await detectAiGeoTopics(projectId, {
        provider: aiProvider,
        brandName: target?.canonicalName || "",
        category: target?.productCategory || "",
      });
      setAiMeta(res);
      setAiGeoResult(res.data);
    } catch (e: any) {
      setAiError(e?.message || "AI 检测 GEO 失败");
    } finally {
      setAiLoading(false);
    }
  }

  async function applyAiQuerySet() {
    if (!aiQueryResult || !projectId) return;
    setAiLoading(true);
    try {
      await api(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`, {
        method: "POST",
        body: JSON.stringify({
          name: aiQueryResult.querySetName,
          version: "1",
          queries: aiQueryResult.queries.map(q => ({
            // AI 预览使用 text；Benchmark Suite API 的持久化契约使用 queryText。
            queryText: q.text,
            category: q.category === "行业选型"
              ? "tool-discovery"
              : q.category === "痛点解决"
                ? "pain-point"
                : q.category === "竞品对比"
                  ? "comparison"
                  : q.category === "品牌基线"
                    ? "sanity-control"
                    : "workflow",
            intent: q.intent,
            queryType: q.queryType === "DISCOVERY" ? "DISCOVERY" : "BRANDED_SANITY",
          })),
        }),
      });
      setIsAiModalOpen(false);
      await load();
    } catch (e: any) {
      setAiError(e?.message || "写入问题集失败");
    } finally {
      setAiLoading(false);
    }
  }

  async function load(signal?: AbortSignal) {
    if (!projectId) return;
    setError("");
    try {
      const [t, s] = await Promise.all([
        api<TargetBrief | null>(`/projects/${encodeURIComponent(projectId)}/target-profile`, { signal }),
        api<Suite[]>(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`, { signal }),
      ]);
      setTarget(t); setSuites(s);
    } catch (e) { if (!signal?.aborted) setError(friendlyError(e)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function createSuite() {
    if (!newSuite.name.trim() || !projectId) return;
    setBusy(true); setError("");
    try {
      await api(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`, {
        method: "POST",
        body: JSON.stringify({ name: newSuite.name.trim(), version: newSuite.version, queries: [] }),
      });
      setNewSuite({ name: "", version: "1" });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  if (projectLoading) return <LoadingSkeleton rows={6} />;
  if (!projectId) {
    return (
      <EmptyState
        title="请先选择监测项目"
        description="选择或创建项目后，方可管理该项目的问题集与评测场景。"
        href="/app/projects/new"
        action="新建监测项目"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={QUERY_WORKSPACE_NAV.title}
        description={QUERY_WORKSPACE_NAV.pageHint}
      />

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {/* 监测对象状态 */}
      <section className={`rounded-xl border p-4 text-xs transition-all ${
        target?.brandId
          ? "border-indigo-100 bg-gradient-to-r from-indigo-50/60 via-purple-50/30 to-white text-slate-800 shadow-xs"
          : "border-amber-200 bg-amber-50/60 text-amber-950 shadow-xs"
      }`}>
        {target?.brandId ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-bold text-slate-900 text-sm">监测品牌：{target.canonicalName}</span>
            </div>
            <span className="rounded-md border border-indigo-200/60 bg-indigo-50/80 px-2 py-0.5 font-medium text-indigo-700">
              {formatTargetEntityType(target.entityType)}
            </span>
            {target.productCategory && (
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-600">
                品类：{target.productCategory}
              </span>
            )}
            {target.aliases.filter(a => a.enabled).length > 0 && (
              <span className="text-slate-500">
                别名：{target.aliases.filter(a => a.enabled).map(a => a.alias).join("、")}
              </span>
            )}
            <Link
              href={`/app/target?project=${projectId}`}
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              配置监测对象 →
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-amber-900">{QUERY_WORKSPACE_NAV.emptyHint}</span>
            <Link href={`/app/target?project=${projectId}`} className="ui-button primary compact">
              设置监测对象 →
            </Link>
          </div>
        )}
      </section>

      {/* 新建问题集与 AI 智能构建 */}
      <SaaSCard
        title="基准测试问题集与 AI 智能构建"
        subtitle="管理不同意图维度的提问基准，支持通过大模型一键自动生成高意图行业问题"
        actions={
          <div className="flex items-center gap-2">
            <AiActionButton
              label="AI 生成问题集"
              onClick={() => handleAiGenerateQuerySet()}
              loading={aiLoading && aiModalType === "queryset"}
            />
            <AiActionButton
              label="AI GEO 检测"
              variant="subtle"
              onClick={() => handleAiDetectGeo()}
              loading={aiLoading && aiModalType === "geotopic"}
            />
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={newSuite.name}
              onChange={e => setNewSuite({ ...newSuite, name: e.target.value })}
              placeholder="问题集名称，如：行业选型发现 / 核心竞品对比"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs w-72 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-hidden transition"
              aria-label="问题集名称"
            />
            <input
              value={newSuite.version}
              onChange={e => setNewSuite({ ...newSuite, version: e.target.value })}
              placeholder="版本，例如 1"
              className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-hidden transition"
              aria-label="版本"
            />
            <button
              type="button"
              onClick={() => void createSuite()}
              disabled={busy || !newSuite.name.trim()}
              className="ui-button primary"
            >
              {busy ? "创建中…" : QUERY_WORKSPACE_NAV.create}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">{QUERY_WORKSPACE_NAV.discoveryNote}</p>
        </div>
      </SaaSCard>

      {/* AI 生成预览与确认弹窗 */}
      <AiGenerationModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        title={aiModalType === "queryset" ? "AI 智能问题集生成" : "AI GEO 主题与语义检测"}
        description={aiModalType === "queryset" ? "基于品牌与品类场景生成，发现型提问严格不含品牌名" : "检测核心 GEO 主题、实体与对比决策维度"}
        loading={aiLoading}
        error={aiError}
        meta={aiMeta}
        provider={aiProvider}
        onProviderChange={setAiProvider}
        onRegenerate={aiModalType === "queryset" ? () => handleAiGenerateQuerySet() : () => handleAiDetectGeo()}
        onApply={aiModalType === "queryset" ? () => void applyAiQuerySet() : undefined}
        applyLabel="应用并创建此问题集"
      >
        {aiModalType === "queryset" && aiQueryResult && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-xs text-slate-500 font-medium">推荐问题集名称：</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">{aiQueryResult.querySetName}</p>
              <p className="text-xs text-slate-500 mt-1">{aiQueryResult.description}</p>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-700">生成的问题列表（预览确认后方可写入）：</span>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {aiQueryResult.queries.map((q, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${q.queryType === "DISCOVERY" ? "bg-teal-50 text-teal-700 border border-teal-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                        {q.queryType === "DISCOVERY" ? "自然发现型 (不含品牌)" : "品牌基线型"}
                      </span>
                      <span className="text-slate-400 text-[11px]">{q.category} · {q.intent}</span>
                    </div>
                    <p className="text-slate-800 font-medium text-sm mt-1">{q.text}</p>
                    <p className="text-slate-500 text-[11px] mt-0.5">入选依据：{q.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {aiModalType === "geotopic" && aiGeoResult && (
          <div className="space-y-4">
            <div>
              <span className="text-xs font-semibold text-slate-700">核心业务主题：</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {aiGeoResult.coreTopics.map((ct, idx) => (
                  <span key={idx} className="px-2.5 py-1 rounded bg-slate-100 text-slate-800 text-xs border border-slate-300">
                    {ct}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-700">GEO 搜索细分主题：</span>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {aiGeoResult.geoTopics.map((gt, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">{gt.name}</span>
                      <span className="text-[10px] text-slate-500">意图：{gt.userIntent}</span>
                    </div>
                    <p className="text-slate-500 text-[11px] mt-1">{gt.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[11px] font-semibold text-slate-500">重点对比维度</span>
                <p className="text-xs text-slate-700 mt-1">{aiGeoResult.comparisonDimensions.join("、")}</p>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[11px] font-semibold text-slate-500">购买决策维度</span>
                <p className="text-xs text-slate-700 mt-1">{aiGeoResult.decisionDimensions.join("、")}</p>
              </div>
            </div>
          </div>
        )}
      </AiGenerationModal>

      {/* 问题集列表 */}
      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : suites.length === 0 ? (
        <EmptyState
          title="暂无测试问题集"
          description={QUERY_WORKSPACE_NAV.emptyHint}
        />
      ) : (
        <div className="surface overflow-hidden">
          <div className="section-heading">
            <h2>
              <span>基准测试问题集列表</span>
              <span className="text-xs font-normal text-slate-400">（共 {suites.length} 个版本基准）</span>
            </h2>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">基准问题集列表</caption>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>版本</th>
                  <th>有效问题数</th>
                  <th>自然发现提问</th>
                  <th>品牌基线提问</th>
                  <th>自定义扩展</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {suites.map(s => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/app/queries/${s.id}`} className="font-semibold text-slate-900 hover:text-indigo-600 transition">
                        {s.name}
                      </Link>
                      {s.description && (
                        <small>{s.description}</small>
                      )}
                    </td>
                    <td>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        {formatVersion(s.version)}
                      </span>
                    </td>
                    <td>
                      <span className="font-bold tabular-nums text-slate-900">{s.queryCount}</span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {s.discoveryCount}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {s.sanityQueryCount}
                      </span>
                    </td>
                    <td>
                      <span className="text-slate-600 font-medium tabular-nums">{s.customCount}</span>
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/app/queries/${s.id}`}
                        className="ui-button secondary compact"
                      >
                        管理题目 →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
