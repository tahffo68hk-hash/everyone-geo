/**
 * WEB-008: presentation-only copy for existing measurement verdicts.
 * No provider inference, provenance validation, or verdict recalculation occurs here.
 */
export interface MeasurementLimitsInput {
  sourceType?: string;
  retrievalMode?: string;
  attributionStatus?: string;
  measurement: {
    verdict:
      | "VALID_FOR_WEB_CHANGE"
      | "PARTIALLY_VALID"
      | "INVALID_FOR_WEB_CHANGE"
      | "UNKNOWN";
    mode:
      | "WEB_VALIDATED"
      | "MANUAL_VERIFIED"
      | "MODEL_BEHAVIOR_ONLY"
      | "UNKNOWN";
    reasons: string[];
  } | null;
}

export interface MeasurementLimitsCopy {
  tone: "info" | "warning";
  title: string;
  messages: string[];
}

const MODE_LABELS: Record<NonNullable<MeasurementLimitsInput["measurement"]>["mode"], string> = {
  WEB_VALIDATED: "网页检索已验证（服务端判定）",
  MANUAL_VERIFIED: "人工核验（服务端判定）",
  MODEL_BEHAVIOR_ONLY: "仅模型行为观测（服务端判定）",
  UNKNOWN: "未知（服务端判定）",
};

function normalizedTag(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Converts already-supplied provenance and authoritative measurement results into
 * conservative Chinese UI copy. Source tags only trigger disclosure of limitations;
 * they are NEVER used to create or replace a measurement verdict.
 */
export function getMeasurementLimitsCopy(input: MeasurementLimitsInput): MeasurementLimitsCopy {
  const sourceType = normalizedTag(input.sourceType);
  const retrievalMode = normalizedTag(input.retrievalMode);
  const attributionStatus = normalizedTag(input.attributionStatus).toUpperCase();
  const measurement = input.measurement ?? null;

  const isSimulated = sourceType === "mock" || sourceType === "estimated";
  const isPlainApi = retrievalMode === "api_plain";
  const isManualTag = sourceType === "manual" || retrievalMode === "manual_verified";
  const missingSourceFields = sourceType === "" || retrievalMode === "";
  const positivelyClaimed =
    measurement?.verdict === "VALID_FOR_WEB_CHANGE" ||
    measurement?.verdict === "PARTIALLY_VALID" ||
    measurement?.mode === "WEB_VALIDATED" ||
    measurement?.mode === "MANUAL_VERIFIED";
  const sourceConflict = (isSimulated || isPlainApi) && positivelyClaimed;

  let tone: MeasurementLimitsCopy["tone"] = "warning";
  let title = "测量有效性尚未判定";
  if (isSimulated) {
    title = "模拟/估算来源限制";
  } else if (isPlainApi) {
    title = "仅模型行为观测";
  } else if (missingSourceFields) {
    title = "测量来源信息不完整";
  } else if (measurement?.verdict === "PARTIALLY_VALID") {
    title = "网页测量仍缺确认";
  } else if (measurement?.verdict === "INVALID_FOR_WEB_CHANGE") {
    title = "不能据此验证网页变化";
  } else if (measurement?.verdict === "VALID_FOR_WEB_CHANGE") {
    title = "网页测量判定已提供";
    tone = "info";
  }

  const messages: string[] = [];
  if (isSimulated) {
    messages.push("模拟/估算结果不能证明真实效果，不能作为真实公开网页变化的有效测量。");
  }
  if (isPlainApi) {
    messages.push("api_plain 仅模型行为观测，不能证明读取公开网页改动。");
  }
  if (missingSourceFields) {
    messages.push("展示输入缺少完整的 sourceType 或 retrievalMode，不能据此推断真实网页检索。");
  }
  if (sourceConflict) {
    messages.push("来源与服务端测量判定存在矛盾：需复核来源及检索 provenance，不得据此认定真实网页效果。");
  }
  if (isManualTag) {
    if (measurement?.verdict === "VALID_FOR_WEB_CHANGE" && measurement.mode === "MANUAL_VERIFIED") {
      messages.push("服务端提供了人工核验有效判定；本组件不独立验证 retrievalConfirmed、verifiedBy 等实际核验依据。");
    } else {
      messages.push("manual/manual_verified 来源标记不等于人工核验通过；需要实际的服务端核验判定及 provenance。");
    }
  }

  if (measurement === null) {
    messages.push("尚缺权威测量判定，无法确认是否真正检索了公开网页；不能默认有效。");
  } else {
    switch (measurement.verdict) {
      case "VALID_FOR_WEB_CHANGE":
        if (sourceConflict || missingSourceFields) {
          messages.push("服务端返回 VALID_FOR_WEB_CHANGE，但展示中的来源信息不足或矛盾，不能直接据此确认网页实验有效。");
        } else {
          messages.push("服务端判定可用于网页变化测量，但不代表优化动作已经产生因果效果。");
        }
        break;
      case "PARTIALLY_VALID":
        messages.push("服务端判定仅部分有效：尚缺必要的网页检索或核验确认，不能宣称网页变化已获验证。");
        break;
      case "INVALID_FOR_WEB_CHANGE":
        messages.push("服务端判定不适合用于证明公开网页变化的效果。");
        break;
      case "UNKNOWN":
        messages.push("服务端测量判定为未知，尚不能确认网页变化测量有效性。");
        break;
    }
    messages.push(`服务端测量模式：${MODE_LABELS[measurement.mode]}。`);
    if (Array.isArray(measurement.reasons)) {
      for (const reason of measurement.reasons) {
        if (typeof reason === "string" && reason.trim() !== "") {
          // Kept as text; rendering must use React text children, never raw HTML.
          messages.push(`服务端测量原因：${reason}`);
        }
      }
    }
  }

  if (attributionStatus === "LIKELY_RELATED") {
    messages.push("归因状态 LIKELY_RELATED 表示可能相关，不是因果关系或优化效果已被证明。");
  } else {
    messages.push("即使观测到输出变化，也不能仅凭时间先后或相关性证明因果关系。");
  }

  return { tone, title, messages };
}
