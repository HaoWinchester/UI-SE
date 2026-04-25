// 下面这些类型定义的是整个工作流里的核心数据结构。
// 你可以把它理解成“这个系统内部状态的数据字典”。
export type JobStage =
  | "drafting_spec"
  | "spec_confirmed"
  | "ui_generating"
  | "ui_ready"
  | "implementing_feature"
  | "testing_feature"
  | "fixing_feature"
  | "running_flow_tests"
  | "verifying_alignment"
  | "running_acceptance"
  | "deploying"
  | "done"
  | "blocked";

export type FeatureStatus =
  | "pending"
  | "in_development"
  | "awaiting_test"
  | "fixing"
  | "done"
  | "blocked";

export type BugStatus = "open" | "fixed";

export type TestScope = "feature" | "flow" | "acceptance";

// 单个功能点的定义。
export interface FeatureSpec {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  status: FeatureStatus;
  implementationAttempts: number;
  testAttempts: number;
}

// 一份结构化需求，会被拆成多个 feature。
export interface ProductRequirement {
  id: string;
  title: string;
  summary: string;
  rawInput: string;
  acceptanceCriteria: string[];
  features: FeatureSpec[];
}

// Stitch 生成出来的 UI 产物信息。
export interface UiArtifact {
  stitchJobId: string;
  projectId?: string;
  screenId?: string;
  downloadPath: string;
  htmlPath?: string;
  imagePath?: string;
  metadataPath?: string;
  runtime: "real" | "mock";
  note?: string;
  status: "ready" | "failed";
}

// 测试失败后生成的 bug 记录。
export interface BugReport {
  id: string;
  featureId: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  status: BugStatus;
}

// 一次测试执行的结果。
export interface TestRun {
  id: string;
  scope: TestScope;
  targetId?: string;
  passed: boolean;
  summary: string;
  bugs: BugReport[];
  createdAt: string;
}

// 一次部署记录。
export interface DeploymentRecord {
  environment: string;
  status: "deployed" | "failed";
  manifestPath: string;
  createdAt: string;
}

// 工作流里的普通事件日志。
export interface JobEvent {
  stage: JobStage;
  message: string;
  createdAt: string;
}

// 一次 agent 执行的记录，方便排查问题。
export interface AgentRunRecord {
  agentName: string;
  stage: JobStage;
  status: "completed" | "blocked";
  runtimeMode: "mock" | "model";
  modelProvider: string;
  modelName: string;
  reasoningEffort: string;
  summary: string;
  nextAction: string;
  readScopes: string[];
  writeScopes: string[];
  allowedTools: string[];
  changedFiles: string[];
  artifacts: string[];
  risks: string[];
  createdAt: string;
}

// 整个任务对象，是 orchestrator 操作的核心状态载体。
export interface WorkflowJob {
  id: string;
  requirement: ProductRequirement;
  stage: JobStage;
  uiArtifact?: UiArtifact;
  bugReports: BugReport[];
  testRuns: TestRun[];
  agentRuns: AgentRunRecord[];
  deployment?: DeploymentRecord;
  events: JobEvent[];
  createdAt: string;
  updatedAt: string;
}
