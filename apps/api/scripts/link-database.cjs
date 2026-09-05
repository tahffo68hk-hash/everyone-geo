/**
 * GeoLens exFAT workaround：将 packages/database 同步为 apps/api/node_modules/@geo/database。
 *
 * 背景：项目位于 V:\ (exFAT)，不支持 symlink/junction，pnpm workspace 内部依赖
 * （如 @geo/database）默认以 symlink 连接会抛 EISDIR 导致 install 失败。
 * node-linker=hoisted 仅解决第三方依赖，workspace 交叉依赖仍需本脚本兜底。
 *
 * 本脚本作为 apps/api 的 postinstall 自动执行（每次 pnpm install 后重建拷贝）。
 * 注意：apps/api/package.json 中因此不能以 workspace:* 声明 @geo/database，
 * 需由 tsconfig / 编译器解析类型，运行时依赖本拷贝。
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const src = path.join(root, "packages", "database");
const dest = path.join(__dirname, "..", "node_modules", "@geo", "database");

function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

if (!fs.existsSync(src)) {
  console.error("[link-database] 未找到 packages/database：", src);
  process.exit(1);
}

copyDir(src, dest);
console.log("[link-database] @geo/database 已同步 ->", dest);
