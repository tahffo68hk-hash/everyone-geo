// Preload before any Prisma or application module; also works as Jest setupFiles.
const path = require("node:path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../../.env"),
  quiet: true,
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl || !testDatabaseUrl.trim()) {
  throw new Error("TEST_DATABASE_URL is required; database tests refuse to use DATABASE_URL.");
}

let url;
let databaseName;
try {
  url = new URL(testDatabaseUrl);
  databaseName = decodeURIComponent(url.pathname.slice(1));
} catch {
  throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL for geo_test.");
}

if (!["postgres:", "postgresql:"].includes(url.protocol) || databaseName !== "geo_test") {
  throw new Error("TEST_DATABASE_URL must target the dedicated geo_test database.");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
