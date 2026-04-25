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

export class DeliveryOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async createJob(rawRequirement: string): Promise<WorkflowJob> {
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
    await this.transition(jobId, "spec_confirmed", "Spec confirmed and ready for UI generation.");

    let job = await this.deps.store.get(jobId);
    const uiPreparation = await this.executeAgent(jobId, "spec_confirmed", this.deps.uiAgent, {
      requirement: job.requirement,
    });
    const submission = await this.deps.stitchClient.submit(uiPreparation.data.prompt);
    await this.transition(
      jobId,
      "ui_generating",
      `Submitted the approved requirement to Stitch as ${submission.stitchJobId}.`,
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
  }): Promise<UiArtifact> {
    // Browser automation and polling remain deterministic tool work. The agent
    // only decides when the workflow should call this tool and how to use the result.
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
    const context = createExecutionContext(agent.definition, jobId, stage, this.deps.baseDir);
    const result = await agent.run(input, context);

    // Prompt instructions alone are too weak for file safety. The orchestrator
    // validates the agent's declared write set against the configured scopes here.
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
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      bugReports: current.bugReports.map((bug) =>
        bug.featureId === featureId ? { ...bug, status: "fixed" } : bug,
      ),
    }));
  }

  private async blockJob(jobId: string, reason: string): Promise<WorkflowJob> {
    await this.transition(jobId, "blocked", reason);
    return this.deps.store.get(jobId);
  }

  private requireFeature(job: WorkflowJob, featureId: string): FeatureSpec {
    const feature = job.requirement.features.find((item) => item.id === featureId);
    if (!feature) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    return feature;
  }
}

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

function formatAgentEvent(record: AgentRunRecord): string {
  return `${record.agentName}: ${record.summary} Next: ${record.nextAction}.`;
}

function mergeBugReports(existing: BugReport[], incoming: BugReport[]): BugReport[] {
  const known = new Map(existing.map((bug) => [bug.id, bug]));
  for (const bug of incoming) {
    known.set(bug.id, bug);
  }

  return [...known.values()];
}

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
