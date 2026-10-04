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
              intent: "手动录入",
              queryType: r.queryType,
              source: "MANUAL",
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
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700">3. 问题集 —— 监测对象：{target.canonicalName}（{formatTargetEntityType(target.entityType)} · {target.productCategory ?? "未设类别"}）</h2>
          <p className="mt-1 text-xs text-slate-500">自然发现问题不含目标品牌，用于衡量 AI 是否会自然提到你的品牌。</p>

          <div className="mt-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">问题集名称</span>
              <input value={suiteName} onChange={(e) => setSuiteName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:max-w-md" aria-label="问题集名称" />
            </label>
          </div>

          <div className="mt-4">
            <span className="text-xs font-medium text-slate-600">手动添加问题（每行一个，可选）</span>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={"适合小型销售团队的 CRM 有哪些？\n初创企业应该使用什么客户管理软件？"} aria-label="手动添加问题" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void previewImport()} disabled={busy || !importText.trim()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40">预览与品牌检查</button>
              {previewRows.length > 0 && (
                <>
                  <button type="button" onClick={() => void createSuiteAndFinish()} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-40">创建问题集并保存</button>
                  <button type="button" onClick={() => void createEmptySuite()} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">改用生成器 / 稍后补充（先建空问题集）</button>
                </>
              )}
            </div>
            {previewRows.length > 0 && (
              <div className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                {previewRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-0">
                    <span className="min-w-0 flex-1 truncate text-slate-700">{r.text}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${r.queryType === "BRANDED_SANITY" ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-800"}`}>
                      {r.queryType === "BRANDED_SANITY" ? "品牌认知测试" : "自然发现问题"}
                    </span>
                  </div>
                ))}
                {previewRows.some((r) => r.targetCheck === "TARGET_MENTIONED") && (
                  <p className="pt-1 text-amber-700">含监测品牌的问题会按「品牌认知测试」保存，不计入自然可见度主指标。</p>
                )}
              </div>
            )}
          </div>

          {previewRows.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void createEmptySuite()} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">稍后创建问题集（用生成器或批量导入）</button>
              <Link href="/app" className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">返回工作台</Link>
            </div>
          )}
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
