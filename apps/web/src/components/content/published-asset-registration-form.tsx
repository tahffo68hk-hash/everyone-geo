"use client";

import * as React from "react";
import {
  validateRegistrationCandidate,
  type PublishedAssetFormContext,
  type RegistrationCandidate,
  type RegistrationValidation,
} from "@/lib/published-asset-form";

/** Proposed UI boundary only. The caller must handle real API mapping and authorization. */
export interface PublishedAssetRegistrationFormProps {
  context: PublishedAssetFormContext;
  onSubmit: (candidate: RegistrationCandidate) => Promise<{ assetId: string }>;
  onCancel?: () => void;
}

type FieldErrors = Extract<RegistrationValidation, { ok: false }>["errors"];
type EditableField =
  | "title"
  | "platform"
  | "canonicalUrl"
  | "externalAssetId"
  | "verificationStatus"
  | "verificationNote"
  | "actualPublishedAt"
  | "userConfirmed";

function makeInitialCandidate(context: PublishedAssetFormContext): RegistrationCandidate {
  return {
    projectId: context.projectId,
    draftId: context.draftId,
    revisionId: context.revisionId,
    ...(context.publicationId ? { publicationId: context.publicationId } : {}),
    title: context.title,
    platform: context.platform,
    verificationStatus: "UNVERIFIED",
    actualPublishedAt: null,
    userConfirmed: false,
  };
}

/**
 * Keying by immutable lineage identity remounts the state synchronously when identity changes.
 * Old in-flight promises belong to the old (unmounted) body and cannot write a new body's UI.
 */
export function PublishedAssetRegistrationForm({
  context,
  onSubmit,
  onCancel,
}: PublishedAssetRegistrationFormProps): React.JSX.Element {
  const identityKey = JSON.stringify([
    context.projectId,
    context.draftId,
    context.revisionId,
    context.publicationId ?? null,
  ]);
  return (
    <RegistrationFormBody
      key={identityKey}
      context={context}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

function RegistrationFormBody({
  context,
  onSubmit,
  onCancel,
}: PublishedAssetRegistrationFormProps): React.JSX.Element {
  const id = React.useId();
  const [candidate, setCandidate] = React.useState<RegistrationCandidate>(() => makeInitialCandidate(context));
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [submitError, setSubmitError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [savedAssetId, setSavedAssetId] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function edit<K extends EditableField>(field: K, nextValue: RegistrationCandidate[K]): void {
    setCandidate((previous) => ({ ...previous, [field]: nextValue }));
    setErrors((previous) => {
      // Mode changes invalidate multiple conditional errors.
      if (field === "verificationStatus") return {};
      return { ...previous, [field]: undefined };
    });
    setSubmitError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Synchronous ref guard also prevents duplicate callbacks before React rerenders.
    if (submittingRef.current || savedAssetId !== null) return;
    const result = validateRegistrationCandidate(candidate, new Date());
    if (!result.ok) {
      setErrors(result.errors);
      setSubmitError("请修正标注字段后再提交。输入内容已保留。");
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setErrors({});
    setSubmitError("");
    try {
      // No fetch, DTO conversion, provider calls, or hidden persistence in this component.
      const response = await onSubmit(result.value);
      if (!mountedRef.current) return;
      if (!response || typeof response.assetId !== "string" || !response.assetId.trim()) {
        throw new Error("MISSING_ASSET_ID");
      }
      setSavedAssetId(response.assetId.trim());
    } catch {
      if (mountedRef.current) {
        setSubmitError("登记未成功，请检查后重试；所有输入内容已保留。");
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  const locked = busy || savedAssetId !== null;
  const errorText = (field: keyof RegistrationCandidate): React.JSX.Element | null =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} className="mt-1 text-xs text-red-700">
        {errors[field]}
      </p>
    ) : null;
  const ariaFor = (field: keyof RegistrationCandidate): string | undefined =>
    errors[field] ? `${id}-${field}-error` : undefined;

  return (
    <section className="surface rounded-xl border border-slate-200 bg-white p-5 text-slate-900 sm:p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">登记已发布资产</h2>
        <p className="text-sm text-slate-600">
          仅登记人工提供的信息；此表单不会自动发布、抓取链接或验证外部平台回执。
        </p>
      </header>

      <section aria-label="关联来源与内容版本" className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold">来源与版本预览（身份已锁定）</h3>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-slate-500">项目 ID</dt><dd className="break-all font-mono">{context.projectId}</dd></div>
          <div className="min-w-0"><dt className="text-slate-500">草稿 ID</dt><dd className="break-all font-mono">{context.draftId}</dd></div>
          <div className="min-w-0"><dt className="text-slate-500">版本 ID</dt><dd className="break-all font-mono">{context.revisionId}</dd></div>
          <div className="min-w-0"><dt className="text-slate-500">发布记录 ID</dt><dd className="break-all font-mono">{context.publicationId || "未提供"}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-amber-800">
          这些关联来自当前页面上下文；是否具备访问权限及是否同项目，仍由服务器最终验证。
        </p>
      </section>

      <form onSubmit={(event) => void submit(event)} noValidate className="mt-5 space-y-5">
        <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
          <legend className="sr-only">已发布资产登记字段</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-title`} className="mb-1 block text-sm font-medium">资产标题 <span aria-hidden="true">*</span></label>
              <input
                id={`${id}-title`}
                name="title"
                type="text"
                value={candidate.title}
                maxLength={256}
                onChange={(event) => edit("title", event.target.value)}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={ariaFor("title")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errorText("title")}
            </div>
            <div>
              <label htmlFor={`${id}-platform`} className="mb-1 block text-sm font-medium">发布平台 <span aria-hidden="true">*</span></label>
              <input
                id={`${id}-platform`}
                name="platform"
                type="text"
                value={candidate.platform}
                maxLength={64}
                onChange={(event) => edit("platform", event.target.value)}
                aria-invalid={Boolean(errors.platform)}
                aria-describedby={ariaFor("platform")}
                placeholder="例如：WECHAT"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errorText("platform")}
            </div>
          </div>

          <div>
            <label htmlFor={`${id}-verificationStatus`} className="mb-1 block text-sm font-medium">核验状态</label>
            <select
              id={`${id}-verificationStatus`}
              name="verificationStatus"
              value={candidate.verificationStatus}
              onChange={(event) => edit("verificationStatus", event.target.value as RegistrationCandidate["verificationStatus"])}
              aria-invalid={Boolean(errors.verificationStatus)}
              aria-describedby={ariaFor("verificationStatus")}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="UNVERIFIED">未核验（默认）</option>
              <option value="MANUAL_VERIFIED">人工核验</option>
            </select>
            {errorText("verificationStatus")}
            <p className="mt-1 text-xs text-slate-500">本表单不提供平台确认选项；人工核验不等于平台回执。</p>
          </div>

          <div>
            <label htmlFor={`${id}-canonicalUrl`} className="mb-1 block text-sm font-medium">正式发布链接</label>
            <input
              id={`${id}-canonicalUrl`}
              name="canonicalUrl"
              type="url"
              value={candidate.canonicalUrl ?? ""}
              maxLength={1024}
              onChange={(event) => edit("canonicalUrl", event.target.value)}
              aria-invalid={Boolean(errors.canonicalUrl)}
              aria-describedby={ariaFor("canonicalUrl")}
              placeholder="https://publisher.example.cn/articles/123"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errorText("canonicalUrl")}
          </div>

          <div>
            <label htmlFor={`${id}-externalAssetId`} className="mb-1 block text-sm font-medium">平台外部资产 ID</label>
            <input
              id={`${id}-externalAssetId`}
              name="externalAssetId"
              type="text"
              value={candidate.externalAssetId ?? ""}
              maxLength={256}
              onChange={(event) => edit("externalAssetId", event.target.value)}
              aria-invalid={Boolean(errors.externalAssetId)}
              aria-describedby={ariaFor("externalAssetId")}
              placeholder="由平台实际提供的资产标识"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errorText("externalAssetId")}
            <p className="mt-1 text-xs text-slate-500">人工核验时，正式链接与外部资产 ID 至少填写一项。</p>
          </div>

          <div>
            <label htmlFor={`${id}-actualPublishedAt`} className="mb-1 block text-sm font-medium">实际发布时间（含明确时区）</label>
            <input
              id={`${id}-actualPublishedAt`}
              name="actualPublishedAt"
              type="text"
              value={candidate.actualPublishedAt ?? ""}
              onChange={(event) => edit("actualPublishedAt", event.target.value || null)}
              aria-invalid={Boolean(errors.actualPublishedAt)}
              aria-describedby={[`${id}-time-hint`, ariaFor("actualPublishedAt")].filter(Boolean).join(" ")}
              placeholder="2026-10-10T15:30:00+08:00"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
            />
            <p id={`${id}-time-hint`} className="mt-1 text-xs text-slate-500">
              示例：2026-10-10T15:30:00+08:00 或 2026-10-10T07:30:00Z。未知可留空；人工核验时必填，不会自动填当前时间。
            </p>
            {errorText("actualPublishedAt")}
          </div>

          <div>
            <label htmlFor={`${id}-verificationNote`} className="mb-1 block text-sm font-medium">核验说明</label>
            <textarea
              id={`${id}-verificationNote`}
              name="verificationNote"
              rows={3}
              maxLength={2000}
              value={candidate.verificationNote ?? ""}
              onChange={(event) => edit("verificationNote", event.target.value)}
              aria-invalid={Boolean(errors.verificationNote)}
              aria-describedby={ariaFor("verificationNote")}
              placeholder="说明核验依据、方式以及无法确认的部分"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errorText("verificationNote")}
            <p className="mt-1 text-xs text-slate-500">人工核验时必须提供说明；不应填写私密凭证或客户原始证据。</p>
          </div>

          <div>
            <div className="flex items-start gap-2">
              <input
                id={`${id}-userConfirmed`}
                name="userConfirmed"
                type="checkbox"
                checked={candidate.userConfirmed}
                onChange={(event) => edit("userConfirmed", event.target.checked)}
                aria-invalid={Boolean(errors.userConfirmed)}
                aria-describedby={ariaFor("userConfirmed")}
                className="mt-1 h-4 w-4"
              />
              <label htmlFor={`${id}-userConfirmed`} className="text-sm leading-6">
                我已确认资产信息、发布状态及其项目/草稿/版本归属，并理解页面校验不代表服务器或平台核验。
              </label>
            </div>
            {errorText("userConfirmed")}
          </div>
        </fieldset>

        {submitError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {submitError}
          </p>
        )}
        <div aria-live="polite" role="status" className="text-sm text-slate-600">
          {busy ? "正在保存登记信息…" : savedAssetId ? "登记成功。" : "请确认后提交；当前仅调用上层传入的保存回调。"}
        </div>
        {savedAssetId && (
          <section aria-label="登记结果" className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm">
            <h3 className="font-semibold text-teal-900">已登记资产</h3>
            <p className="mt-1 break-all font-mono text-teal-900">资产 ID：{savedAssetId}</p>
            <a
              href={`/app/content/verification?assetId=${encodeURIComponent(savedAssetId)}`}
              className="mt-2 inline-block font-medium text-teal-800 underline underline-offset-2"
            >
              前往资产核验页面
            </a>
          </section>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="ui-button primary" disabled={busy || savedAssetId !== null}>
            {busy ? "保存中…" : savedAssetId !== null ? "已保存" : "确认登记"}
          </button>
          {onCancel && (
            <button type="button" className="ui-button" onClick={onCancel}>
              取消
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
