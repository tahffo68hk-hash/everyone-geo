import { openStore } from "./publisher/store.mjs";
import { createClaim } from "./publisher/claims.mjs";
const [accountId, ...args] = process.argv.slice(2),
  runs = [];
let ttl = 24;
try {
  if (!accountId)
    throw Error(
      "用法：claim-code.mjs <accountId> [--run <runId>] [--ttl-hours N]",
    );
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run" && args[i + 1]) runs.push(args[++i]);
    else if (args[i] === "--ttl-hours" && args[i + 1]) ttl = Number(args[++i]);
    else throw Error("参数无效");
  }
  const db = openStore();
  try {
    const result = createClaim(db, accountId, runs, ttl);
    console.log(
      result.code + "\n到期：" + new Date(result.expiresAt).toISOString(),
    );
  } finally {
    db.close();
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
