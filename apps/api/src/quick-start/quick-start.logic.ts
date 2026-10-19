import { BadRequestException } from "@nestjs/common";
import {
  MAX_QUICK_START_QUESTIONS,
  MIN_QUICK_START_QUESTIONS,
} from "./quick-start.constants";

export type QuestionKind = "DISCOVERY" | "BRANDED";

export function isValidQuestionCount(count: number) {
  return Number.isInteger(count) &&
    count >= MIN_QUICK_START_QUESTIONS &&
    count <= MAX_QUICK_START_QUESTIONS;
}

export type VisibilitySample = {
  kind: QuestionKind;
  brandMentioned: boolean;
  competitorMentions: string[];
};

type MetricCount = {
  total: number;
  mentioned: number;
  rate: number | null;
};

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function analyzeBrandMention(answer: string, brandName: string) {
  const normalizedAnswer = normalize(answer);
  const normalizedBrand = normalize(brandName.trim());
  if (!normalizedBrand) return { mentioned: false, position: null };

  const escaped = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = /^[\x00-\x7F]+$/.test(normalizedBrand)
    ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i")
    : new RegExp(escaped, "i");
  const match = pattern.exec(normalizedAnswer);

  return {
    mentioned: match !== null,
    position:
      match === null
        ? null
        : Array.from(normalizedAnswer.slice(0, match.index)).length + 1,
  };
}

function countMetrics(rows: VisibilitySample[]): MetricCount {
  const mentioned = rows.filter((row) => row.brandMentioned).length;
  return {
    total: rows.length,
    mentioned,
    rate: rows.length === 0 ? null : mentioned / rows.length,
  };
}

export function calculateVisibilityMetrics(rows: VisibilitySample[]) {
  const competitors: Record<string, number> = {};
  for (const row of rows) {
    for (const name of new Set(row.competitorMentions.map((value) => value.trim()).filter(Boolean))) {
      competitors[name] = (competitors[name] ?? 0) + 1;
    }
  }

  return {
    ...countMetrics(rows),
    discovery: countMetrics(rows.filter((row) => row.kind === "DISCOVERY")),
    branded: countMetrics(rows.filter((row) => row.kind === "BRANDED")),
    competitors,
  };
}

export function assertPaidCallConfirmed(
  provider: string,
  confirmed: boolean,
  requestCount: number,
) {
  if (provider !== "MOCK" && !confirmed) {
    throw new BadRequestException(
      `确认本次 ${requestCount} 次真实模型请求后才能继续`,
    );
  }
}

export function parseJsonPayload(value: string): unknown {
  const trimmed = value.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end < start) {
      throw new BadRequestException("模型返回内容不是有效 JSON");
    }
    try {
      return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
    } catch {
      throw new BadRequestException("模型返回内容不是有效 JSON");
    }
  }
}
