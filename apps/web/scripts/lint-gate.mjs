/**
 * Non-interactive lint entry.
 * `next lint` asks to create an ESLint config when none exists. That prompt
 * is not a pass, and it can hang a non-interactive CI job. Fail closed until
 * a config file is actually checked in; then run `next lint`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configs = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
];

if (!configs.some((name) => existsSync(join(appRoot, name)))) {
  console.error(
    "ESLint is not configured for @geolens/web. Lint fails closed instead of prompting or passing.",
  );
  process.exit(1);
}

const result = spawnSync("pnpm", ["exec", "next", "lint"], {
  cwd: appRoot,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
