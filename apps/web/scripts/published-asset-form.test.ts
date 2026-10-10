import assert from "node:assert/strict";
import test from "node:test";
import {
  validateRegistrationCandidate,
  type RegistrationCandidate,
} from "../src/lib/published-asset-form";

// The intended repository destination is apps/web/scripts/published-asset-form.test.ts.
// When integrating, this relative import resolves to apps/web/src/lib/published-asset-form.ts.
const NOW = new Date("2026-10-10T12:00:00.000Z");

function candidate(overrides: Partial<RegistrationCandidate> = {}): RegistrationCandidate {
  return {
    projectId: "project-1",
    draftId: "draft-1",
    revisionId: "revision-1",
    title: "  产品上线公告  ",
    platform: "  WECHAT  ",
    verificationStatus: "UNVERIFIED",
    actualPublishedAt: null,
    userConfirmed: true,
    ...overrides,
  };
}

function expectsError(input: RegistrationCandidate, key: keyof RegistrationCandidate, now = NOW): void {
  const result = validateRegistrationCandidate(input, now);
  assert.equal(result.ok, false, `expected validation error on ${key}`);
  if (!result.ok) assert.ok(result.errors[key], `no error message for ${key}`);
}

test("UNVERIFIED accepts unknown timestamp and no URL/ID, with explicit confirmation", () => {
  const result = validateRegistrationCandidate(candidate(), NOW);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.actualPublishedAt, null);
    assert.equal(result.value.title, "产品上线公告");
    assert.equal(result.value.platform, "WECHAT");
    assert.equal(result.value.verificationStatus, "UNVERIFIED");
    assert.equal(result.value.userConfirmed, true);
  }
});

test("optional empty values are omitted; project lineage is preserved", () => {
  const result = validateRegistrationCandidate(candidate({
    publicationId: "  ", canonicalUrl: "  ", externalAssetId: " \n ", verificationNote: "  ",
  }), NOW);
  assert.equal(result.ok, true);
  if (result.ok) {
    for (const key of ["publicationId", "canonicalUrl", "externalAssetId", "verificationNote"] as const) {
      assert.equal(Object.hasOwn(result.value, key), false);
    }
    assert.equal(result.value.projectId, "project-1");
    assert.equal(result.value.draftId, "draft-1");
    assert.equal(result.value.revisionId, "revision-1");
  }
});

test("nonempty optional fields are trimmed and returned", () => {
  const result = validateRegistrationCandidate(candidate({
    publicationId: " publication-1 ",
    canonicalUrl: " https://publisher.example.cn/a/1 ",
    externalAssetId: " post-1 ",
    verificationNote: " checked by user ",
  }), NOW);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.publicationId, "publication-1");
    assert.equal(result.value.canonicalUrl, "https://publisher.example.cn/a/1");
    assert.equal(result.value.externalAssetId, "post-1");
    assert.equal(result.value.verificationNote, "checked by user");
  }
});

test("lineage identifiers, title and platform are required", () => {
  for (const key of ["projectId", "draftId", "revisionId", "title", "platform"] as const) {
    expectsError(candidate({ [key]: " \t " }), key);
  }
});

test("title and platform enforce 256/64 character limits", () => {
  expectsError(candidate({ title: "中".repeat(257) }), "title");
  expectsError(candidate({ platform: "P".repeat(65) }), "platform");
  assert.equal(validateRegistrationCandidate(candidate({ title: "中".repeat(256), platform: "P".repeat(64) }), NOW).ok, true);
});

test("all submissions require userConfirmed === true", () => {
  expectsError(candidate({ userConfirmed: false }), "userConfirmed");
});

test("PLATFORM_CONFIRMED and unknown statuses are not selectable", () => {
  for (const status of ["PLATFORM_CONFIRMED", "UNKNOWN"]) {
    expectsError(candidate({ verificationStatus: status as RegistrationCandidate["verificationStatus"] }), "verificationStatus");
  }
});

test("MANUAL_VERIFIED requires a URL or ID, a note, and timestamp", () => {
  const input = candidate({ verificationStatus: "MANUAL_VERIFIED" });
  const result = validateRegistrationCandidate(input, NOW);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.canonicalUrl);
    assert.ok(result.errors.externalAssetId);
    assert.ok(result.errors.verificationNote);
    assert.ok(result.errors.actualPublishedAt);
  }
});

test("MANUAL_VERIFIED accepts a real URL OR external ID with note and zoned time", () => {
  const common = {
    verificationStatus: "MANUAL_VERIFIED" as const,
    verificationNote: "已由人工核查来源与记录",
    actualPublishedAt: "2026-10-10T15:30:00+08:00",
  };
  assert.equal(validateRegistrationCandidate(candidate({ ...common, canonicalUrl: "https://publisher.example.cn/post/123" }), NOW).ok, true);
  assert.equal(validateRegistrationCandidate(candidate({ ...common, externalAssetId: "real-platform-post-123" }), NOW).ok, true);
});

test("invalid URLs: relative, non-http, credentials, invalid syntax", () => {
  for (const bad of ["/post/123", "javascript:alert(1)", "ftp://publisher.example.cn/post", "https://user:pass@publisher.example.cn/post", "https://@publisher.example.cn/post", "https://%/"]) {
    expectsError(candidate({ canonicalUrl: bad }), "canonicalUrl");
  }
});

test("rejects synthetic Mock/Fake URLs including simple encoded paths", () => {
  for (const bad of [
    "https://mock.example.cn/p/1",
    "https://mock123.example.cn/p/1",
    "https://fake-site.example.cn/p/1",
    "https://publisher.example.cn/posts/mock_1",
    "https://publisher.example.cn/posts/%6d%6f%63%6b_1",
    "https://publisher.example.cn/posts/1?source=fake",
  ]) {
    expectsError(candidate({ canonicalUrl: bad }), "canonicalUrl");
  }
});

test("rejects localhost and IPv4/IPv6 loopback URLs", () => {
  for (const bad of [
    "http://localhost:3000/post", "http://localhost.localdomain/post", "http://preview.localhost/post", "http://127.0.0.1/p", "http://127.8.1.2/p", "http://[::1]/post", "http://0.0.0.0/post",
  ]) {
    expectsError(candidate({ canonicalUrl: bad }), "canonicalUrl");
  }
});

test("optional URL, external ID, note and publication ID enforce size limits", () => {
  expectsError(candidate({ canonicalUrl: `https://publisher.example.cn/${"x".repeat(1030)}` }), "canonicalUrl");
  expectsError(candidate({ externalAssetId: "x".repeat(257) }), "externalAssetId");
  expectsError(candidate({ verificationNote: "x".repeat(2001) }), "verificationNote");
  expectsError(candidate({ publicationId: "x".repeat(257) }), "publicationId");
});

test("rejects explicit mock/fake IDs without banning ordinary platform IDs", () => {
  for (const bad of ["mock", "MOCK-123", "mock_abc", "fake", "fake_foo", "FAKE-2"]) {
    expectsError(candidate({ externalAssetId: bad }), "externalAssetId");
  }
  assert.equal(validateRegistrationCandidate(candidate({ externalAssetId: "real-asset-1" }), NOW).ok, true);
});

test("timestamp must have an explicit Z or numeric timezone", () => {
  for (const bad of ["2026-10-10T11:30:00", "2026-10-10 11:30:00", "10/10/2026 11:30", "2026-10-10T12:00:00UTC"]) {
    expectsError(candidate({ actualPublishedAt: bad }), "actualPublishedAt");
  }
});

test("rejects impossible dates and invalid clock/offset components", () => {
  for (const bad of [
    "2026-02-30T10:00:00+08:00", "2026-13-01T10:00:00Z", "2026-10-10T25:00:00Z",
    "2026-10-10T10:61:00Z", "2026-10-10T10:00:00+24:00", "2026-10-10T10:00:00+08:90",
  ]) {
    expectsError(candidate({ actualPublishedAt: bad }), "actualPublishedAt");
  }
});

test("the supplied now controls future-time comparison (no hidden Date.now)", () => {
  const timestamp = "2026-10-10T12:01:00Z";
  expectsError(candidate({ actualPublishedAt: timestamp }), "actualPublishedAt", NOW);
  assert.equal(validateRegistrationCandidate(candidate({ actualPublishedAt: timestamp }), new Date("2026-10-10T12:02:00Z")).ok, true);
});

test("equal current instant and equivalent timezones are allowed", () => {
  assert.equal(validateRegistrationCandidate(candidate({ actualPublishedAt: "2026-10-10T12:00:00Z" }), NOW).ok, true);
  assert.equal(validateRegistrationCandidate(candidate({ actualPublishedAt: "2026-10-10T20:00:00+08:00" }), NOW).ok, true);
});

test("UNVERIFIED can omit time, but a supplied future or invalid time is rejected", () => {
  assert.equal(validateRegistrationCandidate(candidate({ actualPublishedAt: null }), NOW).ok, true);
  expectsError(candidate({ actualPublishedAt: "2026-10-10T20:01:00+08:00" }), "actualPublishedAt");
  expectsError(candidate({ actualPublishedAt: "tomorrow" }), "actualPublishedAt");
});

test("MANUAL_VERIFIED cannot supply an empty timestamp", () => {
  expectsError(candidate({
    verificationStatus: "MANUAL_VERIFIED", externalAssetId: "real-1", verificationNote: "人工已确认", actualPublishedAt: "   ",
  }), "actualPublishedAt");
});

test("invalid reference now blocks a candidate", () => {
  expectsError(candidate(), "actualPublishedAt", new Date(Number.NaN));
});
