import { randomUUID } from "node:crypto";

import type { BugReport, FeatureSpec, TestRun, WorkflowJob } from "../types/domain.js";

export interface TestRunner {
  runFeatureTests(feature: FeatureSpec): Promise<TestRun>;
  runFlowTests(features: FeatureSpec[]): Promise<TestRun>;
  runAcceptanceTests(job: WorkflowJob): Promise<TestRun>;
}

export class MockTestRunner implements TestRunner {
  private readonly attempts = new Map<string, number>();

  async runFeatureTests(feature: FeatureSpec): Promise<TestRun> {
    const attempt = (this.attempts.get(feature.id) ?? 0) + 1;
    this.attempts.set(feature.id, attempt);

    if (attempt === 1) {
      const bug: BugReport = {
        id: randomUUID(),
        featureId: feature.id,
        title: `${feature.name} fails its first validation pass`,
        description:
          "The mock runner intentionally fails the first feature test to exercise the fix loop.",
        severity: "medium",
        status: "open",
      };

      return {
        id: randomUUID(),
        scope: "feature",
        targetId: feature.id,
        passed: false,
        summary: `${feature.name} failed automated validation on attempt ${attempt}.`,
        bugs: [bug],
        createdAt: new Date().toISOString(),
      };
    }

    return {
      id: randomUUID(),
      scope: "feature",
      targetId: feature.id,
      passed: true,
      summary: `${feature.name} passed automated validation on attempt ${attempt}.`,
      bugs: [],
      createdAt: new Date().toISOString(),
    };
  }

  async runFlowTests(features: FeatureSpec[]): Promise<TestRun> {
    const unfinished = features.filter((feature) => feature.status !== "done");

    return {
      id: randomUUID(),
      scope: "flow",
      passed: unfinished.length === 0,
      summary:
        unfinished.length === 0
          ? "All completed features passed the end-to-end flow test."
          : `Flow test blocked because ${unfinished.length} features are not done yet.`,
      bugs: [],
      createdAt: new Date().toISOString(),
    };
  }

  async runAcceptanceTests(job: WorkflowJob): Promise<TestRun> {
    const openBugs = job.bugReports.filter((bug) => bug.status === "open");

    return {
      id: randomUUID(),
      scope: "acceptance",
      passed: openBugs.length === 0,
      summary:
        openBugs.length === 0
          ? "Acceptance tests passed with no remaining open bugs."
          : `Acceptance tests blocked by ${openBugs.length} open bugs.`,
      bugs: [],
      createdAt: new Date().toISOString(),
    };
  }
}
