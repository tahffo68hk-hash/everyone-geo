/**
 * 仅从父组件已读取的数据推导展示文案；不请求数据、不改变服务端状态。
 * 复测执行、结果对比、归因是不同阶段，不能用执行状态推断后两者已完成。
 */
export interface RetestProgressInput {
  status: string | null;
  totalItems: number | null;
  completedItems: number | null;
  outcomeCount: number | null;
  attributionCount: number | null;
}

export interface RetestProgressView {
  executionLabel: string;
  outcomeLabel: string;
  attributionLabel: string;
  tone: "neutral" | "running" | "warning" | "error" | "success";
  warnings: string[];
}

type ProgressTone = RetestProgressView["tone"];

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function displayResultCount(
  value: number | null,
  phase: "对比" | "归因",
  warnings: string[],
): string {
  if (value == null) {
    return `未读取${phase}结果`;
  }
  if (!isCount(value)) {
    warnings.push(`${phase}结果数量无效，已按未知展示。`);
    return `${phase}结果数量未知`;
  }
  if (value === 0) {
    return `暂无${phase}结果`;
  }
  return `已读取 ${value} 条${phase}结果（不代表${phase}阶段已完成）`;
}

export function deriveRetestProgress(input: RetestProgressInput): RetestProgressView {
  const warnings: string[] = [];
  const status = typeof input.status === "string" ? input.status.trim().toUpperCase() : "";
  let executionText: string;
  let tone: ProgressTone;

  switch (status) {
    case "PENDING":
      executionText = "复测等待执行";
      tone = "neutral";
      break;
    case "QUEUED":
      executionText = "复测已排队，尚未执行";
      tone = "neutral";
      break;
    case "RUNNING":
      executionText = "复测执行中";
      tone = "running";
      break;
    case "PARTIAL":
      executionText = "复测仅部分执行，尚未全部完成";
      tone = "warning";
      break;
    case "COMPLETED":
      executionText = "复测执行完成";
      tone = "success";
      break;
    case "FAILED":
      executionText = "复测执行失败";
      tone = "error";
      break;
    case "CANCELLED":
      executionText = "复测已取消";
      tone = "warning";
      break;
    case "SUCCEEDED":
      executionText = "复测状态待核实（旧枚举 SUCCEEDED）";
      tone = "warning";
      warnings.push("SUCCEEDED 是旧界面兼容枚举，不能据此确认服务端执行完成。");
      break;
    default:
      executionText = "复测执行状态未知";
      tone = "neutral";
      if (status) {
        warnings.push(`未识别的复测状态：${status}。`);
        tone = "warning";
      }
  }

  const total = input.totalItems;
  const completed = input.completedItems;
  let countText = "条目计数未知";

  if (total != null && !isCount(total)) {
    warnings.push("复测总条目数无效，已按未知展示。");
  }
  if (completed != null && !isCount(completed)) {
    warnings.push("复测已处理条目数无效，已按未知展示。");
  }

  if (isCount(total) && isCount(completed)) {
    if (completed > total) {
      warnings.push("已处理条目数大于总条目数，复测计数已按未知展示。");
    } else if (total === 0) {
      countText = "0 项；无可确认的测量结果";
      if (status === "COMPLETED") {
        warnings.push("复测执行已结束，但总条目为 0，不能据此认定测量成功。");
      }
    } else {
      countText = `已处理 ${completed}/${total} 项`;
      if (status === "COMPLETED" && completed < total) {
        warnings.push("执行状态为 COMPLETED，但已处理条目少于总数，请核验服务端记录。");
      }
    }
  }

  const outcomeLabel = displayResultCount(input.outcomeCount, "对比", warnings);
  const attributionLabel = displayResultCount(input.attributionCount, "归因", warnings);

  // error 表示失败；其余状态只要出现异常，都避免以成功色误导用户。
  if (warnings.length > 0 && tone !== "error") {
    tone = "warning";
  }

  return {
    executionLabel: `${executionText}（${countText}）`,
    outcomeLabel,
    attributionLabel,
    tone,
    warnings,
  };
}
