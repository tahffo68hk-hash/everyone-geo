import {
  BlockReason,
  ProductionStatus,
} from "./dto/content-campaign.dto";

export interface PlanItemLike {
  id: string;
  title: string;
  platform: string;
  format: string;
  status: string;
  sortOrder?: number;
  metadata?: any;
}

export interface ScheduledPlanAssignment {
  planItemId: string;
  planItem?: PlanItemLike;
  scheduledDate: Date;
  scheduledTime: string | null;
  timezone: string;
  productionStatus: ProductionStatus;
  blockReason: BlockReason | null;
  dependsOnPlanItemId: string | null;
}

export interface CampaignProgressStats {
  total: number;
  ready: number;
  blockedFacts: number;
  blockedAssets: number;
  inProgress: number;
  draftCreated: number;
  inReview: number;
  approved: number;
  readyToPublish: number;
  done: number;
  overdue: number;
  completionRate: number;
}

export type PacingStrategy = "WORKDAYS_ONLY" | "DAILY" | "SPREAD" | "CONSERVATIVE" | "BALANCED" | "ACCELERATED";

export class ContentCalendarEngine {
  /**
   * 将 M9A 的 PlanItem 就绪状态同步映射为统一的生产状态与阻断原因
   */
  static mapReadinessToProductionStatus(item: PlanItemLike): {
    productionStatus: ProductionStatus;
    blockReason: BlockReason | null;
  } {
    const isVideo =
      item.platform === "BILIBILI" ||
      item.platform === "DOUYIN" ||
      (item.format && (item.format.includes("视频") || item.format.includes("脚本")));

    if (item.status === "FACT_INPUT_REQUIRED") {
      return {
        productionStatus: "BLOCKED_FACTS",
        blockReason: "MISSING_REQUIRED_FACTS",
      };
    }

    if (
      item.status === "ASSET_INPUT_REQUIRED" ||
      (isVideo &&
        (item.metadata as any)?.videoAssetRequired &&
        !(item.metadata as any)?.hasVideoAsset)
    ) {
      return {
        productionStatus: "BLOCKED_ASSETS",
        blockReason: "MISSING_VIDEO_ASSET",
      };
    }

    if (item.status === "READY") {
      return {
        productionStatus: "READY",
        blockReason: null,
      };
    }

    return {
      productionStatus: "PLANNED",
      blockReason: null,
    };
  }

  /**
   * 判断某个排期项在指定时区下是否已经逾期 (isOverdue)
   */
  static isItemOverdue(
    scheduledDate: Date | string,
    timezone = "Asia/Shanghai",
  ): boolean {
    const target = new Date(scheduledDate);
    if (isNaN(target.getTime())) return false;

    // 按指定时区获取 YYYY-MM-DD
    const targetDateStr = this.formatDateInTimezone(target, timezone);
    const currentDateStr = this.formatDateInTimezone(new Date(), timezone);

    return targetDateStr < currentDateStr;
  }

  /**
   * 生成明确的用户“下一步操作” (nextAction) 指引
   */
  static calculateNextAction(
    productionStatus: string,
    blockReasonOrPlanItem?: any,
    itemOrOverdue?: any,
  ): string {
    let blockReason: string | null = null;
    let isOverdue = false;

    if (typeof blockReasonOrPlanItem === "string") {
      blockReason = blockReasonOrPlanItem;
    } else if (blockReasonOrPlanItem && typeof blockReasonOrPlanItem === "object") {
      blockReason = blockReasonOrPlanItem.blockReason ?? null;
    }

    if (typeof itemOrOverdue === "boolean") {
      isOverdue = itemOrOverdue;
    } else if (itemOrOverdue && typeof itemOrOverdue === "object") {
      if (typeof itemOrOverdue.isOverdue === "boolean") {
        isOverdue = itemOrOverdue.isOverdue;
      }
    }

    let action = "确认生产排期与前置物料";
    switch (productionStatus) {
      case "BLOCKED_FACTS":
        action = "补充产品事实依据";
        break;
      case "BLOCKED_ASSETS":
        action =
          blockReason === "MISSING_VIDEO_ASSET"
            ? "上传实拍视频素材"
            : "上传图片设计素材";
        break;
      case "READY":
        action = "开始生产草稿";
        break;
      case "IN_PROGRESS":
        action = "继续编辑草稿";
        break;
      case "DRAFT_CREATED":
        action = "完善草稿正文与生成变体";
        break;
      case "IN_REVIEW":
        action = "处理审批反馈意见";
        break;
      case "APPROVED":
        action = "准备交付发布包";
        break;
      case "READY_TO_PUBLISH":
        action = "确认发布渠道与排期";
        break;
      case "DONE":
        action = "生产流程已完成";
        break;
      case "PLANNED":
      default:
        action = "确认生产排期与前置物料";
        break;
    }

    return isOverdue && productionStatus !== "DONE" ? `[逾期] ${action}` : action;
  }

  /**
   * 生成规则优先、保守平摊的内容排期日历 (Generate Calendar from Campaign)
   * 支持传单个对象参数或 (planItems, options) 两种形式
   */
  static generateScheduleTimeline(
    param1:
      | {
          startDate?: Date | string;
          endDate?: Date | string;
          planItems: PlanItemLike[];
          timezone?: string;
          maxItemsPerDay?: number;
          pacing?: string;
          pacingStrategy?: string;
        }
      | PlanItemLike[],
    param2?: {
      startDate?: Date | string;
      endDate?: Date | string;
      timezone?: string;
      maxItemsPerDay?: number;
      pacing?: string;
      pacingStrategy?: string;
    },
  ): ScheduledPlanAssignment[] {
    let planItems: PlanItemLike[] = [];
    let startDate: Date | string | undefined;
    let endDate: Date | string | undefined;
    let timezone = "Asia/Shanghai";

    if (Array.isArray(param1)) {
      planItems = param1;
      startDate = param2?.startDate;
      endDate = param2?.endDate;
      timezone = param2?.timezone || "Asia/Shanghai";
    } else {
      planItems = param1.planItems || [];
      startDate = param1.startDate;
      endDate = param1.endDate;
      timezone = param1.timezone || "Asia/Shanghai";
    }

    const start = startDate ? new Date(startDate) : new Date();
    const safeStart = isNaN(start.getTime()) ? new Date() : start;
    const end = endDate ? new Date(endDate) : new Date(safeStart.getTime() + 14 * 86400000);
    const safeEnd =
      isNaN(end.getTime()) || end.getTime() <= safeStart.getTime()
        ? new Date(safeStart.getTime() + 14 * 86400000)
        : end;

    // 1. 按平台战略分工排序：
    // P1 (长文/基座): 微信公众号、小红书
    // P2 (音视频拆解): Bilibili、抖音
    // P3 (社交摘要): 微博、知乎
    const sortedItems = [...planItems].sort((a, b) => {
      const pA = this.getPlatformWeight(a.platform);
      const pB = this.getPlatformWeight(b.platform);
      if (pA !== pB) return pA - pB;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

    // 2. 计算可用工作日或日期间隔
    const totalDays = Math.max(
      1,
      Math.round((safeEnd.getTime() - safeStart.getTime()) / 86400000),
    );
    const stepDays = Math.max(1, Math.floor(totalDays / Math.max(1, sortedItems.length)));

    let wechatItemId: string | null = null;
    let xhsItemId: string | null = null;

    const result: ScheduledPlanAssignment[] = [];

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      // 计算递增日期，避免堆叠在同一天
      const offsetDays = Math.min(totalDays - 1, i * stepDays);
      const itemDate = new Date(safeStart.getTime() + offsetDays * 86400000);

      const { productionStatus, blockReason } =
        this.mapReadinessToProductionStatus(item);

      // 建立简单依赖关系 (DependsOn)：
      // 小红书/微博通常依赖同主题的公众号长文作为第一手权威出处
      let dependsOnPlanItemId: string | null = null;
      if (item.platform === "WECHAT_OFFICIAL_ACCOUNT") {
        wechatItemId = item.id;
      } else if (item.platform === "XIAOHONGSHU") {
        xhsItemId = item.id;
        if (wechatItemId) dependsOnPlanItemId = wechatItemId;
      } else if (item.platform === "WEIBO") {
        if (xhsItemId) dependsOnPlanItemId = xhsItemId;
        else if (wechatItemId) dependsOnPlanItemId = wechatItemId;
      } else if (item.platform === "DOUYIN" || item.platform === "BILIBILI") {
        if (wechatItemId) dependsOnPlanItemId = wechatItemId;
      }

      result.push({
        planItemId: item.id,
        planItem: item,
        scheduledDate: itemDate,
        scheduledTime: "10:00",
        timezone,
        productionStatus,
        blockReason,
        dependsOnPlanItemId,
      });
    }

    return result;
  }

  /**
   * 汇总 Campaign 的事实统计进度 (绝无黑盒评分)
   */
  static calculateCampaignProgress(
    items: Array<{
      productionStatus: string;
      isOverdue?: boolean;
    }>,
  ): CampaignProgressStats {
    let ready = 0;
    let blockedFacts = 0;
    let blockedAssets = 0;
    let inProgress = 0;
    let draftCreated = 0;
    let inReview = 0;
    let approved = 0;
    let readyToPublish = 0;
    let done = 0;
    let overdue = 0;

    for (const item of items) {
      if (item.isOverdue) overdue++;

      switch (item.productionStatus) {
        case "READY":
          ready++;
          break;
        case "BLOCKED_FACTS":
          blockedFacts++;
          break;
        case "BLOCKED_ASSETS":
          blockedAssets++;
          break;
        case "IN_PROGRESS":
          inProgress++;
          break;
        case "DRAFT_CREATED":
          draftCreated++;
          break;
        case "IN_REVIEW":
          inReview++;
          break;
        case "APPROVED":
          approved++;
          break;
        case "READY_TO_PUBLISH":
          readyToPublish++;
          break;
        case "DONE":
          done++;
          break;
      }
    }

    const total = items.length;
    const completedCount = done + readyToPublish + approved;
    const completionRate =
      total > 0 ? Math.round((completedCount / total) * 100) / 100 : 0;

    return {
      total,
      ready,
      blockedFacts,
      blockedAssets,
      inProgress,
      draftCreated,
      inReview,
      approved,
      readyToPublish,
      done,
      overdue,
      completionRate,
    };
  }

  /**
   * 生产队列排序比较函数 (严格遵循可解释规则，严禁黑盒 AI 评分)
   * 1. 逾期优先 (overdue first)
   * 2. 排期日期升序 (scheduledDate ASC)
   * 3. 平台优先级 (WeChat/XHS P1 > Bili/Douyin P2 > Weibo P3)
   * 4. 就绪状态 (READY > IN_PROGRESS > DRAFT_CREATED > BLOCKED)
   * 5. 初始序号 (sortOrder ASC)
   */
  static compareQueueItems(a: any, b: any): number {
    // 1. 逾期置顶
    const aOverdue = Boolean(a.isOverdue);
    const bOverdue = Boolean(b.isOverdue);
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;

    // 2. 排期日期靠前优先
    const tA = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
    const tB = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
    if (tA !== tB) return tA - tB;

    // 3. 平台权重 (微信/小红书 P1 > Bili/抖音 P2 > 微博 P3)
    const platformA = a.platform || a.planItem?.platform || "";
    const platformB = b.platform || b.planItem?.platform || "";
    const wA = ContentCalendarEngine.getPlatformWeight(platformA);
    const wB = ContentCalendarEngine.getPlatformWeight(platformB);
    if (wA !== wB) return wA - wB;

    // 4. 就绪度权重
    const rA = ContentCalendarEngine.getStatusWeight(a.productionStatus);
    const rB = ContentCalendarEngine.getStatusWeight(b.productionStatus);
    if (rA !== rB) return rA - rB;

    // 5. 序号
    const sA = a.sortOrder ?? a.planItem?.sortOrder ?? 0;
    const sB = b.sortOrder ?? b.planItem?.sortOrder ?? 0;
    return sA - sB;
  }

  private static getPlatformWeight(platform: string): number {
    switch (platform) {
      case "WECHAT_OFFICIAL_ACCOUNT":
        return 1;
      case "XIAOHONGSHU":
        return 2;
      case "BILIBILI":
        return 3;
      case "DOUYIN":
        return 4;
      case "WEIBO":
        return 5;
      default:
        return 6;
    }
  }

  private static getStatusWeight(status: ProductionStatus): number {
    switch (status) {
      case "READY":
        return 1;
      case "IN_PROGRESS":
        return 2;
      case "DRAFT_CREATED":
        return 3;
      case "IN_REVIEW":
        return 4;
      case "BLOCKED_FACTS":
        return 5;
      case "BLOCKED_ASSETS":
        return 6;
      case "APPROVED":
        return 7;
      case "READY_TO_PUBLISH":
        return 8;
      case "PLANNED":
        return 9;
      case "DONE":
        return 10;
      default:
        return 11;
    }
  }

  private static formatDateInTimezone(d: Date, timezone: string): string {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return formatter.format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }
}
