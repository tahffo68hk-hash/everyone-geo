export type ActionPriority = "high" | "medium" | "low";
export type ActionState = "open" | "in_progress" | "ready";

export type ActionItem = {
  id: string;
  kind: "setup" | "measurement" | "diagnosis" | "task" | "content" | "verification" | "report";
  title: string;
  reason: string;
  href: string;
  source: string;
  priority: ActionPriority;
  state: ActionState;
};

export type ActionCenterInput = {
  projectId: string;
  hasTarget: boolean;
  suiteCount: number;
  queryCount: number;
  latestReportId?: string;
  latestReportHasDiagnosis?: boolean;
  activity: Array<{
    id: string;
    type: string;
    status: string;
    resultUrl?: string | null;
  }>;
  drafts?: Array<{ id: string; status: string }>;
  assets?: Array<{ id: string; title: string; latestRetest?: { status: string } | null }>;
};

const openTaskStatuses = new Set(["PENDING", "QUEUED", "RUNNING", "RETRYING"]);

export function deriveActionItems(input: ActionCenterInput): ActionItem[] {
  const project = encodeURIComponent(input.projectId);
  const items: ActionItem[] = [];

  if (!input.hasTarget) {
    items.push({
      id: "setup-target",
      kind: "setup",
      title: "设置监测对象",
      reason: "先确认品牌、产品和别名，GeoLens 才能准确判断提及与引用。",
      href: `/app/target?project=${project}`,
      source: "项目设置",
      priority: "high",
      state: "open",
    });
  } else if (input.suiteCount === 0 || input.queryCount === 0) {
    items.push({
      id: "setup-query-set",
      kind: "setup",
      title: "创建问题集",
      reason: "问题集定义要持续监测的用户问题；可以手动创建，也可以先预览 AI 生成结果。",
      href: `/app/queries?project=${project}`,
      source: "问题集",
      priority: "high",
      state: "open",
    });
  } else if (!input.latestReportId) {
    items.push({
      id: "run-first-measurement",
      kind: "measurement",
      title: "运行首次监测",
      reason: "问题集已经准备好，运行一次监测即可得到第一份可追溯报告。",
      href: `/app/benchmark?project=${project}`,
      source: "监测",
      priority: "high",
      state: "open",
    });
  } else if (input.latestReportHasDiagnosis === false) {
    items.push({
      id: "review-diagnosis",
      kind: "diagnosis",
      title: "分析最近报告",
      reason: "先从观测事实中找出缺少提及、推荐或引用的问题，再决定优化动作。",
      href: `/app/diagnosis?project=${project}`,
      source: "诊断",
      priority: "high",
      state: "open",
    });
  }

  for (const task of input.activity.filter((item) => openTaskStatuses.has(item.status)).slice(0, 2)) {
    items.push({
      id: `task-${task.id}`,
      kind: "task",
      title: task.status === "AWAITING_MANUAL_INPUT" ? "完成监测任务录入" : "查看进行中的监测",
      reason: task.status === "AWAITING_MANUAL_INPUT" ? "这项任务需要补充人工证据后才能继续。" : "查看进度，确认监测结果是否已经可以分析。",
      href: task.resultUrl || `/app/activity?project=${project}`,
      source: "任务中心",
      priority: task.status === "AWAITING_MANUAL_INPUT" ? "high" : "medium",
      state: task.status === "RUNNING" ? "in_progress" : "open",
    });
  }

  for (const draft of (input.drafts ?? []).filter((item) => ["READY_FOR_REVIEW", "APPROVED", "CHANGES_REQUESTED"].includes(item.status)).slice(0, 2)) {
    items.push({
      id: `content-${draft.id}`,
      kind: "content",
      title: draft.status === "APPROVED" ? "登记已发布内容" : draft.status === "CHANGES_REQUESTED" ? "处理内容修改意见" : "审核待处理内容",
      reason: draft.status === "APPROVED" ? "内容已通过审核，登记发布后才能进入效果验证。" : "把内容审核状态推进到下一步，避免优化机会停在草稿里。",
      href: `/app/content/${encodeURIComponent(draft.id)}?project=${project}`,
      source: "内容运营",
      priority: "medium",
      state: "ready",
    });
  }

  for (const asset of (input.assets ?? []).filter((item) => !item.latestRetest || ["RETEST_READY", "READY_FOR_EVALUATION"].includes(item.latestRetest.status)).slice(0, 2)) {
    items.push({
      id: `verification-${asset.id}`,
      kind: "verification",
      title: "复测已发布资产",
      reason: asset.latestRetest ? "复测已经可以执行，查看前后变化与证据归因。" : "资产尚未有复测结果，发布后的变化还无法验证。",
      href: `/app/content/verification?project=${project}&assetId=${encodeURIComponent(asset.id)}`,
      source: "效果验证",
      priority: "medium",
      state: "ready",
    });
  }

  if (items.length === 0 && input.latestReportId) {
    items.push({
      id: "review-latest-report",
      kind: "report",
      title: "查看最近报告",
      reason: "当前没有需要立即处理的阻塞事项，回顾最新观测并选择下一项优化。",
      href: `/app/reports/${encodeURIComponent(input.latestReportId)}?project=${project}`,
      source: "报告",
      priority: "low",
      state: "ready",
    });
  }

  return items.slice(0, 5);
}

