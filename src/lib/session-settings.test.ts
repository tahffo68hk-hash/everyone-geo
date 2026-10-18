import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { hydrateSettings, persistSettings } from "./session-settings";
import { defaults } from "./gateway";
it("persists provider settings without any API key and hydrates after restart", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync("scripts/schema.sql", "utf8"));
    persistSettings(db, "owner", {
      provider: "deepseek",
      ...defaults.deepseek,
      key: "test-secret",
      extra: { temperature: 0.5, key: "test-secret" },
    });
    expect(hydrateSettings(db, "owner")).toEqual({
      provider: "deepseek",
      ...defaults.deepseek,
      extra: { temperature: 0.5 },
    });
    expect(
      JSON.stringify(db.prepare("SELECT * FROM session_settings").get()),
    ).not.toContain("test-secret");
    expect(hydrateSettings(db, "another").key).toBeUndefined();
    expect(defaults.deepseek.model).toBe("deepseek-flash");
  } finally {
    db.close();
  }
});
