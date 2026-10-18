import { it, expect } from "vitest";
import { openStore } from "../../scripts/publisher/store.mjs";
import {
  createClaim,
  redeemClaim,
  hashCode,
} from "../../scripts/publisher/claims.mjs";
it("claims hash codes and atomically transfer account, jobs and runs once", () => {
  const db = openStore(":memory:");
  try {
    db.exec(
      "CREATE TABLE runs(id TEXT PRIMARY KEY,owner TEXT); INSERT INTO runs VALUES('r','old'); INSERT INTO publisher_accounts(id,owner,platform,label) VALUES('a','box-operator','bilibili','B'); INSERT INTO publisher_jobs(id,owner,content_id,platform,account_id,payload,is_mock) VALUES('j','box-operator','missing','bilibili','a','{}',0)",
    );
    const { code } = createClaim(db, "a", ["r"], 1, 1000);
    expect(
      db.prepare("SELECT code_hash FROM publisher_claims").get()?.code_hash,
    ).toBe(hashCode(code));
    expect(() => redeemClaim(db, "WRONG", "user", 2000)).toThrow();
    expect(redeemClaim(db, code.toLowerCase(), "user", 2000)).toEqual({
      account: { id: "a", platform: "bilibili", label: "B" },
      jobs: 1,
      runs: 1,
    });
    for (const table of ["publisher_accounts", "publisher_jobs", "runs"])
      expect(db.prepare(`SELECT owner FROM ${table}`).get()?.owner).toBe(
        "user",
      );
    expect(() => redeemClaim(db, code, "other", 3000)).toThrow();
    const expired = createClaim(db, "a", [], 1, 1000);
    expect(() => redeemClaim(db, expired.code, "other", 3601000)).toThrow();
    expect(() => createClaim(db, "missing")).toThrow();
  } finally {
    db.close();
  }
});
