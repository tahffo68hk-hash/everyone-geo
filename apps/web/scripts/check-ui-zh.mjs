/**
 * UX-CN 中文优先回归守卫（启发式）：
 * 扫描 apps/web/src 中「纯英文的 JSX 文本节点 / label・placeholder・title・aria-label」，
 * 出现普通 UI 英文即报错 —— 防未来某页漏译或回退。
 *
 * 保留规则（不视为违规）：
 * - 含 CJK 的节点（中英并列允许）
 * - 纯技术标识：品牌/模型/Provider、commit hash、Run ID、PID、HTTP 状态、版本号、
 *   Mx 里程碑号、analysisVersion / sourceType 等 API 术语、URL、rawPrompt/rawResponse
 * - 数值/符号/单位节点
 * 用法：node scripts/check-ui-zh.mjs   （违规→exit 1）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const ext = (f) => f.endsWith(".tsx") || f.endsWith(".ts");
const walk = (d, acc = []) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (ext(name)) acc.push(p);
  }
  return acc;
};

// 常见普通 UI 英文（整词出现即命中）
const BANNED =
  /\b(Start|Cancel|Save|Submit|Loading|No data|No runs|No evidence|No candidates|No benchmark runs|Sign in|Logout|Email|Password|Dashboard|Benchmark|Competitor|Candidate|Evidence|Query|Queries|Status|Provider|Engine|Version|Category|Intent|Reject|Approve|Activate|Share of Voice|System Status|Quick Actions|Project Progress|Project Control Center|Overall Progress|Current Development Stage|Open Dashboard|Refresh Status|Running|Healthy|Ready|Pass|Fail|Configured|Enabled|Disabled|Unknown|Succeeded|Failed|Pending|Name|Demo|Real|Mock)\b/;

// 纯技术内容：整节点只含这些 → 放行（大小写不敏感）
const TECHNICAL =
  /^(GeoLens|ProjectMentor|DeepSeek|ChatGPT|Claude|Gemini|Notion|Copilot|Bing|OpenAI|Web|API|Worker|PostgreSQL|Redis|DeepSeek API|PID|Run ID|commit|HTTP|OK|PONG|alice@geolens\.local|Password123!?|m4-rule-v1|m6b-competitors-v1|geolens-v1|deepseek-chat|deepseek-v4-flash|deepseek-api|official_api|api_plain|third_party_api|manual|estimated|rawPrompt|rawResponse|sourceType|retrievalMode|metricSource|analysisVersion|competitorType|canonicalName|aliases|dataType|README|START_GEOLENS\.cmd|STOP_GEOLENS\.cmd|localhost|M[0-9]+(?:\.[0-9]+)?[A-Z]?|v[0-9]+(?:\.[0-9]+)?|sanity|Mock|Demo|Real|REAL)(\s|$)/i;

const isEnglishNode = (t) => /^[A-Za-z][A-Za-z0-9 .'’:/()_\-+·#,&!?%]{0,80}$/.test(t);

const violations = [];

function checkText(text, file, kind) {
  const t = text.trim();
  if (!t || !isEnglishNode(t) || TECHNICAL.test(t)) return;
  if (BANNED.test(t)) violations.push({ file, kind, text: t.slice(0, 90) });
}

const files = walk(SRC);
for (const file of files) {
  const code = readFileSync(file, "utf8");
  // JSX 文本节点（忽略含 {} 的表达式节点）
  const textRe = />([^<>{}]*?)</g;
  let m;
  while ((m = textRe.exec(code))) checkText(m[1], file, "text");
  // 可见属性字符串
  const propRe = /\b(placeholder|title|aria-label|label)="([^"]*)"/g;
  while ((m = propRe.exec(code))) checkText(m[2], file, `attr:${m[1]}`);
}

if (violations.length === 0) {
  console.log(`[check-ui-zh] PASS —— 扫描 ${files.length} 个文件，未发现纯英文 UI 节点（技术标识除外）`);
  process.exit(0);
}
console.log(`[check-ui-zh] FAIL —— ${violations.length} 处疑似未中文化：`);
for (const v of violations) console.log(`  ${relative(ROOT, v.file)} [${v.kind}] "${v.text}"`);
process.exit(1);
