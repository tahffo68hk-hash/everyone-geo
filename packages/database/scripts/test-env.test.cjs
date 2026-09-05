const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const guard = path.join(__dirname, "test-env.cjs");
const originalDatabaseUrl = "postgresql://example:example@localhost/geo";

function runGuard(testUrl) {
  return spawnSync(process.execPath, [
    "--require", guard, "--eval",
    'process.stdout.write(JSON.stringify({ databaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV }))',
  ], {
    // An explicit empty value also prevents a developer .env from masking
    // the missing-configuration case tested in this separate process.
    env: { ...process.env, DATABASE_URL: originalDatabaseUrl, TEST_DATABASE_URL: testUrl, NODE_ENV: "development" },
    encoding: "utf8",
    cwd: path.parse(__dirname).root,
  });
}

for (const [label, url] of [
  ["missing explicit test URL", ""],
  ["blank test URL", "   "],
  ["development database", "postgresql://example:example@localhost/geo"],
  ["test marker in username only", "postgresql://geo_test:example@localhost/geo"],
  ["test marker in host only", "postgresql://example:example@geo_test/geo"],
  ["test marker in query only", "postgresql://example:example@localhost/geo?schema=geo_test"],
  ["different test database", "postgresql://example:example@localhost/other_test"],
  ["encoded development database", "postgresql://example:example@localhost/%67eo"],
  ["encoded slash", "postgresql://example:example@localhost/geo_test%2Fgeo"],
  ["invalid percent encoding", "postgresql://example:example@localhost/%ZZ"],
  ["non-PostgreSQL protocol", "https://localhost/geo_test"],
  ["malformed URL", "not-a-url"],
]) {
  test(`rejects ${label} before executing the application`, () => {
    const result = runGuard(url);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TEST_DATABASE_URL/);
    assert.equal(result.stdout, "");
  });
}

for (const url of [
  "postgresql://example:example@localhost/geo_test?schema=public",
  "postgres://example:example@localhost/geo_test",
  "postgresql://example:example@localhost/geo%5Ftest",
]) {
  test(`accepts and preloads the dedicated database (${new URL(url).pathname})`, () => {
    const result = runGuard(url);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { databaseUrl: url, nodeEnv: "test" });
  });
}
