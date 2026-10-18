export function mention(answer: string, name: string) {
  const a = answer.normalize("NFKC").toLowerCase(),
    n = name.trim().normalize("NFKC").toLowerCase();
  if (!n) return { mentioned: false, position: null };
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = /^[\x00-\x7F]+$/.test(n)
    ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i")
    : new RegExp(escaped, "i");
  const m = re.exec(a);
  return {
    mentioned: !!m,
    position: m ? Array.from(a.slice(0, m.index)).length + 1 : null,
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
