import { createHash, randomInt } from "node:crypto";
export const hashCode = (code) =>
  createHash("sha256")
    .update(String(code).replace(/[-\s]/g, "").toUpperCase())
    .digest("hex");
export function createClaim(
  db,
  accountId,
  runIds = [],
  ttlHours = 24,
  now = Date.now(),
) {
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 720)
    throw Error("有效期须为 0–720 小时");
  if (
    !db.prepare("SELECT id FROM publisher_accounts WHERE id=?").get(accountId)
  )
    throw Error("账号不存在");
  for (const id of runIds)
    if (!db.prepare("SELECT id FROM runs WHERE id=?").get(id))
      throw Error("检测不存在");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = Array.from(
    { length: 10 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
  const expiresAt = now + ttlHours * 3600000;
  db.prepare(
    "INSERT INTO publisher_claims(code_hash,account_id,run_ids,created_at,expires_at) VALUES(?,?,?,?,?)",
  ).run(hashCode(raw), accountId, JSON.stringify(runIds), now, expiresAt);
  return { code: raw.slice(0, 5) + "-" + raw.slice(5), expiresAt };
}
export function redeemClaim(db, code, owner, now = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const claim = db
      .prepare("SELECT * FROM publisher_claims WHERE code_hash=?")
      .get(hashCode(code));
    if (!claim || claim.used_at !== null || claim.expires_at <= now)
      throw Error("绑定码无效、已使用或已过期");
    const account = db
      .prepare("SELECT id,platform,label FROM publisher_accounts WHERE id=?")
      .get(claim.account_id);
    if (!account) throw Error("绑定账号不存在");
    db.prepare(
      "UPDATE publisher_claims SET used_at=?,used_by=? WHERE code_hash=?",
    ).run(now, owner, claim.code_hash);
    db.prepare("UPDATE publisher_accounts SET owner=? WHERE id=?").run(
      owner,
      account.id,
    );
    const jobs = Number(
      db
        .prepare("UPDATE publisher_jobs SET owner=? WHERE account_id=?")
        .run(owner, account.id).changes,
    );
    let runs = 0;
    for (const id of JSON.parse(claim.run_ids))
      runs += Number(
        db.prepare("UPDATE runs SET owner=? WHERE id=?").run(owner, id).changes,
      );
    db.exec("COMMIT");
    return { account, jobs, runs };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
