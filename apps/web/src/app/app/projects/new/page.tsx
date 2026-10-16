"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { friendlyError, formatTargetEntityType } from "@/lib/labels";

type MeResponse = {
  user: { id: string };
  organizations: Array<{ id: string; name: string; slug: string; role: string }>;
};
type Project = { id: string; name: string; organizationId: string; status: string };
type Alias = { id: string | null; alias: string; aliasType: string; enabled: boolean };
type Target = {
  projectId: string; brandId: string | null; canonicalName: string;
  entityType: string; productCategory: string | null; website: string | null;
  description: string | null; aliases: Alias[];
};
type PreviewRow = { text: string; queryType: string; targetCheck: string; matchedAlias: string | null };

const STEPS = ["项目信息", "监测对象", "问题集"] as const;

function NewProjectInner() {
  const params = useSearchParams();
  const orgParam = params.get("org") ?? "";
  const [orgs, setOrgs] = useState<MeResponse["organizations"]>([]);
  const [orgId, setOrgId] = useState(orgParam);

  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Step1 — 项目
  const [form, setForm] = useState({ name: "", description: "", industry: "" });
  const [project, setProject] = useState<Project | null>(null);

  // Step2 — 监测对象（复用 M8E Target Profile / Brand / TargetEntityAlias）
  const [targetForm, setTargetForm] = useState({ canonicalName: "", entityType: "PRODUCT", productCategory: "", website: "", description: "" });
  const [target, setTarget] = useState<Target | null>(null);
  const [newAlias, setNewAlias] = useState("");

  // Step3 — 问题集（复用 BenchmarkSuite / BenchmarkQuery）
  const [suiteName, setSuiteName] = useState("");
  const [importText, setImportText] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [undoRows, setUndoRows] = useState<PreviewRow[] | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    api<MeResponse>("/auth/me")
      .then((d) => {
        setOrgs(d.organizations);
        if (!orgId && d.organizations[0]) setOrgId(d.organizations[0]!.id);
      })
      .catch((e) => setError(friendlyError(e)));
  }, []);

  const goError = (e: unknown) => setError(friendlyError(e));

  // ---------- Step 1 ----------
  async function createProject() {
    if (!orgId) { setError("请先选择所属组织。"); return; }
    const name = form.name.trim();
    if (!name) { setError("请填写项目名称。"); return; }
    setBusy(true); setError("");
    try {
      const created = await api<Project>(`/organizations/${encodeURIComponent(orgId)}/projects`, {
        method: "POST",
        body: JSON.stringify({
          name,
          description: form.description.trim() || null,
          industry: form.industry.trim() || null,
        }),
      });
      setProject(created);
      setSuiteName(`${name} 默认问题集`);
      setStep(1);
    } catch (e) { goError(e); }
    finally { setBusy(false); }
  }

  // ---------- Step 2 ----------
  async function loadTarget() {
    if (!project) return;
    setError("");
    try {
      const t = await api<Target | null>(`/projects/${project.id}/target-profile`);
      setTarget(t);
      setTargetForm({
        canonicalName: t?.canonicalName ?? "", entityType: t?.entityType ?? "PRODUCT",
        productCategory: t?.productCategory ?? "", website: t?.website ?? "", description: t?.description ?? "",
      });
    } catch (e) { goError(e); }
  }
  useEffect(() => { if (step === 1 && project) void loadTarget(); }, [step, project]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveTarget() {
    if (!project) return;
    const canonicalName = targetForm.canonicalName.trim();
    if (!canonicalName) { setError("请填写监测对象（品牌 / 产品名称）。"); return; }
    setBusy(true); setError("");
    try {
      const t = await api<Target>(`/projects/${project.id}/target-profile`, {
        method: "PUT",
        body: JSON.stringify({
          canonicalName,
          entityType: targetForm.entityType,
          productCategory: targetForm.productCategory.trim() || null,
          website: targetForm.website.trim() || null,
          description: targetForm.description.trim() || null,
        }),
      });
      setTarget(t);
      setNotice("监测对象已保存。");
    } catch (e) { goError(e); }
    finally { setBusy(false); }
  }

  async function nextFromTarget() {
    if (!project) return;
    if (!target?.canonicalName) {
      const canonicalName = targetForm.canonicalName.trim();
      if (!canonicalName) { setError("请先填写并保存监测对象（品牌 / 产品名称）。"); return; }
      setBusy(true); setError("");
      try {
        const t = await api<Target>(`/projects/${project.id}/target-profile`, {
          method: "PUT",
          body: JSON.stringify({
            canonicalName,
            entityType: targetForm.entityType,
            productCategory: targetForm.productCategory.trim() || null,
            website: targetForm.website.trim() || null,
            description: targetForm.description.trim() || null,
          }),
        });
        setTarget(t);
      } catch (e) { goError(e); return; }
      finally { setBusy(false); }
    }
    setStep(2);
  }

  async function addAlias() {
    if (!project) return;
    const alias = newAlias.trim();
    if (!alias) return;
    setBusy(true); setError("");
    try {
      await api(`/projects/${project.id}/target-aliases`, {
        method: "POST", body: JSON.stringify({ alias, aliasType: "CUSTOM" }),
      });
      setNewAlias("");
      await loadTarget();
    } catch (e) { goError(e); }
    finally { setBusy(false); }
  }

  async function toggleAlias(a: Alias, enabled: boolean) {
    if (!a.id || !project) return;
    setBusy(true);
    try {
      await api(`/target-aliases/${a.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      await loadTarget();
    } catch (e) { goError(e); }
    finally { setBusy(false); }
  }

  async function deleteAlias(a: Alias) {
    if (!a.id || !project) return;
    setBusy(true);
    try {
      await api(`/target-aliases/${a.id}`, { method: "DELETE" });
      await loadTarget();
    } catch (e) { goError(e); }
    finally { setBusy(false); }
  }

  // ---------- Step 3 ----------
  // AI 一键生成并导入问题集
  async function generateAiQuerySet() {
    if (!project) return;
    setAiGenerating(true);
    setError("");
    setNotice("");
    try {
      // 1. 若监测对象未持久化，先自动保存
      if (!target?.canonicalName) {
        const canonicalName = targetForm.canonicalName.trim();
        if (!canonicalName) {
          setError("请先设置并保存监测对象（品牌 / 产品名称）。");
          setAiGenerating(false);
          return;
        }
        const savedTarget = await api<Target>(`/projects/${project.id}/target-profile`, {
          method: "PUT",
          body: JSON.stringify({
            canonicalName,
            entityType: targetForm.entityType,
            productCategory: targetForm.productCategory.trim() || null,
            website: targetForm.website.trim() || null,
            description: targetForm.description.trim() || null,
          }),
        });
        setTarget(savedTarget);
      }

      // 2. 聚拢前两步填写的全部有效字段
      const brandName = targetForm.canonicalName.trim();
      const category = targetForm.productCategory.trim() || form.industry.trim() || "行业品类";
      const descParts = [form.description.trim(), targetForm.description.trim()].filter(Boolean);
      const competitors = target?.aliases?.map((a) => a.alias).filter(Boolean) ?? [];

      const res = await api<{
        data?: {
          querySetName?: string;
          queries?: Array<{
            text: string;
            category?: string;
            intent?: string;
            queryType?: string;
            rationale?: string;
          }>;
        };
        provider?: string;
        model?: string;
      }>(`/projects/${project.id}/ai/query-set`, {
        method: "POST",
        body: JSON.stringify({
          brandName,
          productName: brandName,
          category,
          businessDesc: descParts.join("；") || undefined,
          scenarios: form.industry.trim() || category,
          competitors: competitors.length > 0 ? competitors : undefined,
          queryCount: 8,
          provider: "auto",
        }),
      });

      const queries = res.data?.queries ?? [];
      if (queries.length === 0) {
        throw new Error("AI 未能返回有效问题，请重试或在下方直接手动录入。");
      }

      // 3. 严格去重、空值过滤、长度过滤 (5-200字符) 与品牌词复检
      const currentTexts = new Set(previewRows.map((r) => r.text.trim().toLowerCase()));
      const brandKeywords = [brandName.toLowerCase(), ...competitors.map((c) => c.toLowerCase())];
      const orgMatch = brandName.match(/^(.*?(?:大学|学院|学校|研究所|研究院|集团|科技|软件|电子))/);
      if (orgMatch && orgMatch[1] && orgMatch[1].length >= 3) {
        brandKeywords.push(orgMatch[1].toLowerCase());
      }

      const newRows: PreviewRow[] = [];
      for (const q of queries) {
        const text = (q.text || "").trim();
        if (!text || text.length < 5 || text.length > 200) continue;
        const lower = text.toLowerCase();
        if (currentTexts.has(lower)) continue; // 去重
        currentTexts.add(lower);

        // 品牌污染校验
        const mentionsBrand = brandKeywords.some((bk) => lower.includes(bk));
        const finalType = mentionsBrand ? "BRANDED_SANITY" : q.queryType === "BRANDED" ? "BRANDED_SANITY" : "DISCOVERY";

        newRows.push({
          text,
          queryType: finalType,
          targetCheck: mentionsBrand ? "TARGET_MENTIONED" : "CLEAN",
          matchedAlias: mentionsBrand ? brandName : null,
        });
      }

      if (newRows.length === 0) {
        throw new Error("生成的问题全部已存在或不符合格式要求，您可以继续手动补充。");
      }

      // 暂存上一次的状态以便撤销
      setUndoRows([...previewRows]);
      const mergedRows = [...previewRows, ...newRows];
      setPreviewRows(mergedRows);
      setImportText(mergedRows.map((r) => r.text).join("\n"));

      const discCount = mergedRows.filter((r) => r.queryType !== "BRANDED_SANITY").length;
      const brandedCount = mergedRows.filter((r) => r.queryType === "BRANDED_SANITY").length;
      setNotice(
        `AI 已生成并导入 ${newRows.length} 条业务问题（当前总计 ${mergedRows.length} 条：自然发现 ${discCount} 条 · 品牌认知 ${brandedCount} 条）。您可自由编辑、删除或撤销。`,
      );
    } catch (err) {
      setError(`AI 生成暂不可用（${friendlyError(err)}）。已保留当前录入状态，您可以直接手动添加问题。`);
    } finally {
      setAiGenerating(false);
    }
  }

  function undoAiImport() {
    if (undoRows === null) return;
    setPreviewRows(undoRows);
    setImportText(undoRows.map((r) => r.text).join("\n"));
    setUndoRows(null);
    setNotice("已撤销本次 AI 导入，已恢复导入前的问题列表。");
  }

  function deletePreviewRow(index: number) {
    const updated = previewRows.filter((_, i) => i !== index);
    setPreviewRows(updated);
    setImportText(updated.map((r) => r.text).join("\n"));
  }

  function startEditRow(index: number) {
    setEditingIndex(index);
    setEditText(previewRows[index]?.text ?? "");
  }

  function saveEditRow(index: number) {
    const text = editText.trim();
    if (!text) return;
    const brandName = targetForm.canonicalName.trim().toLowerCase();
    const mentionsBrand = brandName ? text.toLowerCase().includes(brandName) : false;
    const updated = previewRows.map((row, i) => {
      if (i !== index) return row;
      return {
        ...row,
        text,
        queryType: mentionsBrand ? "BRANDED_SANITY" : row.queryType,
        targetCheck: mentionsBrand ? "TARGET_MENTIONED" : "CLEAN",
      };
    });
    setPreviewRows(updated);
    setImportText(updated.map((r) => r.text).join("\n"));
    setEditingIndex(null);
    setEditText("");
  }

  function cancelEditRow() {
    setEditingIndex(null);
    setEditText("");
  }

  async function previewImport() {
    if (!project) return;
    const lines = importText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { setError("请先粘贴问题，每行一个。"); return; }
    setBusy(true); setError("");
    try {
      const r = await api<{ rows: PreviewRow[]; total: number; unique: number; targetContaminated: number }>(
        `/projects/${project.id}/queries/import-preview`,
        { method: "POST", body: JSON.stringify({ lines }) },
      );
      setPreviewRows(r.rows);
      const dirty = r.rows.filter((x) => x.targetCheck === "TARGET_MENTIONED").length;
      setNotice(`预览 ${r.rows.length} 条问题${dirty > 0 ? `，其中 ${dirty} 条包含监测品牌（会按「品牌认知测试」保存，不计入自然可见度）` : ""}。`);
    } catch (e) { goError(e); }
    finally { setBusy(false); }
  }

  async function createSuiteAndFinish() {
    if (!project) return;
    const name = suiteName.trim() || `${project.name} 默认问题集`;
    setBusy(true); setError("");
    try {
      const suite = await api<{ id: string; queryCount: number; discoveryCount: number; sanityQueryCount: number }>(
        `/projects/${project.id}/benchmark-suites`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            version: "1",
            queries: previewRows.map((r) => ({
              queryText: r.text,
              category: r.queryType === "BRANDED_SANITY" ? "sanity-control" : "tool-discovery",
              intent: "问题集生成",
              queryType: r.queryType === "BRANDED_SANITY" ? "BRANDED_SANITY" : "DISCOVERY",
              source: "AI_GENERATED",
            })),
          }),
        },
      );
      setNotice(`问题集「${name}」已创建：自然发现 ${suite.discoveryCount} 条 · 品牌认知 ${suite.sanityQueryCount} 条。`);
      window.location.href = `/app/queries/${suite.id}`;
    } catch (e) { goError(e); }
    finally { setBusy(false); }
  }

  // 稍后创建：先建空问题集 → 到问题集页用生成器/批量导入补问题
  async function createEmptySuite() {
    if (!project) return;
    const name = suiteName.trim() || `${project.name} 默认问题集`;
    setBusy(true); setError("");
    try {
      const suite = await api<{ id: string }>(`/projects/${project.id}/benchmark-suites`, {
        method: "POST", body: JSON.stringify({ name, version: "1" }),
      });
      window.location.href = `/app/queries/${suite.id}`;
    } catch (e) { goError(e); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/app" className="text-xs text-blue-700 hover:underline">← 返回工作台</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-800">新建监测项目</h1>
        <p className="mt-1 text-xs text-slate-500">
          任意品牌 / 产品 / 软件 / 服务都能建项目；每个项目拥有自己独立的监测对象、问题集与历史数据。
        </p>
      </div>

      {/* 步骤指示 */}
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 font-medium ${i === step ? "bg-slate-900 text-white" : i < step ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
              {i < step ? "✓ " : `${i + 1}. `}{label}
            </span>
            {i < STEPS.length - 1 && <span className="text-slate-300">→</span>}
          </li>
        ))}
      </ol>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      {/* Step 1 项目基本信息 */}
      {step === 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700">1. 项目基本信息</h2>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">所属组织</span>
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:max-w-sm" aria-label="所属组织">
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}（{o.slug}）</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">项目名称 *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="如：AcmeFlow GEO 监测" aria-label="项目名称" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">项目说明（可选）</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="这个项目监测什么？" aria-label="项目说明" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">行业（可选）</span>
              <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="如：SaaS / 家电" aria-label="行业" />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => void createProject()} disabled={busy || !form.name.trim() || !orgId} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40">
              下一步：设置监测对象
            </button>
          </div>
        </section>
      )}

      {/* Step 2 监测对象 */}
      {step === 1 && project && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700">2. 监测对象 —— 项目“{project.name}”</h2>
          <p className="mt-1 text-xs text-slate-500">1 个项目 = 1 个监测对象。想监测另一个品牌/产品，请新建项目，不要改旧项目。</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">品牌 / 产品名称 *</span>
              <input value={targetForm.canonicalName} onChange={(e) => setTargetForm({ ...targetForm, canonicalName: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="如：AcmeFlow / CleanBot" aria-label="品牌或产品名称" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">实体类型</span>
              <select value={targetForm.entityType} onChange={(e) => setTargetForm({ ...targetForm, entityType: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="实体类型">
                {Object.entries({ BRAND: "品牌", PRODUCT: "产品", SERVICE: "服务", ORGANIZATION: "组织", OTHER: "其他" }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">产品类别 *</span>
              <input value={targetForm.productCategory} onChange={(e) => setTargetForm({ ...targetForm, productCategory: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="自由文本，如：CRM SaaS / 洗地机 / 考研培训" aria-label="产品类别" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">官网（可选）</span>
              <input value={targetForm.website} onChange={(e) => setTargetForm({ ...targetForm, website: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="https://…" aria-label="官网" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">品牌说明（可选）</span>
              <input value={targetForm.description} onChange={(e) => setTargetForm({ ...targetForm, description: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="这个品牌 / 产品是做什么的？" aria-label="品牌说明" />
            </label>
          </div>

          {/* 品牌别名 */}
          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <h3 className="text-xs font-semibold text-slate-700">品牌别名（可选，用于识别 AI 回答中的品牌）</h3>
            {target && (target.aliases.length > 0) ? (
              <ul className="mt-2 space-y-1">
                {target.aliases.map((a) => (
                  <li key={a.id ?? `legacy-${a.alias}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                    <span>
                      {a.alias}
                      {!a.enabled && <span className="ml-2 text-xs text-rose-500">已停用</span>}
                    </span>
                    {a.id ? (
                      <span className="flex gap-2">
                        <button type="button" onClick={() => void toggleAlias(a, !a.enabled)} className="text-xs text-blue-700 hover:underline">{a.enabled ? "停用" : "启用"}</button>
                        <button type="button" onClick={() => void deleteAlias(a)} className="text-xs text-rose-600 hover:underline">删除</button>
                      </span>
                    ) : <span className="text-[10px] text-slate-300">历史别名</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-400">暂无别名</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <input value={newAlias} onChange={(e) => setNewAlias(e.target.value)} className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" placeholder="如：Acme Flow" aria-label="新别名" />
              <button type="button" onClick={() => void addAlias()} disabled={busy || !newAlias.trim() || !target?.brandId} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">添加别名</button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => setStep(0)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">上一步</button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void saveTarget()} disabled={busy || !targetForm.canonicalName.trim() || !targetForm.productCategory.trim()} className="rounded-lg border border-slate-800 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40">
                保存监测对象
              </button>
              <button type="button" onClick={() => void nextFromTarget()} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40">
                下一步：创建问题集
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Step 3 问题集 */}
      {step === 2 && project && target?.canonicalName && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                3. 问题集 —— 监测对象：{target.canonicalName}（{formatTargetEntityType(target.entityType)} · {target.productCategory ?? "未设类别"}）
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                自然发现问题不包含本品名称，用于衡量大模型在用户提出通用业务、选型或学术问题时是否会自然推荐你的品牌。
              </p>
            </div>
          </div>

          <div>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">问题集名称</span>
              <input
                value={suiteName}
                onChange={(e) => setSuiteName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:max-w-md"
                aria-label="问题集名称"
              />
            </label>
          </div>

          {/* AI 一键生成并导入推荐区 */}
          <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-sky-50/50 to-blue-50/60 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base">✨</span>
                  <h3 className="text-sm font-semibold text-slate-800">AI 一键生成并导入问题集</h3>
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">推荐</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  基于您在前两步填写的名称「{target.canonicalName}」、品类「{target.productCategory || "未填"}」与业务描述，由 AI 自动生成贴合真实用户搜索意图的高价值问题。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {undoRows !== null && (
                  <button
                    type="button"
                    onClick={undoAiImport}
                    disabled={aiGenerating || busy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    撤销本次导入
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void generateAiQuerySet()}
                  disabled={aiGenerating || busy}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5 transition"
                >
                  {aiGenerating ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>AI 正在构思业务问题…</span>
                    </>
                  ) : (
                    <span>AI 一键生成并导入</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 问题预览与管理列表 */}
          {previewRows.length > 0 && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                <span className="text-xs font-semibold text-slate-700">
                  已导入问题列表（共 {previewRows.length} 条：自然发现 {previewRows.filter(r => r.queryType !== "BRANDED_SANITY").length} 条 · 品牌认知 {previewRows.filter(r => r.queryType === "BRANDED_SANITY").length} 条）
                </span>
                <span className="text-[11px] text-slate-500">点击文本可直接修改，点击 × 可删除</span>
              </div>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {previewRows.map((r, i) => (
                  <div
                    key={i}
                    className="group flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs transition hover:border-slate-300"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-slate-400">#{i + 1}</span>
                    {editingIndex === i ? (
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="text"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="flex-1 rounded border border-blue-400 px-2 py-1 text-xs"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditRow(i);
                            if (e.key === "Escape") cancelEditRow();
                          }}
                        />
                        <button type="button" onClick={() => saveEditRow(i)} className="text-blue-700 font-semibold hover:underline">保存</button>
                        <button type="button" onClick={cancelEditRow} className="text-slate-500 hover:underline">取消</button>
                      </div>
                    ) : (
                      <span
                        onClick={() => startEditRow(i)}
                        className="min-w-0 flex-1 truncate text-slate-800 cursor-pointer hover:text-blue-700"
                        title="点击编辑"
                      >
                        {r.text}
                      </span>
                    )}
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          r.queryType === "BRANDED_SANITY"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-teal-100 text-teal-800"
                        }`}
                      >
                        {r.queryType === "BRANDED_SANITY" ? "品牌认知测试" : "自然发现问题"}
                      </span>
                      <button
                        type="button"
                        onClick={() => deletePreviewRow(i)}
                        className="text-slate-400 hover:text-rose-600 font-bold px-1"
                        title="删除此问题"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {previewRows.some((r) => r.targetCheck === "TARGET_MENTIONED") && (
                <p className="pt-1 text-[11px] text-amber-700">
                  提示：含本品名称的问题会自动归为「品牌认知测试」，用于考察大模型对本品的直接认知，不计入中立自然可见度。
                </p>
              )}
            </div>
          )}

          {/* 手动录入 / 批量补充区域 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">手动添加或补充问题（每行一个，可选）</span>
              <span className="text-[11px] text-slate-400">支持直接粘贴多行</span>
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
              placeholder={
                (targetForm.productCategory?.includes("专业") || targetForm.productCategory?.includes("大学") || targetForm.canonicalName?.includes("大学"))
                  ? `医学信息工程专业主要学什么课程？\n医学信息工程毕业后有哪些就业方向？\n哪些高校开设了医学信息工程专业？\n医学信息工程和生物医学工程有什么区别？`
                  : targetForm.productCategory?.includes("软件") || targetForm.productCategory?.includes("SaaS")
                  ? `适合中小团队的${targetForm.productCategory}有哪些？\n如何评估一款优质${targetForm.productCategory}的实用性与落地成本？\n主流${targetForm.productCategory}横评与选型对比推荐`
                  : `2026年适合行业主流需求的${targetForm.productCategory || "产品"}有哪些？\n如何选择适合自身业务的${targetForm.productCategory || "服务"}方案？\n${targetForm.productCategory || "行业"}常见痛点与避坑建议`
              }
              aria-label="手动添加问题"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void previewImport()}
                disabled={busy || aiGenerating || !importText.trim()}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
              >
                预览并校验文本问题
              </button>
            </div>
          </div>

          {/* 底部保存与流程推进操作 */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              上一步
            </button>
            <div className="flex flex-wrap items-center gap-2">
              {previewRows.length === 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => void createEmptySuite()}
                    disabled={busy || aiGenerating}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    稍后补充（先建空问题集）
                  </button>
                  <Link href="/app" className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                    返回工作台
                  </Link>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void createSuiteAndFinish()}
                  disabled={busy || aiGenerating}
                  className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40 shadow-sm"
                >
                  创建问题集并保存（共 {previewRows.length} 条）
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {step === 2 && (!project || !target?.canonicalName) && (
        <p className="text-sm text-slate-500">监测对象尚未保存，返回上一步继续。</p>
      )}
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-6"><p className="text-sm text-slate-500">正在加载新建向导…</p></div>}>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <NewProjectInner />
      </div>
    </Suspense>
  );
}
