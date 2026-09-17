import type { ProductionStatus, CampaignStatus } from "@/lib/content-api";

export const PRODUCTION_STATUS_MAP: Record<
  string,
  { label: string; color: string; dotColor: string }
> = {
  BLOCKED_FACTS: {
    label: "缺少事实依据",
    color: "bg-rose-50 text-rose-700 border-rose-200",
    dotColor: "bg-rose-500",
  },
  BLOCKED_ASSETS: {
    label: "缺少素材物料",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    dotColor: "bg-amber-500",
  },
  READY: {
    label: "可开始生产",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotColor: "bg-emerald-500",
  },
  IN_PROGRESS: {
    label: "生产中",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    dotColor: "bg-blue-500",
  },
  DRAFT_CREATED: {
    label: "草稿已创建",
    color: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dotColor: "bg-indigo-500",
  },
  IN_REVIEW: {
    label: "待审核",
    color: "bg-purple-50 text-purple-700 border-purple-200",
    dotColor: "bg-purple-500",
  },
  APPROVED: {
    label: "已批准",
    color: "bg-teal-50 text-teal-700 border-teal-200",
    dotColor: "bg-teal-500",
  },
  READY_TO_PUBLISH: {
    label: "待发布",
    color: "bg-cyan-50 text-cyan-700 border-cyan-200",
    dotColor: "bg-cyan-500",
  },
  DONE: {
    label: "生产完成",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    dotColor: "bg-slate-500",
  },
  PLANNED: {
    label: "计划中",
    color: "bg-slate-50 text-slate-600 border-slate-200",
    dotColor: "bg-slate-400",
  },
};

export const PLATFORM_MAP: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  WECHAT_OFFICIAL_ACCOUNT: {
    label: "微信公众号",
    color: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "🟢",
  },
  WECHAT: {
    label: "微信公众号",
    color: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "🟢",
  },
  XIAOHONGSHU: {
    label: "小红书",
    color: "bg-rose-100 text-rose-800 border-rose-300",
    icon: "📕",
  },
  BILIBILI: {
    label: "Bilibili",
    color: "bg-sky-100 text-sky-800 border-sky-300",
    icon: "📺",
  },
  DOUYIN: {
    label: "抖音",
    color: "bg-slate-800 text-white border-slate-700",
    icon: "🎵",
  },
  WEIBO: {
    label: "微博",
    color: "bg-amber-100 text-amber-800 border-amber-300",
    icon: "📢",
  },
  OTHER: {
    label: "其他平台",
    color: "bg-slate-100 text-slate-700 border-slate-300",
    icon: "🌐",
  },
};

export const CAMPAIGN_STATUS_MAP: Record<
  CampaignStatus,
  { label: string; color: string }
> = {
  DRAFT: { label: "草稿", color: "bg-slate-100 text-slate-700 border-slate-300" },
  ACTIVE: { label: "进行中", color: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  PAUSED: { label: "已暂停", color: "bg-amber-100 text-amber-800 border-amber-300" },
  COMPLETED: { label: "已完成", color: "bg-blue-100 text-blue-800 border-blue-300" },
  ARCHIVED: { label: "已归档", color: "bg-slate-100 text-slate-500 border-slate-200" },
};

export function ProductionStatusBadge({
  status,
  isOverdue = false,
}: {
  status: ProductionStatus | string;
  isOverdue?: boolean;
}) {
  const conf = PRODUCTION_STATUS_MAP[status] || {
    label: status,
    color: "bg-slate-50 text-slate-700 border-slate-200",
    dotColor: "bg-slate-400",
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      {isOverdue && (
        <span className="inline-flex items-center rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
          已逾期
        </span>
      )}
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${conf.color}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${conf.dotColor}`} aria-hidden="true" />
        {conf.label}
      </span>
    </div>
  );
}

export function PlatformBadge({ platform }: { platform: string }) {
  const conf = PLATFORM_MAP[platform] || PLATFORM_MAP.OTHER;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${conf.color}`}
    >
      <span aria-hidden="true">{conf.icon}</span>
      {conf.label}
    </span>
  );
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus | string }) {
  const conf = CAMPAIGN_STATUS_MAP[status as CampaignStatus] || {
    label: status,
    color: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${conf.color}`}>
      {conf.label}
    </span>
  );
}
