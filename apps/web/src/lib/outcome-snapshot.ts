/** Read-only display-boundary projection of persisted Before/After snapshots. */
export interface OutcomeSnapshotView {
  evidenceId: string | null;
  brandMentioned: boolean | null;
  mentionPosition: number | null;
  recommended: boolean | null;
  citationCount: number | null;
  capturedAt: string | null;
  competitorsMentioned: string[] | null;
}

type SnapshotRecord = Record<string, unknown>;

/** A canonical own key wins even when its value is null, undefined or invalid. */
function readField(
  record: SnapshotRecord,
  canonical: string,
  legacy?: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(record, canonical)) {
    return record[canonical];
  }
  return legacy && Object.prototype.hasOwnProperty.call(record, legacy)
    ? record[legacy]
    : undefined;
}

function nonEmptyId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function strictBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function validInteger(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum
    ? value
    : null;
}

/** Require a calendar-valid ISO date/time with an explicit Z or ±HH:mm offset. */
function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = monthLengths[month - 1];
  if (maxDay === undefined || day < 1 || day > maxDay) return null;

  const offset = match[7] ?? "";
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }

  // Also reject values that the runtime cannot represent as an instant.
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  // Iteration visits sparse slots as undefined; Array.every would skip them.
  for (const item of value) {
    if (typeof item !== "string") return null;
  }
  // Do not share a mutable array with the input snapshot.
  return [...value];
}

/**
 * Normalize only the presentation boundary, never historical Evidence or deltas.
 * Missing/invalid values are unknown (null), not inferred negatives or "now".
 */
export function normalizeOutcomeSnapshot(value: unknown): OutcomeSnapshotView {
  const record: SnapshotRecord =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as SnapshotRecord)
      : {};

  return {
    evidenceId: nonEmptyId(readField(record, "evidenceId")),
    brandMentioned: strictBoolean(readField(record, "brandMentioned", "brandMention")),
    mentionPosition: validInteger(readField(record, "mentionPosition", "position"), 1),
    recommended: strictBoolean(readField(record, "recommended", "recommendation")),
    citationCount: validInteger(readField(record, "citationCount"), 0),
    capturedAt: isoTimestamp(readField(record, "capturedAt", "timestamp")),
    competitorsMentioned: stringArray(
      readField(record, "competitorsMentioned", "competitors"),
    ),
  };
}
