export function aliases(name: string): string[] {
  const trimmed = name.trim();
  // Longest suffixes first so only one complete suffix is removed.
  const short = trimmed
    .replace(
      /(?:股份有限公司|官方旗舰店|有限公司|咖啡|茶饮|奶茶|科技|集团|品牌|Coffee|Tea|Inc|Ltd)$/i,
      "",
    )
    .trim();
  const minimum = /^[\x00-\x7F]+$/.test(short) ? 3 : 2;
  return short !== trimmed && Array.from(short).length >= minimum
    ? [name, short]
    : [name];
}

export function mention(answer: string, name: string) {
  const a = answer.normalize("NFKC").toLowerCase();
  let earliest: number | null = null;
  for (const alias of aliases(name)) {
    const n = alias.trim().normalize("NFKC").toLowerCase();
    if (!n) continue;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = /^[\x00-\x7F]+$/.test(n)
      ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i")
      : new RegExp(escaped, "i");
    const m = re.exec(a);
    if (m && (earliest === null || m.index < earliest)) earliest = m.index;
  }
  return {
    mentioned: earliest !== null,
    position:
      earliest !== null ? Array.from(a.slice(0, earliest)).length + 1 : null,
  };
}
export function metrics(
  rows: { brand_mentioned: number; kind: string; competitors: string }[],
) {
  const count = (r: typeof rows) => ({
    total: r.length,
    mentioned: r.filter((x) => x.brand_mentioned).length,
    rate: r.length
      ? r.filter((x) => x.brand_mentioned).length / r.length
      : null,
  });
  const competitors: Record<string, number> = {};
  for (const r of rows)
    for (const c of new Set<string>(JSON.parse(r.competitors)))
      competitors[c] = (competitors[c] || 0) + 1;
  return {
    ...count(rows),
    discovery: count(rows.filter((x) => x.kind === "DISCOVERY")),
    branded: count(rows.filter((x) => x.kind === "BRANDED")),
    competitors,
  };
}
