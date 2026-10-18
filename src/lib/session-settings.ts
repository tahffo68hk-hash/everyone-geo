import type { DatabaseSync } from "node:sqlite";
import { Config, defaults, envKey, Provider } from "./gateway";
export function persistSettings(db: DatabaseSync, owner: string, cfg: Config) {
  const allowed = [
    "temperature",
    "top_p",
    "max_tokens",
    "presence_penalty",
    "frequency_penalty",
    "seed",
  ];
  const extra = Object.fromEntries(
    Object.entries(cfg.extra).filter(
      ([k, v]) =>
        allowed.includes(k) && typeof v === "number" && Number.isFinite(v),
    ),
  );
  db.prepare(
    "INSERT INTO session_settings(owner,provider,model,base_url,extra,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET provider=excluded.provider,model=excluded.model,base_url=excluded.base_url,extra=excluded.extra,updated_at=excluded.updated_at",
  ).run(
    owner,
    cfg.provider,
    cfg.model,
    cfg.baseUrl,
    JSON.stringify(extra),
    Date.now(),
  );
}
export function hydrateSettings(db: DatabaseSync, owner: string): Config {
  const saved = db
    .prepare("SELECT * FROM session_settings WHERE owner=?")
    .get(owner);
  if (saved && Object.hasOwn(defaults, String(saved.provider)))
    return {
      provider: saved.provider as Provider,
      model: String(saved.model),
      baseUrl: String(saved.base_url),
      extra: JSON.parse(String(saved.extra)),
    };
  const candidate = process.env.GEOLENS_DEFAULT_PROVIDER as Provider;
  const provider =
    Object.hasOwn(defaults, candidate || "") && envKey(candidate)
      ? candidate
      : "mock";
  return { provider, ...defaults[provider], extra: {} };
}
