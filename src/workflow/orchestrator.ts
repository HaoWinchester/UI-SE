import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Agent, AgentDefinition, AgentExecutionContext, AgentResult } from "../agents/base.js";
import { createExecutionContext } from "../agents/base.js";
import { DeployAgent } from "../agents/deploy-agent.js";
import { DevAgent } from "../agents/dev-agent.js";
import { FixAgent } from "../agents/fix-agent.js";
import type { DraftSpecInput, DraftSpecOutput } from "../agents/spec-agent.js";
import { MonitorAgent } from "../agents/monitor-agent.js";
import { SpecAgent } from "../agents/spec-agent.js";
import { TestAgent } from "../agents/test-agent.js";
import { UiAgent } from "../agents/ui-agent.js";
import { InMemoryJobStore, type JobStore } from "../storage/job-store.js";
import { MockDeployer, type Deployer } from "../tools/deployer.js";
import { createStitchClientFromEnv, type StitchClient } from "../tools/stitch-client.js";
import { MockTestRunner, type TestRunner } from "../tools/test-runner.js";
import type {
  AgentRunRecord,
  BugReport,
  FeatureSpec,
  JobStage,
  TestRun,
  UiArtifact,
  WorkflowJob,
} from "../types/domain.js";
import { assertPathsWithinScopes } from "./workspace-policy.js";

// 这里把 orchestrator 依赖的所有组件集中列出来，
// 方便后面替换真实存储、真实测试器、真实部署器。
interface OrchestratorDependencies {
  store: JobStore;
  specAgent: SpecAgent;
  uiAgent: UiAgent;
  devAgent: DevAgent;
  testAgent: TestAgent;
  fixAgent: FixAgent;
  monitorAgent: MonitorAgent;
  deployAgent: DeployAgent;
  stitchClient: StitchClient;
  testRunner: TestRunner;
  deployer: Deployer;
  baseDir: string;
}

// DeliveryOrchestrator 是整套系统的总调度器。
// 它本身不负责“思考”每个业务细节，而是负责按阶段调用 agent 和工具。
export class DeliveryOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async createJob(rawRequirement: string): Promise<WorkflowJob> {
    // 新任务创建时，先让 spec-agent 把自然语言需求整理成结构化 requirement。
    const jobId = randomUUID();
    const specExecution = await this.prepareAgentRun(
      jobId,
      "drafting_spec",
      this.deps.specAgent,
      { rawRequirement },
    );
    const now = specExecution.record.createdAt;

    const job: WorkflowJob = {
      id: jobId,
      requirement: specExecution.result.data.requirement,
      stage: "drafting_spec",
      bugReports: [],
      testRuns: [],
      agentRuns: [specExecution.record],
      events: [
        {
          stage: "drafting_spec",
          message: formatAgentEvent(specExecution.record),
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    await this.deps.store.create(job);
    return this.deps.store.get(job.id);
  }

  async run(jobId: string): Promise<WorkflowJob> {
    // 这是主流程入口：从 spec 确认一路推进到 UI 生成、开发、测试、验收和部署。
    await this.transition(jobId, "spec_confirmed", "Spec confirmed and ready for UI generation.");

    let job = await this.deps.store.get(jobId);
    const uiPreparation = await this.executeAgent(jobId, "spec_confirmed", this.deps.uiAgent, {
      requirement: job.requirement,
    });
    const submission = await this.deps.stitchClient.submit(uiPreparation.data.prompt);
    await this.transition(
      jobId,
      "ui_generating",
      submission.note
        ? `Submitted the approved requirement to Stitch as ${submission.stitchJobId}. ${submission.note}`
        : `Submitted the approved requirement to Stitch as ${submission.stitchJobId}.`,
    );

    const uiArtifact = await this.waitForUiArtifact(submission);
    if (uiArtifact.status === "failed") {
      return this.blockJob(jobId, `Stitch job ${submission.stitchJobId} failed before download.`);
    }

    await this.deps.store.update(jobId, (current) => ({
      ...current,
      uiArtifact,
    }));
    await this.transition(
      jobId,
      "ui_ready",
      `Downloaded the generated UI artifact to ${uiArtifact.downloadPath}.`,
    );

    job = await this.deps.store.get(jobId);
    // 每个功能点按顺序进入“开发 -> 测试 -> 必要时修复 -> 再测试”的循环。
    for (const feature of job.requirement.features) {
      const result = await this.developFeature(jobId, feature.id);
      if (result.stage === "blocked") {
        return result;
      }
    }

    job = await this.deps.store.get(jobId);
    await this.transition(
      jobId,
      "running_flow_tests",
      "Running the workflow test across all completed features.",
    );
    const flowRun = await this.deps.testRunner.runFlowTests(job.requirement.features);
    await this.recordTest(jobId, flowRun);
    if (!flowRun.passed) {
      return this.blockJob(jobId, flowRun.summary);
    }

    job = await this.deps.store.get(jobId);
    await this.transition(
      jobId,
      "verifying_alignment",
      "Checking that the implementation still matches the approved requirement.",
    );
    const monitorResult = await this.executeAgent(
      jobId,
      "verifying_alignment",
      this.deps.monitorAgent,
      { job },
    );
    if (monitorResult.status === "blocked" || !monitorResult.data.aligned) {
      return this.blockJob(jobId, monitorResult.summary);
    }

    job = await this.deps.store.get(jobId);
    await this.transition(
      jobId,
      "running_acceptance",
      "Running final acceptance tests before deployment.",
    );
    const acceptanceRun = await this.deps.testRunner.runAcceptanceTests(job);
    await this.recordTest(jobId, acceptanceRun);
    if (!acceptanceRun.passed) {
      return this.blockJob(jobId, acceptanceRun.summary);
    }

    await this.transition(jobId, "deploying", "Preparing deployment approval and release.");
    job = await this.deps.store.get(jobId);
    const deployDecision = await this.executeAgent(jobId, "deploying", this.deps.deployAgent, {
      job,
    });
    if (deployDecision.status === "blocked" || !deployDecision.data.approved) {
      return this.blockJob(jobId, deployDecision.summary);
    }

    job = await this.deps.store.get(jobId);
    const deployment = await this.deps.deployer.deploy(job, deployDecision.data.environment);
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      deployment,
    }));

    await this.transition(jobId, "done", `Deployment completed in ${deployment.environment}.`);
    return this.deps.store.get(jobId);
  }

  private async developFeature(jobId: string, featureId: string): Promise<WorkflowJob> {
    // 这里封装了单个功能点的完整生命周期，避免主流程被大量细节淹没。
    let job = await this.deps.store.get(jobId);
    const feature = this.requireFeature(job, featureId);

    await this.transition(jobId, "implementing_feature", `Implementing feature "${feature.name}".`);
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      status: "in_development",
      implementationAttempts: current.implementationAttempts + 1,
    }));

    job = await this.deps.store.get(jobId);
    const refreshedFeature = this.requireFeature(job, featureId);
    await this.executeAgent(jobId, "implementing_feature", this.deps.devAgent, {
      feature: refreshedFeature,
      uiArtifactPath: job.uiArtifact?.downloadPath ?? "",
    });
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      status: "awaiting_test",
    }));

    await this.transition(
      jobId,
      "testing_feature",
      `Running automated validation for "${refreshedFeature.name}".`,
    );
    const firstRun = await this.deps.testRunner.runFeatureTests(refreshedFeature);
    await this.recordTest(jobId, firstRun);
    const firstTriage = await this.executeAgent(jobId, "testing_feature", this.deps.testAgent, {
      feature: refreshedFeature,
      testRun: firstRun,
    });

    if (!firstTriage.data.shouldFix) {
      await this.updateFeature(jobId, featureId, (current) => ({
        ...current,
        status: "done",
      }));
      await this.markFeatureBugsFixed(jobId, featureId);
      return this.deps.store.get(jobId);
    }

    await this.transition(
      jobId,
      "fixing_feature",
      `Entering the repair loop for "${refreshedFeature.name}".`,
    );
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      status: "fixing",
    }));

    await this.executeAgent(jobId, "fixing_feature", this.deps.fixAgent, {
      feature: refreshedFeature,
      bugReports: firstRun.bugs,
    });
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      status: "awaiting_test",
    }));

    await this.transition(
      jobId,
      "testing_feature",
      `Re-running automated validation for "${refreshedFeature.name}".`,
    );
    const updatedFeature = this.requireFeature(await this.deps.store.get(jobId), featureId);
    const secondRun = await this.deps.testRunner.runFeatureTests(updatedFeature);
    await this.recordTest(jobId, secondRun);
    const secondTriage = await this.executeAgent(jobId, "testing_feature", this.deps.testAgent, {
      feature: updatedFeature,
      testRun: secondRun,
    });

    if (secondTriage.data.shouldFix) {
      await this.updateFeature(jobId, featureId, (current) => ({
        ...current,
        status: "blocked",
      }));
      return this.blockJob(jobId, `Feature "${updatedFeature.name}" still fails after one fix loop.`);
    }

    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      status: "done",
    }));
    await this.markFeatureBugsFixed(jobId, featureId);

    return this.deps.store.get(jobId);
  }

  private async waitForUiArtifact(submission: {
    stitchJobId: string;
    projectId?: string;
    screenId?: string;
    runtime: "real" | "mock";
    note?: string;
  }): Promise<UiArtifact> {
    // 轮询、下载这类动作仍然属于确定性的工具层工作。
    // agent 只负责决定“什么时候调用它”和“结果如何进入下一步”。
    for (let poll = 0; poll < 5; poll += 1) {
      const status = await this.deps.stitchClient.getStatus(submission.stitchJobId);
      if (status === "completed") {
        const download = await this.deps.stitchClient.downloadResult(
          submission.stitchJobId,
          path.join(this.deps.baseDir, "artifacts", "ui"),
        );

        return {
          stitchJobId: submission.stitchJobId,
          projectId: submission.projectId,
          screenId: submission.screenId,
          downloadPath: download.downloadPath,
          htmlPath: download.htmlPath,
          imagePath: download.imagePath,
          metadataPath: download.metadataPath,
          runtime: submission.runtime,
          note: submission.note ?? download.note,
          status: "ready",
        };
      }

      if (status === "failed") {
        return {
          stitchJobId: submission.stitchJobId,
          downloadPath: "",
          runtime: submission.runtime,
          status: "failed",
        };
      }
    }

    throw new Error(`Timed out while waiting for Stitch job ${submission.stitchJobId}.`);
  }

  private async prepareAgentRun<Input, Output>(
    jobId: string,
    stage: JobStage,
    agent: Agent<Input, Output>,
    input: Input,
  ): Promise<{ context: AgentExecutionContext; result: AgentResult<Output>; record: AgentRunRecord }> {
    // 每次执行 agent 前，先组装上下文，再真正调用 agent。
    const context = createExecutionContext(agent.definition, jobId, stage, this.deps.baseDir);
    const result = await agent.run(input, context);

    // 仅靠 prompt 约束文件权限是不够的，
    // 所以 orchestrator 会在这里强制校验 agent 返回的改动范围。
    assertPathsWithinScopes(result.changedFiles, context.writeScopes);

    return {
      context,
      result,
      record: buildAgentRunRecord(agent.definition, context, result),
    };
  }

  private async executeAgent<Input, Output>(
    jobId: string,
    stage: JobStage,
    agent: Agent<Input, Output>,
    input: Input,
  ): Promise<AgentResult<Output>> {
    // executeAgent 会顺带把运行记录和事件日志写回 store，
    // 这样后面排查流程时可以看到每一步是谁做的、做了什么判断。
    const execution = await this.prepareAgentRun(jobId, stage, agent, input);

    await this.deps.store.update(jobId, (current) => ({
      ...current,
      agentRuns: [...current.agentRuns, execution.record],
      events: [
        ...current.events,
        {
          stage,
          message: formatAgentEvent(execution.record),
          createdAt: execution.record.createdAt,
        },
      ],
    }));

    return execution.result;
  }

  private async transition(jobId: string, stage: JobStage, message: string): Promise<void> {
    // 所有阶段切换统一走这里，方便保证 stage 和事件日志始终同步。
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      stage,
      events: [
        ...current.events,
        {
          stage,
          message,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
  }

  private async recordTest(jobId: string, testRun: TestRun): Promise<void> {
    // 测试结果写回后，不只是追加 testRuns，
    // 还会同步更新 bug 列表和对应 feature 的 testAttempts。
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      bugReports: mergeBugReports(current.bugReports, testRun.bugs),
      testRuns: [...current.testRuns, testRun],
      requirement:
        testRun.scope === "feature" && testRun.targetId
          ? {
              ...current.requirement,
              features: current.requirement.features.map((feature) =>
                feature.id === testRun.targetId
                  ? {
                      ...feature,
                      testAttempts: feature.testAttempts + 1,
                    }
                  : feature,
              ),
            }
          : current.requirement,
      events: [
        ...current.events,
        {
          stage: current.stage,
          message: `Test run (${testRun.scope}): ${testRun.summary}`,
          createdAt: testRun.createdAt,
        },
      ],
    }));
  }

  private async updateFeature(
    jobId: string,
    featureId: string,
    updater: (feature: FeatureSpec) => FeatureSpec,
  ): Promise<void> {
    // 统一通过 updater 修改 feature，能减少重复的对象拷贝逻辑。
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      requirement: {
        ...current.requirement,
        features: current.requirement.features.map((feature) =>
          feature.id === featureId ? updater(feature) : feature,
        ),
      },
    }));
  }

  private async markFeatureBugsFixed(jobId: string, featureId: string): Promise<void> {
    // 当功能点最终通过时，把该功能相关的历史 bug 一并标记为 fixed。
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      bugReports: current.bugReports.map((bug) =>
        bug.featureId === featureId ? { ...bug, status: "fixed" } : bug,
      ),
    }));
  }

  private async blockJob(jobId: string, reason: string): Promise<WorkflowJob> {
    // 任意关键步骤失败后，都统一走 blocked 收口，避免流程继续向后推进。
    await this.transition(jobId, "blocked", reason);
    return this.deps.store.get(jobId);
  }

  private requireFeature(job: WorkflowJob, featureId: string): FeatureSpec {
    // 这个小工具函数的目的是把“找不到 feature”变成明确异常，
    // 避免后续代码在 undefined 上继续运行。
    const feature = job.requirement.features.find((item) => item.id === featureId);
    if (!feature) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    return feature;
  }
}

// 把一次 agent 运行转换成结构化记录，后面会落进 job.agentRuns。
function buildAgentRunRecord<Input, Output>(
  definition: AgentDefinition,
  context: AgentExecutionContext,
  result: AgentResult<Output>,
): AgentRunRecord {
  return {
    agentName: definition.name,
    stage: context.stage,
    status: result.status,
    runtimeMode: context.runtimeMode,
    modelProvider: context.model.provider,
    modelName: context.model.model,
    reasoningEffort: context.model.reasoningEffort,
    summary: result.summary,
    nextAction: result.nextAction,
    readScopes: [...context.readScopes],
    writeScopes: [...context.writeScopes],
    allowedTools: [...context.allowedTools],
    changedFiles: [...result.changedFiles],
    artifacts: [...result.artifacts],
    risks: [...result.risks],
    createdAt: new Date().toISOString(),
  };
}

// 把 agent 运行记录拼成一条简短日志，便于在 events 里浏览。
function formatAgentEvent(record: AgentRunRecord): string {
  return `${record.agentName}: ${record.summary} Next: ${record.nextAction}.`;
}

// 合并测试带回来的 bug，避免同一个 bug id 被重复插入。
function mergeBugReports(existing: BugReport[], incoming: BugReport[]): BugReport[] {
  const known = new Map(existing.map((bug) => [bug.id, bug]));
  for (const bug of incoming) {
    known.set(bug.id, bug);
  }

  return [...known.values()];
}

// 创建一套默认依赖，方便 index.ts 直接启动一个可运行的 demo。
export function createDefaultOrchestrator(baseDir: string): DeliveryOrchestrator {
  return new DeliveryOrchestrator({
    store: new InMemoryJobStore(),
    specAgent: new SpecAgent(),
    uiAgent: new UiAgent(),
    devAgent: new DevAgent(),
    testAgent: new TestAgent(),
    fixAgent: new FixAgent(),
    monitorAgent: new MonitorAgent(),
    deployAgent: new DeployAgent(),
    stitchClient: createStitchClientFromEnv(),
    testRunner: new MockTestRunner(),
    deployer: new MockDeployer(baseDir),
    baseDir,
  });
}
