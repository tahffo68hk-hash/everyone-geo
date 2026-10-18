import { db } from "./db";
import { hydrateSettings, persistSettings } from "./session-settings";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { Config } from "./gateway";
const g = globalThis as unknown as {
  geoSessions?: Map<string, { cfg: Config; expires: number }>;
};
const sessions = (g.geoSessions ??= new Map());
export async function session() {
  const jar = await cookies();
  let id = jar.get("geo_session")?.value;
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    id = randomUUID();
    jar.set("geo_session", id, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 86400,
    });
  }
  for (const [k, v] of sessions) if (v.expires < Date.now()) sessions.delete(k);
  if (!sessions.has(id))
    sessions.set(id, {
      cfg: hydrateSettings(db(), id),
      expires: Date.now() + 86400000,
    });
  return {
    id,
    ...sessions.get(id)!,
    save: (cfg: Config) => {
      persistSettings(db(), id!, cfg);
      sessions.set(id!, { cfg, expires: Date.now() + 86400000 });
    },
  };
}
