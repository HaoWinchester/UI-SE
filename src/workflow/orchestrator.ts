// 这个文件是整个项目的编排核心。
// 它负责把需求澄清、UI 生成、开发、测试、修复、验收和发布串成一条完整工作流。
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Agent, AgentDefinition, AgentExecutionContext, AgentResult } from "../agents/base.js";
import { createExecutionContext } from "../agents/base.js";
import { AcceptanceAgent } from "../agents/acceptance-agent.js";
import { BackendAgent } from "../agents/backend-agent.js";
import { DbAgent } from "../agents/db-agent.js";
import { DeployAgent } from "../agents/deploy-agent.js";
import { FixAgent } from "../agents/fix-agent.js";
import { FrontendAgent } from "../agents/frontend-agent.js";
import { MonitorAgent } from "../agents/monitor-agent.js";
import { SpecAgent } from "../agents/spec-agent.js";
import { TestAgent } from "../agents/test-agent.js";
import { UiAgent } from "../agents/ui-agent.js";
import { InMemoryJobStore, type JobStore } from "../storage/job-store.js";
import { StaticCustomerPreviewManager, type CustomerPreviewManager } from "../tools/customer-preview.js";
import { StaticHtmlDashboardBuilder, type DashboardBuilder } from "../tools/dashboard-builder.js";
import { PostgresDatabaseRunner, type DatabaseRunner } from "../tools/database-runner.js";
import { MockDeployer, type Deployer } from "../tools/deployer.js";
import { FileSystemRepoWriter, createCodeWorkspace, type RepoWriter } from "../tools/repo-writer.js";
import { persistSpeckitSpecWorkspace } from "../tools/speckit-workspace.js";
import { createStitchClientFromEnv, type StitchClient } from "../tools/stitch-client.js";
import { GeneratedWorkspaceTestRunner, type TestRunner } from "../tools/test-runner.js";
import type {
  AlignmentFinding,
  AlignmentReportArtifact,
  AgentRunRecord,
  BugReport,
  DatabaseRunRecord,
  FailureMemory,
  FeatureSpec,
  JobStage,
  ReleaseApprovalRecord,
  SpecArtifact,
  TestRun,
  UiArtifact,
  WorkflowJob,
  WorkflowLogEntry,
} from "../types/domain.js";
import { assertPathsWithinScopes } from "./workspace-policy.js";

export interface UiApprovalDecision {
  approved: boolean;
  feedback?: string;
}

export interface UiApprovalRequest {
  jobId: string;
  uiArtifact: UiArtifact;
}

export interface ReleaseApprovalDecision {
  approved: boolean;
  feedback?: string;
}

export interface ReleaseApprovalRequest {
  job: WorkflowJob;
  previewPath?: string;
}

export interface OrchestratorRuntimeHooks {
  onProgress?: (message: string) => void;
  requestUiApproval?: (request: UiApprovalRequest) => Promise<UiApprovalDecision>;
  requestReleaseApproval?: (
    request: ReleaseApprovalRequest,
  ) => Promise<ReleaseApprovalDecision>;
}

// 这里把 orchestrator 依赖的所有组件集中列出来，
// 方便后面替换真实存储、真实测试器、真实部署器。
interface OrchestratorDependencies {
  store: JobStore;
  specAgent: SpecAgent;
  uiAgent: UiAgent;
  frontendAgent: FrontendAgent;
  backendAgent: BackendAgent;
  dbAgent: DbAgent;
  testAgent: TestAgent;
  fixAgent: FixAgent;
  monitorAgent: MonitorAgent;
  acceptanceAgent: AcceptanceAgent;
  deployAgent: DeployAgent;
  stitchClient: StitchClient;
  testRunner: TestRunner;
  repoWriter: RepoWriter;
  deployer: Deployer;
  databaseRunner: DatabaseRunner;
  dashboardBuilder: DashboardBuilder;
  customerPreviewManager: CustomerPreviewManager;
  baseDir: string;
  onProgress?: (message: string) => void;
  requestUiApproval?: (request: UiApprovalRequest) => Promise<UiApprovalDecision>;
  requestReleaseApproval?: (
    request: ReleaseApprovalRequest,
  ) => Promise<ReleaseApprovalDecision>;
}

// DeliveryOrchestrator 是整套系统的总调度器。
// 它本身不负责“思考”每个业务细节，而是负责按阶段调用 agent、工具和人工确认节点。
export class DeliveryOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async createJob(rawRequirement: string): Promise<WorkflowJob> {
    // 新任务创建时，先让 spec-agent 把自然语言需求整理成结构化 requirement。
    const jobId = randomUUID();
    const codeWorkspace = createCodeWorkspace(jobId);
    const logFilePath = getWorkflowLogFilePath(jobId);
    await this.deps.repoWriter.ensureWorkspace(codeWorkspace);
    this.notifyProgress("正在分析原始需求，并生成澄清后的 spec。");

    const specExecution = await this.prepareAgentRun(
      jobId,
      "drafting_spec",
      this.deps.specAgent,
      { rawRequirement },
    );
    const now = specExecution.record.createdAt;
    const specArtifact = await this.persistSpecArtifact(
      jobId,
      specExecution.result.data.requirement,
      specExecution.result.data.specMarkdown,
    );
    this.notifyProgress(`需求澄清完成，spec 已写入 ${specArtifact.markdownPath}。`);

    const job: WorkflowJob = {
      id: jobId,
      requirement: specExecution.result.data.requirement,
      codeWorkspace,
      logFilePath,
      specArtifact,
      stage: "drafting_spec",
      uiArtifacts: [],
      alignmentReports: [],
      databaseRuns: [],
      bugReports: [],
      testRuns: [],
      agentRuns: [
        {
          ...specExecution.record,
          artifacts: [...specExecution.record.artifacts, specArtifact.markdownPath],
        },
      ],
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
    await this.persistWorkflowLog(jobId, {
      createdAt: now,
      level: "info",
      stage: "drafting_spec",
      message: "Job created and initial spec clarification completed.",
      details: {
        specPath: specArtifact.markdownPath,
      },
    });
    await this.refreshDashboard(jobId);
    return this.deps.store.get(job.id);
  }

  async run(jobId: string): Promise<WorkflowJob> {
    // 这是主流程入口：先生成并确认 UI，再进入开发、测试、验收和部署。
    const initialJob = await this.deps.store.get(jobId);
    await this.transition(
      jobId,
      "spec_confirmed",
      initialJob.specArtifact
        ? `Clarified spec saved to ${initialJob.specArtifact.markdownPath} and ready for UI generation.`
        : "Spec confirmed and ready for UI generation.",
    );

    // 先进入设计生成与确认循环。只有 UI 被明确批准后，才继续进入开发阶段。
    const approvedUiArtifact = await this.generateApprovedUi(jobId);
    this.notifyProgress(`已确认第 ${approvedUiArtifact.versionNumber} 版 UI，开始进入功能开发阶段。`);

    let job = await this.deps.store.get(jobId);
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
    const flowRun = await this.deps.testRunner.runFlowTests(job);
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
    await this.persistAlignmentReport(jobId, {
      scope: monitorResult.data.scope,
      aligned: monitorResult.data.aligned,
      summary: monitorResult.data.summary,
      findings: monitorResult.data.structuredFindings,
      checkedFiles: monitorResult.data.checkedFiles,
      attemptedAutoFix: false,
    });
    if (monitorResult.status === "blocked" || !monitorResult.data.aligned) {
      return this.blockJob(jobId, monitorResult.summary);
    }

    job = await this.deps.store.get(jobId);
    await this.transition(
      jobId,
      "running_acceptance",
      "Running final acceptance tests before customer preview.",
    );
    const acceptanceRun = await this.deps.testRunner.runAcceptanceTests(job);
    await this.recordTest(jobId, acceptanceRun);
    if (!acceptanceRun.passed) {
      return this.blockJob(jobId, acceptanceRun.summary);
    }

    // 在真正发布前，再给客户一个最终预览确认节点。
    await this.transition(
      jobId,
      "previewing_release",
      "Preparing final customer preview before deployment approval.",
    );
    await this.prepareCustomerPreview(jobId);
    job = await this.deps.store.get(jobId);
    const acceptanceDecision = await this.executeAgent(
      jobId,
      "previewing_release",
      this.deps.acceptanceAgent,
      { job },
    );
    if (acceptanceDecision.status === "blocked" || !acceptanceDecision.data.readyForCustomerReview) {
      return this.blockJob(jobId, acceptanceDecision.summary);
    }

    job = await this.deps.store.get(jobId);
    const releaseApproval = await this.requestReleaseApproval({
      job,
      previewPath: acceptanceDecision.data.previewPath,
    });
    await this.recordReleaseApproval(jobId, {
      approved: releaseApproval.approved,
      feedback: releaseApproval.feedback,
      previewPath: acceptanceDecision.data.previewPath,
      decidedAt: new Date().toISOString(),
    });
    if (!releaseApproval.approved) {
      return this.blockJob(
        jobId,
        releaseApproval.feedback
          ? `Customer rejected the final preview: ${releaseApproval.feedback}`
          : "Customer rejected the final preview.",
      );
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

  // 这一步负责“生成 UI -> 询问是否满意 -> 不满意则带反馈重生”的闭环。
  private async generateApprovedUi(jobId: string): Promise<UiArtifact> {
    let designFeedback: string | undefined;

    while (true) {
      const job = await this.deps.store.get(jobId);
      const versionNumber = job.uiArtifacts.length + 1;
      this.notifyProgress(`正在准备第 ${versionNumber} 版 UI 设计。`);

      const uiPreparation = await this.executeAgent(jobId, "spec_confirmed", this.deps.uiAgent, {
        requirement: job.requirement,
        specArtifact: job.specArtifact,
        designFeedback,
      });

      const submission = await this.deps.stitchClient.submit(uiPreparation.data.prompt);
      await this.transition(
        jobId,
        "ui_generating",
        submission.note
          ? `Submitted UI version ${versionNumber} to Stitch as ${submission.stitchJobId}. ${submission.note}`
          : `Submitted UI version ${versionNumber} to Stitch as ${submission.stitchJobId}.`,
      );

      const uiArtifact = await this.waitForUiArtifact(submission, {
        versionNumber,
        targetDir: path.join(this.deps.baseDir, "artifacts", "ui", jobId, `v${versionNumber}`),
        generatedFromFeedback: designFeedback,
      });
      if (uiArtifact.status === "failed") {
        return this.blockJob(jobId, `Stitch job ${submission.stitchJobId} failed before download.`)
          .then((blockedJob) => {
            throw new Error(`UI generation failed for job ${blockedJob.id}.`);
          });
      }

      await this.appendUiArtifact(jobId, uiArtifact);
      await this.transition(
        jobId,
        "ui_ready",
        `Downloaded UI version ${versionNumber} to ${uiArtifact.directoryPath}.`,
      );
      await this.transition(
        jobId,
        "reviewing_ui",
        `Awaiting approval for UI version ${versionNumber}.`,
      );

      const review = await this.requestUiApproval({
        jobId,
        uiArtifact,
      });

      if (review.approved) {
        const approvedArtifact = {
          ...uiArtifact,
          reviewStatus: "approved" as const,
          reviewFeedback: review.feedback,
        };
        await this.setApprovedUiArtifact(jobId, approvedArtifact);
        await this.transition(
          jobId,
          "spec_confirmed",
          `UI version ${versionNumber} was approved and selected for implementation.`,
        );
        return approvedArtifact;
      }

      const feedback =
        review.feedback ??
        "Please regenerate the UI with a noticeably different design while preserving the approved requirement.";
      await this.updateUiArtifact(jobId, versionNumber, (current) => ({
        ...current,
        reviewStatus: "rejected",
        reviewFeedback: feedback,
      }));
      await this.transition(
        jobId,
        "spec_confirmed",
        `UI version ${versionNumber} was rejected. Regenerating with feedback: ${feedback}`,
      );
      designFeedback = feedback;
    }
  }

  // 把澄清后的 spec 落到 artifacts/specs，方便人工查看，也方便后续 agent 复用。
  private async persistSpecArtifact(
    jobId: string,
    requirement: WorkflowJob["requirement"],
    specMarkdown: string,
  ): Promise<SpecArtifact> {
    const clarifiedAt = new Date().toISOString();
    const artifactDir = path.join(this.deps.baseDir, "artifacts", "specs");
    await mkdir(artifactDir, { recursive: true });

    const markdownPath = path.join(artifactDir, `spec-${jobId}.md`);
    await writeFile(markdownPath, specMarkdown, "utf8");
    const speckitWorkspace = await persistSpeckitSpecWorkspace(
      this.deps.baseDir,
      requirement,
      specMarkdown,
    );

    return {
      markdownPath,
      markdown: specMarkdown,
      clarifiedAt,
      speckitFeatureDir: speckitWorkspace?.featureDir,
      speckitSpecPath: speckitWorkspace?.specPath,
      speckitChecklistPath: speckitWorkspace?.checklistPath,
      speckitBranchName: speckitWorkspace?.branchName,
    };
  }

  private async developFeature(jobId: string, featureId: string): Promise<WorkflowJob> {
    // 这里封装了单个功能点的完整生命周期。
    let job = await this.deps.store.get(jobId);
    const feature = this.requireFeature(job, featureId);

    await this.transition(jobId, "implementing_feature", `Implementing feature "${feature.name}".`);
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      status: "in_development",
      frontendStatus: "in_progress",
      backendStatus: "pending",
      databaseStatus: "pending",
      implementationAttempts: current.implementationAttempts + 1,
    }));

    job = await this.deps.store.get(jobId);
    const refreshedFeature = this.requireFeature(job, featureId);

    // 前端和后端拆成两个独立 agent，由 orchestrator 串行调度。
    const frontendResult = await this.executeAgent(jobId, "implementing_feature", this.deps.frontendAgent, {
      feature: refreshedFeature,
      uiArtifactPath: job.uiArtifact?.htmlPath ?? job.uiArtifact?.imagePath ?? job.uiArtifact?.downloadPath ?? "",
      codeWorkspace: job.codeWorkspace,
    });
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      frontendStatus: "done",
      generatedFiles: mergeGeneratedFiles(current.generatedFiles, frontendResult.changedFiles),
      backendStatus: "in_progress",
      databaseStatus: "pending",
    }));

    const backendFeatureInput = this.requireFeature(await this.deps.store.get(jobId), featureId);
    const backendResult = await this.executeAgent(jobId, "implementing_feature", this.deps.backendAgent, {
      feature: backendFeatureInput,
      requirement: job.requirement,
      codeWorkspace: job.codeWorkspace,
    });
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      frontendStatus: "done",
      backendStatus: "done",
      databaseStatus: "in_progress",
      generatedFiles: mergeGeneratedFiles(current.generatedFiles, backendResult.changedFiles),
    }));

    const dbFeatureInput = this.requireFeature(await this.deps.store.get(jobId), featureId);
    const dbResult = await this.executeAgent(jobId, "implementing_feature", this.deps.dbAgent, {
      feature: dbFeatureInput,
      requirement: job.requirement,
      codeWorkspace: job.codeWorkspace,
    });
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      databaseStatus: "done",
      status: "awaiting_test",
      generatedFiles: mergeGeneratedFiles(current.generatedFiles, dbResult.changedFiles),
    }));
    const initialDatabaseRun = await this.applyDatabaseArtifacts(jobId, featureId);
    if (initialDatabaseRun?.status === "failed") {
      return this.blockJob(jobId, initialDatabaseRun.summary);
    }

    await this.transition(
      jobId,
      "testing_feature",
      `Running automated validation for "${refreshedFeature.name}".`,
    );
    const featureBeforeFirstRun = this.requireFeature(await this.deps.store.get(jobId), featureId);
    const firstRun = await this.deps.testRunner.runFeatureTests(
      await this.deps.store.get(jobId),
      featureBeforeFirstRun,
    );
    await this.recordTest(jobId, firstRun);
    if (!firstRun.passed) {
      await this.recordFeatureFailure(jobId, featureId, {
        stage: "testing_feature",
        step: "feature_test_initial",
        testRun: firstRun,
      });
    }
    const featureAfterFirstFailure = this.requireFeature(await this.deps.store.get(jobId), featureId);
    const firstTriage = await this.executeAgent(jobId, "testing_feature", this.deps.testAgent, {
      feature: featureAfterFirstFailure,
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

    const fixResult = await this.executeAgent(jobId, "fixing_feature", this.deps.fixAgent, {
      feature: featureAfterFirstFailure,
      bugReports: firstRun.bugs,
      codeWorkspace: job.codeWorkspace,
    });
    await this.markLatestFailureAddressed(jobId, featureId, fixResult.summary, fixResult.data.repairPlan);
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      status: "awaiting_test",
      generatedFiles: mergeGeneratedFiles(current.generatedFiles, fixResult.changedFiles),
    }));
    const repairedDatabaseRun = await this.applyDatabaseArtifacts(jobId, featureId, fixResult.changedFiles);
    if (repairedDatabaseRun?.status === "failed") {
      return this.blockJob(jobId, repairedDatabaseRun.summary);
    }

    await this.transition(
      jobId,
      "testing_feature",
      `Re-running automated validation for "${refreshedFeature.name}".`,
    );
    const updatedFeature = this.requireFeature(await this.deps.store.get(jobId), featureId);
    const secondRun = await this.deps.testRunner.runFeatureTests(
      await this.deps.store.get(jobId),
      updatedFeature,
    );
    await this.recordTest(jobId, secondRun);
    if (!secondRun.passed) {
      await this.recordFeatureFailure(jobId, featureId, {
        stage: "testing_feature",
        step: "feature_test_retry",
        testRun: secondRun,
      });
    }
    const featureAfterSecondFailure = this.requireFeature(await this.deps.store.get(jobId), featureId);
    const secondTriage = await this.executeAgent(jobId, "testing_feature", this.deps.testAgent, {
      feature: featureAfterSecondFailure,
      testRun: secondRun,
    });

    if (secondTriage.data.shouldFix) {
      await this.updateFeature(jobId, featureId, (current) => ({
        ...current,
        status: "blocked",
      }));
      return this.blockJob(jobId, `Feature "${updatedFeature.name}" still fails after one fix loop.`);
    }

    await this.resolveFeatureFailures(
      jobId,
      featureId,
      `Feature "${updatedFeature.name}" passed after the repair loop and should not repeat the remembered issue.`,
    );
    await this.updateFeature(jobId, featureId, (current) => ({
      ...current,
      status: "done",
    }));
    await this.markFeatureBugsFixed(jobId, featureId);

    const monitoredJob = await this.deps.store.get(jobId);
    const monitoredFeature = this.requireFeature(monitoredJob, featureId);
    const featureMonitorResult = await this.executeAgent(
      jobId,
      "verifying_alignment",
      this.deps.monitorAgent,
      {
        job: monitoredJob,
        feature: monitoredFeature,
      },
    );
    const initialFeatureReport = await this.persistAlignmentReport(jobId, {
      scope: featureMonitorResult.data.scope,
      featureId,
      aligned: featureMonitorResult.data.aligned,
      summary: featureMonitorResult.data.summary,
      findings: featureMonitorResult.data.structuredFindings,
      checkedFiles: featureMonitorResult.data.checkedFiles,
      attemptedAutoFix: false,
    });
    if (featureMonitorResult.status === "blocked" || !featureMonitorResult.data.aligned) {
      const autoFixSummary = await this.repairAlignmentDrift(
        jobId,
        monitoredFeature,
        featureMonitorResult.data.structuredFindings,
      );
      const refreshedJob = await this.deps.store.get(jobId);
      const refreshedFeature = this.requireFeature(refreshedJob, featureId);
      const retryMonitorResult = await this.executeAgent(
        jobId,
        "verifying_alignment",
        this.deps.monitorAgent,
        {
          job: refreshedJob,
          feature: refreshedFeature,
        },
      );
      await this.persistAlignmentReport(jobId, {
        scope: retryMonitorResult.data.scope,
        featureId,
        aligned: retryMonitorResult.data.aligned,
        summary: retryMonitorResult.data.summary,
        findings: retryMonitorResult.data.structuredFindings,
        checkedFiles: retryMonitorResult.data.checkedFiles,
        attemptedAutoFix: true,
        autoFixSummary,
      });
      if (retryMonitorResult.status === "blocked" || !retryMonitorResult.data.aligned) {
        await this.updateFeature(jobId, featureId, (current) => ({
          ...current,
          status: "blocked",
        }));
        return this.blockJob(
          jobId,
          `${retryMonitorResult.summary} Alignment reports: ${initialFeatureReport.filePath}`,
        );
      }

      await this.persistWorkflowLog(jobId, {
        createdAt: new Date().toISOString(),
        level: "info",
        stage: "verifying_alignment",
        message: `Feature alignment drift for "${featureId}" was auto-repaired successfully.`,
        details: {
          reportPath: initialFeatureReport.filePath,
          autoFixSummary,
        },
      });
    }

    return this.deps.store.get(jobId);
  }

  private async waitForUiArtifact(
    submission: {
      stitchJobId: string;
      projectId?: string;
      screenId?: string;
      runtime: "real" | "mock";
      note?: string;
    },
    options: {
      versionNumber: number;
      targetDir: string;
      generatedFromFeedback?: string;
    },
  ): Promise<UiArtifact> {
    for (let poll = 0; poll < 5; poll += 1) {
      const status = await this.deps.stitchClient.getStatus(submission.stitchJobId);
      this.notifyProgress(`正在等待 Stitch 生成 UI，当前状态：${status}。`);
      if (status === "completed") {
        const download = await this.deps.stitchClient.downloadResult(
          submission.stitchJobId,
          options.targetDir,
        );
        this.notifyProgress(`UI 产物下载完成：${download.downloadPath}。`);

        return {
          versionNumber: options.versionNumber,
          directoryPath: options.targetDir,
          stitchJobId: submission.stitchJobId,
          projectId: submission.projectId,
          screenId: submission.screenId,
          downloadPath: download.downloadPath,
          htmlPath: download.htmlPath,
          imagePath: download.imagePath,
          metadataPath: download.metadataPath,
          runtime: submission.runtime,
          note: submission.note ?? download.note,
          generatedFromFeedback: options.generatedFromFeedback,
          reviewStatus: "pending",
          status: "ready",
        };
      }

      if (status === "failed") {
        return {
          versionNumber: options.versionNumber,
          directoryPath: options.targetDir,
          stitchJobId: submission.stitchJobId,
          downloadPath: "",
          runtime: submission.runtime,
          generatedFromFeedback: options.generatedFromFeedback,
          reviewStatus: "pending",
          status: "failed",
        };
      }
    }

    throw new Error(`Timed out while waiting for Stitch job ${submission.stitchJobId}.`);
  }

  private async appendUiArtifact(jobId: string, uiArtifact: UiArtifact): Promise<void> {
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      uiArtifacts: [...current.uiArtifacts, uiArtifact],
    }));
    await this.refreshDashboard(jobId);
  }

  private async setApprovedUiArtifact(jobId: string, approvedArtifact: UiArtifact): Promise<void> {
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      uiArtifact: approvedArtifact,
      uiArtifacts: current.uiArtifacts.map((artifact) =>
        artifact.versionNumber === approvedArtifact.versionNumber ? approvedArtifact : artifact,
      ),
    }));
    await this.refreshDashboard(jobId);
  }

  private async updateUiArtifact(
    jobId: string,
    versionNumber: number,
    updater: (artifact: UiArtifact) => UiArtifact,
  ): Promise<void> {
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      uiArtifacts: current.uiArtifacts.map((artifact) =>
        artifact.versionNumber === versionNumber ? updater(artifact) : artifact,
      ),
    }));
    await this.refreshDashboard(jobId);
  }

  private async prepareAgentRun<Input, Output>(
    jobId: string,
    stage: JobStage,
    agent: Agent<Input, Output>,
    input: Input,
  ): Promise<{ context: AgentExecutionContext; result: AgentResult<Output>; record: AgentRunRecord }> {
    const context = createExecutionContext(agent.definition, jobId, stage, this.deps.baseDir);
    const result = await agent.run(input, context);

    assertPathsWithinScopes(result.changedFiles, context.writeScopes);
    assertPathsWithinScopes(result.fileEdits.map((edit) => edit.path), context.writeScopes);

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
    this.notifyProgress(`正在执行 ${agent.definition.name}。`);
    const execution = await this.prepareAgentRun(jobId, stage, agent, input);
    if (execution.result.fileEdits.length > 0) {
      const appliedFiles = await this.deps.repoWriter.applyFileEdits(execution.result.fileEdits);
      if (appliedFiles.length > 0) {
        this.notifyProgress(`${agent.definition.name} 已写入 ${appliedFiles.length} 个代码文件。`);
      }
    }

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
    await this.persistWorkflowLog(jobId, {
      createdAt: execution.record.createdAt,
      level: execution.result.status === "blocked" ? "warn" : "info",
      stage,
      message: `${agent.definition.name}: ${execution.result.summary}`,
      details: {
        nextAction: execution.result.nextAction,
        changedFiles: execution.result.changedFiles,
        risks: execution.result.risks,
      },
    });
    await this.refreshDashboard(jobId);

    return execution.result;
  }

  private async transition(jobId: string, stage: JobStage, message: string): Promise<void> {
    this.notifyProgress(`[${stage}] ${message}`);
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
    await this.persistWorkflowLog(jobId, {
      createdAt: new Date().toISOString(),
      level: stage === "blocked" ? "error" : "info",
      stage,
      message,
    });
    await this.refreshDashboard(jobId);
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
    await this.persistWorkflowLog(jobId, {
      createdAt: testRun.createdAt,
      level: testRun.passed ? "info" : "warn",
      stage: "testing_feature",
      message: `Test run (${testRun.scope}): ${testRun.summary}`,
      details: {
        targetId: testRun.targetId,
        passed: testRun.passed,
        bugCount: testRun.bugs.length,
      },
    });
    await this.refreshDashboard(jobId);
  }

  private async recordReleaseApproval(
    jobId: string,
    releaseApproval: ReleaseApprovalRecord,
  ): Promise<void> {
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      releaseApproval,
      events: [
        ...current.events,
        {
          stage: current.stage,
          message: releaseApproval.approved
            ? "Customer approved the final preview for release."
            : `Customer rejected the final preview.${releaseApproval.feedback ? ` Feedback: ${releaseApproval.feedback}` : ""}`,
          createdAt: releaseApproval.decidedAt,
        },
      ],
    }));
    await this.persistWorkflowLog(jobId, {
      createdAt: releaseApproval.decidedAt,
      level: releaseApproval.approved ? "info" : "warn",
      stage: "previewing_release",
      message: releaseApproval.approved
        ? "Customer approved the final preview for release."
        : "Customer rejected the final preview.",
      details: {
        feedback: releaseApproval.feedback,
        previewPath: releaseApproval.previewPath,
      },
    });
    await this.refreshDashboard(jobId);
  }

  // 首轮失败后立即写一条失败记忆，记录失败发生在哪个步骤、返回了什么结果。
  private async recordFeatureFailure(
    jobId: string,
    featureId: string,
    input: {
      stage: JobStage;
      step: string;
      testRun: TestRun;
    },
  ): Promise<void> {
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      requirement: {
        ...current.requirement,
        features: current.requirement.features.map((feature) => {
          if (feature.id !== featureId) {
            return feature;
          }

          const bugTitles = input.testRun.bugs.map((bug) => bug.title);
          const signature = toBugSignature(bugTitles);
          const alreadySeen = feature.failureHistory.some(
            (failure) => toBugSignature(failure.bugTitles) === signature,
          );
          const failureMemory: FailureMemory = {
            id: randomUUID(),
            featureId,
            stage: input.stage,
            step: input.step,
            resultSummary: input.testRun.summary,
            bugTitles,
            bugDescriptions: input.testRun.bugs.map((bug) => bug.description),
            relatedTestRunId: input.testRun.id,
            status: alreadySeen ? "repeated" : "open",
            recordedAt: input.testRun.createdAt,
          };

          return {
            ...feature,
            failureHistory: [...feature.failureHistory, failureMemory],
          };
        }),
      },
      events: [
        ...current.events,
        {
          stage: input.stage,
          message: `Recorded failure memory for ${featureId} at step "${input.step}": ${input.testRun.summary}`,
          createdAt: input.testRun.createdAt,
        },
      ],
    }));
    await this.persistFeatureFailureHistory(jobId, featureId);
    await this.persistWorkflowLog(jobId, {
      createdAt: input.testRun.createdAt,
      level: "warn",
      stage: input.stage,
      message: `Recorded failure memory for ${featureId} at step "${input.step}".`,
      details: {
        summary: input.testRun.summary,
        bugTitles: input.testRun.bugs.map((bug) => bug.title),
      },
    });
    await this.refreshDashboard(jobId);
  }

  // 修复计划生成后，把它挂到最新的失败记忆上，便于后续知道“上次试过怎么修”。
  private async markLatestFailureAddressed(
    jobId: string,
    featureId: string,
    fixSummary: string,
    repairPlan: string[],
  ): Promise<void> {
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      requirement: {
        ...current.requirement,
        features: current.requirement.features.map((feature) => {
          if (feature.id !== featureId) {
            return feature;
          }

          const latestFailureId = [...feature.failureHistory]
            .reverse()
            .find((failure) => failure.status === "open" || failure.status === "repeated")?.id;

          return {
            ...feature,
            failureHistory: feature.failureHistory.map((failure) =>
              failure.id === latestFailureId
                ? {
                    ...failure,
                    fixSummary,
                    repairPlan,
                    status: failure.status === "repeated" ? "repeated" : "addressed",
                  }
                : failure,
            ),
          };
        }),
      },
    }));
    await this.persistFeatureFailureHistory(jobId, featureId);
  }

  // 一旦复测通过，就把该功能点尚未关闭的失败记忆都标记为 resolved。
  private async resolveFeatureFailures(
    jobId: string,
    featureId: string,
    resolutionNote: string,
  ): Promise<void> {
    const resolvedAt = new Date().toISOString();
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      requirement: {
        ...current.requirement,
        features: current.requirement.features.map((feature) =>
          feature.id === featureId
            ? {
                ...feature,
                failureHistory: feature.failureHistory.map((failure) =>
                  failure.status === "resolved"
                    ? failure
                    : {
                        ...failure,
                        status: "resolved",
                        resolvedAt,
                        resolutionNote,
                      },
                ),
              }
            : feature,
        ),
      },
    }));
    await this.persistFeatureFailureHistory(jobId, featureId);
  }

  // 失败记忆除了写入内存状态，也会同步落到 artifacts/test-reports，方便事后追踪。
  private async persistFeatureFailureHistory(jobId: string, featureId: string): Promise<void> {
    const job = await this.deps.store.get(jobId);
    const feature = this.requireFeature(job, featureId);
    if (feature.failureHistory.length === 0) {
      return;
    }

    const artifactDir = path.join(this.deps.baseDir, "artifacts", "test-reports", jobId);
    await mkdir(artifactDir, { recursive: true });

    const artifactPath = path.join(artifactDir, `${featureId}-failure-memory.json`);
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          jobId,
          featureId,
          featureName: feature.name,
          failureHistory: feature.failureHistory,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  // monitor-agent 的每次执行结果都会单独落成报告，方便事后查看“哪一层什么时候偏了”。
  private async persistAlignmentReport(
    jobId: string,
    input: {
      scope: "feature" | "job";
      featureId?: string;
      aligned: boolean;
      summary: string;
      findings: AlignmentFinding[];
      checkedFiles: string[];
      attemptedAutoFix: boolean;
      autoFixSummary?: string;
    },
  ): Promise<AlignmentReportArtifact> {
    const createdAt = new Date().toISOString();
    const reportDir = path.join(this.deps.baseDir, "artifacts", "alignment-reports", jobId);
    await mkdir(reportDir, { recursive: true });

    const fileName =
      input.scope === "feature" && input.featureId
        ? `${input.featureId}-${createdAt.replaceAll(":", "-")}.json`
        : `job-${createdAt.replaceAll(":", "-")}.json`;
    const filePath = path.posix.join("artifacts", "alignment-reports", jobId, fileName);

    const report: AlignmentReportArtifact = {
      filePath,
      createdAt,
      scope: input.scope,
      featureId: input.featureId,
      aligned: input.aligned,
      summary: input.summary,
      findings: input.findings,
      checkedFiles: input.checkedFiles,
      attemptedAutoFix: input.attemptedAutoFix,
      autoFixSummary: input.autoFixSummary,
    };

    await writeFile(path.join(this.deps.baseDir, filePath), JSON.stringify(report, null, 2), "utf8");
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      alignmentReports: [...current.alignmentReports, report],
    }));
    await this.persistWorkflowLog(jobId, {
      createdAt,
      level: input.aligned ? "info" : "warn",
      stage: "verifying_alignment",
      message: `Alignment report saved: ${filePath}`,
      details: {
        scope: input.scope,
        featureId: input.featureId,
        aligned: input.aligned,
        findingCount: input.findings.length,
        attemptedAutoFix: input.attemptedAutoFix,
      },
    });
    await this.refreshDashboard(jobId);

    return report;
  }

  // 数据库文件生成完成后，会在这里真正执行 migration 和 seed。
  // 如果 fix-agent 又改了数据库相关文件，也会重新执行一次，确保 PostgreSQL 里的状态和代码一致。
  private async applyDatabaseArtifacts(
    jobId: string,
    featureId: string,
    changedFiles?: string[],
  ): Promise<DatabaseRunRecord | undefined> {
    if (changedFiles && !this.shouldReapplyDatabase(changedFiles)) {
      return undefined;
    }

    const job = await this.deps.store.get(jobId);
    const feature = this.requireFeature(job, featureId);
    this.notifyProgress(`正在将 ${feature.name} 的 migration/seed 执行到 PostgreSQL。`);

    const databaseRun = await this.deps.databaseRunner.applyFeatureArtifacts(job, feature);
    await this.persistDatabaseRun(jobId, databaseRun);
    return databaseRun;
  }

  // 偏航发现后，先把结果转换成 bug 语义，再交给 fix-agent 做定向修复。
  private async repairAlignmentDrift(
    jobId: string,
    feature: FeatureSpec,
    findings: AlignmentFinding[],
  ): Promise<string> {
    const driftBugReports = findings.map((finding, index) => ({
      id: randomUUID(),
      featureId: feature.id,
      title: `[${finding.layer}] ${finding.rule ?? `drift-${index + 1}`}`,
      description: finding.message,
      severity: "high" as const,
      status: "open" as const,
    }));
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      bugReports: mergeBugReports(current.bugReports, driftBugReports),
    }));
    await this.persistWorkflowLog(jobId, {
      createdAt: new Date().toISOString(),
      level: "warn",
      stage: "verifying_alignment",
      message: `Detected alignment drift for feature "${feature.name}", entering targeted repair.`,
      details: {
        featureId: feature.id,
        findings: driftBugReports.map((bug) => bug.title),
      },
    });

    await this.transition(
      jobId,
      "fixing_feature",
      `Monitor detected drift for "${feature.name}". Entering targeted alignment repair.`,
    );
    const job = await this.deps.store.get(jobId);
    const fixResult = await this.executeAgent(jobId, "fixing_feature", this.deps.fixAgent, {
      feature,
      bugReports: driftBugReports,
      codeWorkspace: job.codeWorkspace,
      alignmentFindings: findings,
    });
    await this.updateFeature(jobId, feature.id, (current) => ({
      ...current,
      status: "done",
      generatedFiles: mergeGeneratedFiles(current.generatedFiles, fixResult.changedFiles),
    }));
    const repairedDatabaseRun = await this.applyDatabaseArtifacts(jobId, feature.id, fixResult.changedFiles);
    if (repairedDatabaseRun?.status === "failed") {
      return `${fixResult.summary} ${repairedDatabaseRun.summary}`;
    }
    await this.markSpecificBugsFixed(jobId, driftBugReports.map((bug) => bug.id));

    return fixResult.summary;
  }

  private async persistDatabaseRun(jobId: string, databaseRun: DatabaseRunRecord): Promise<void> {
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      databaseRuns: [...current.databaseRuns, databaseRun],
      events: [
        ...current.events,
        {
          stage: current.stage,
          message: `Database run (${databaseRun.status}): ${databaseRun.summary}`,
          createdAt: databaseRun.executedAt,
        },
      ],
    }));
    await this.persistWorkflowLog(jobId, {
      createdAt: databaseRun.executedAt,
      level: databaseRun.status === "applied" ? "info" : "error",
      stage: "implementing_feature",
      message: `Database run (${databaseRun.status}): ${databaseRun.summary}`,
      details: {
        featureId: databaseRun.featureId,
        databaseUrl: databaseRun.databaseUrl,
        databaseName: databaseRun.databaseName,
        mode: databaseRun.mode,
        containerName: databaseRun.containerName,
        logPath: databaseRun.logPath,
      },
    });
    await this.refreshDashboard(jobId);
  }

  private async prepareCustomerPreview(jobId: string): Promise<void> {
    const job = await this.deps.store.get(jobId);
    const customerPreviewArtifact = await this.deps.customerPreviewManager.prepare(job);
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      customerPreviewArtifact,
    }));
    await this.persistWorkflowLog(jobId, {
      createdAt: customerPreviewArtifact.generatedAt,
      level: "info",
      stage: "previewing_release",
      message: `Customer preview is ready at ${customerPreviewArtifact.serverUrl}.`,
      details: {
        htmlPath: customerPreviewArtifact.htmlPath,
        port: customerPreviewArtifact.port,
      },
    });
    await this.refreshDashboard(jobId);
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

  private async markSpecificBugsFixed(jobId: string, bugIds: string[]): Promise<void> {
    const knownIds = new Set(bugIds);
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      bugReports: current.bugReports.map((bug) =>
        knownIds.has(bug.id) ? { ...bug, status: "fixed" } : bug,
      ),
    }));
  }

  private async blockJob(jobId: string, reason: string): Promise<WorkflowJob> {
    await this.transition(jobId, "blocked", reason);
    return this.deps.store.get(jobId);
  }

  private shouldReapplyDatabase(changedFiles: string[]): boolean {
    return changedFiles.some(
      (filePath) =>
        filePath.includes("/database/") ||
        filePath.endsWith(".prisma") ||
        filePath.endsWith(".sql"),
    );
  }

  private async persistWorkflowLog(jobId: string, entry: WorkflowLogEntry): Promise<void> {
    const logFilePath = path.join(this.deps.baseDir, getWorkflowLogFilePath(jobId));
    await mkdir(path.dirname(logFilePath), { recursive: true });
    await appendFile(logFilePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private async refreshDashboard(jobId: string): Promise<void> {
    const job = await this.deps.store.get(jobId);
    const dashboardArtifact = await this.deps.dashboardBuilder.render(job);
    await this.deps.store.update(jobId, (current) => ({
      ...current,
      dashboardArtifact,
    }));
  }

  private requireFeature(job: WorkflowJob, featureId: string): FeatureSpec {
    const feature = job.requirement.features.find((item) => item.id === featureId);
    if (!feature) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    return feature;
  }

  private async requestUiApproval(request: UiApprovalRequest): Promise<UiApprovalDecision> {
    if (this.deps.requestUiApproval) {
      return this.deps.requestUiApproval(request);
    }

    return { approved: true };
  }

  private async requestReleaseApproval(
    request: ReleaseApprovalRequest,
  ): Promise<ReleaseApprovalDecision> {
    if (this.deps.requestReleaseApproval) {
      return this.deps.requestReleaseApproval(request);
    }

    return { approved: true };
  }

  private notifyProgress(message: string): void {
    this.deps.onProgress?.(message);
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

function mergeGeneratedFiles(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}

function getWorkflowLogFilePath(jobId: string): string {
  return path.posix.join("artifacts", "logs", jobId, "workflow.jsonl");
}

function toBugSignature(bugTitles: string[]): string {
  return [...bugTitles]
    .map((title) => title.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function createDefaultOrchestrator(
  baseDir: string,
  hooks: OrchestratorRuntimeHooks = {},
): DeliveryOrchestrator {
  return new DeliveryOrchestrator({
    store: new InMemoryJobStore(),
    specAgent: new SpecAgent(),
    uiAgent: new UiAgent(),
    frontendAgent: new FrontendAgent(),
    backendAgent: new BackendAgent(),
    dbAgent: new DbAgent(),
    testAgent: new TestAgent(),
    fixAgent: new FixAgent(),
    monitorAgent: new MonitorAgent(),
    acceptanceAgent: new AcceptanceAgent(),
    deployAgent: new DeployAgent(),
    stitchClient: createStitchClientFromEnv(),
    testRunner: new GeneratedWorkspaceTestRunner(baseDir),
    repoWriter: new FileSystemRepoWriter(baseDir),
    deployer: new MockDeployer(baseDir),
    databaseRunner: new PostgresDatabaseRunner(baseDir),
    dashboardBuilder: new StaticHtmlDashboardBuilder(baseDir),
    customerPreviewManager: new StaticCustomerPreviewManager(baseDir),
    baseDir,
    onProgress: hooks.onProgress,
    requestUiApproval: hooks.requestUiApproval,
    requestReleaseApproval: hooks.requestReleaseApproval,
  });
}
