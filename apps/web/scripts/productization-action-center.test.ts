import assert from "node:assert/strict";
import test from "node:test";
import { deriveActionItems } from "../src/lib/action-center";

test("derives first-hour setup in order without inventing a score", () => {
  const items = deriveActionItems({
    projectId: "project-1",
    hasTarget: false,
    suiteCount: 0,
    queryCount: 0,
    activity: [],
  });
  assert.equal(items[0]?.id, "setup-target");
  assert.equal(items[0]?.href, "/app/target?project=project-1");
});

test("derives measurement and diagnosis actions from existing state", () => {
  const measurement = deriveActionItems({
    projectId: "project-1",
    hasTarget: true,
    suiteCount: 1,
    queryCount: 6,
    activity: [],
  });
  assert.equal(measurement[0]?.id, "run-first-measurement");

  const diagnosis = deriveActionItems({
    projectId: "project-1",
    hasTarget: true,
    suiteCount: 1,
    queryCount: 6,
    latestReportId: "report-1",
    latestReportHasDiagnosis: false,
    activity: [],
  });
  assert.equal(diagnosis[0]?.id, "review-diagnosis");
});

test("keeps content and verification actions task-oriented", () => {
  const items = deriveActionItems({
    projectId: "project-1",
    hasTarget: true,
    suiteCount: 1,
    queryCount: 6,
    latestReportId: "report-1",
    latestReportHasDiagnosis: true,
    activity: [],
    drafts: [{ id: "draft-1", status: "READY_FOR_REVIEW" }],
    assets: [{ id: "asset-1", title: "Guide", latestRetest: null }],
  });
  assert.deepEqual(items.map((item) => item.kind), ["content", "verification"]);
  assert.ok(items.every((item) => !item.title.includes("查看详情")));
});
