// 这个文件定义测试执行层。
// 当前提供的是 mock 版本，用来演示功能测试、流程测试和验收测试的串联方式。
import { randomUUID } from "node:crypto";

import type { BugReport, FeatureSpec, TestRun, WorkflowJob } from "../types/domain.js";

// TestRunner 是测试执行层的抽象。
// 现在是 mock，后面可以替换成真正的单测、集成测试或 E2E。
export interface TestRunner {
  runFeatureTests(feature: FeatureSpec): Promise<TestRun>;
  runFlowTests(features: FeatureSpec[]): Promise<TestRun>;
  runAcceptanceTests(job: WorkflowJob): Promise<TestRun>;
}

export class MockTestRunner implements TestRunner {
  private readonly attempts = new Map<string, number>();

  async runFeatureTests(feature: FeatureSpec): Promise<TestRun> {
    // 这里故意让第一次 feature 测试失败，
    // 这样就能把 repair loop 的流程完整演示出来。
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
    // flow test 关注的是“多个功能点拼起来后的整体流程”。
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
    // acceptance test 是发布前的最后检查。
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
