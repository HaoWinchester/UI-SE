// 这个文件收敛了整套系统的核心领域模型。
// 任务、功能点、测试记录、UI 产物、失败记忆等状态都会在这里定义。
// 下面这些类型定义的是整个工作流里的核心数据结构。
// 你可以把它理解成“这个系统内部状态的数据字典”。
export type JobStage =
  | "drafting_spec"
  | "spec_confirmed"
  | "ui_generating"
  | "ui_ready"
  | "reviewing_ui"
  | "implementing_feature"
  | "testing_feature"
  | "fixing_feature"
  | "running_flow_tests"
  | "verifying_alignment"
  | "running_acceptance"
  | "previewing_release"
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
export type ReviewStatus = "pending" | "approved" | "rejected";
export type DeliveryTrackStatus = "pending" | "in_progress" | "done";
export type FailureMemoryStatus = "open" | "addressed" | "resolved" | "repeated";
export type WorkflowLogLevel = "info" | "warn" | "error";
export type AlignmentLayer = "ui" | "frontend" | "backend" | "database" | "workflow";
export type DatabaseRunStatus = "applied" | "failed";
export type DatabaseRunMode = "existing_database" | "docker_container";

export type TestScope = "feature" | "flow" | "acceptance";

// 单个代码文件的写入描述。
// agent 生成代码时，会先返回这种结构，再由 orchestrator 统一落盘。
export interface CodeFileEdit {
  path: string;
  content: string;
  description?: string;
}

// 每个任务都会有一块独立的代码工作区，用来承接前端、后端和测试产物。
export interface CodeWorkspace {
  rootDir: string;
  frontendDir: string;
  backendDir: string;
  databaseDir: string;
  testsDir: string;
}

// 单个功能点的定义。
export interface FeatureSpec {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  status: FeatureStatus;
  frontendStatus: DeliveryTrackStatus;
  backendStatus: DeliveryTrackStatus;
  databaseStatus: DeliveryTrackStatus;
  implementationAttempts: number;
  testAttempts: number;
  failureHistory: FailureMemory[];
  generatedFiles: string[];
}

// 一份结构化需求，会被拆成多个 feature。
export interface ProductRequirement {
  id: string;
  title: string;
  summary: string;
  rawInput: string;
  userScenarios: string[];
  acceptanceCriteria: string[];
  successCriteria: string[];
  assumptions: string[];
  clarifications: RequirementClarification[];
  features: FeatureSpec[];
}

// 记录一次“需求澄清”的结果，说明我们补了什么默认值或决定。
export interface RequirementClarification {
  topic: string;
  answer: string;
  rationale: string;
}

// 澄清后的 spec 产物，后续 UI 生成会优先消费它。
export interface SpecArtifact {
  markdownPath: string;
  markdown: string;
  clarifiedAt: string;
}

// Stitch 生成出来的 UI 产物信息。
export interface UiArtifact {
  versionNumber: number;
  directoryPath: string;
  stitchJobId: string;
  projectId?: string;
  screenId?: string;
  downloadPath: string;
  htmlPath?: string;
  imagePath?: string;
  metadataPath?: string;
  runtime: "real" | "mock";
  note?: string;
  generatedFromFeedback?: string;
  reviewStatus: ReviewStatus;
  reviewFeedback?: string;
  status: "ready" | "failed";
}

// 记录客户在最终预览环节是否同意发布。
export interface ReleaseApprovalRecord {
  approved: boolean;
  feedback?: string;
  previewPath?: string;
  decidedAt: string;
}

// 工作流日志落盘后使用的结构，方便回放“什么时候在哪一步出了什么问题”。
export interface WorkflowLogEntry {
  createdAt: string;
  level: WorkflowLogLevel;
  stage: JobStage;
  message: string;
  details?: Record<string, unknown>;
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

// 失败记忆用于记录“哪一步失败了、返回了什么结果、后来是怎么修的”。
// 后续再进入测试/修复时，会把这份记录带上，避免重复踩同一个坑。
export interface FailureMemory {
  id: string;
  featureId: string;
  stage: JobStage;
  step: string;
  resultSummary: string;
  bugTitles: string[];
  bugDescriptions: string[];
  relatedTestRunId?: string;
  fixSummary?: string;
  repairPlan?: string[];
  status: FailureMemoryStatus;
  recordedAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

// 偏航检查会返回结构化 finding，明确是哪个层面出了问题。
export interface AlignmentFinding {
  layer: AlignmentLayer;
  message: string;
  severity: "warning" | "blocking";
  filePath?: string;
  rule?: string;
}

// 每次 monitor-agent 执行后都会落一份报告，方便事后排查和回放。
export interface AlignmentReportArtifact {
  filePath: string;
  createdAt: string;
  scope: "feature" | "job";
  featureId?: string;
  aligned: boolean;
  summary: string;
  findings: AlignmentFinding[];
  checkedFiles: string[];
  attemptedAutoFix: boolean;
  autoFixSummary?: string;
}

// 每次把 migration/seed 真正执行到 PostgreSQL 后，都会留下一条数据库执行记录。
export interface DatabaseRunRecord {
  id: string;
  featureId: string;
  status: DatabaseRunStatus;
  mode: DatabaseRunMode;
  databaseUrl: string;
  databaseName: string;
  containerName?: string;
  migrationPath: string;
  seedScriptPath: string;
  seedSqlPath: string;
  logPath: string;
  summary: string;
  executedAt: string;
  durationMs: number;
}

// 网页面板是给人查看工作流状态的静态 HTML 产物。
export interface DashboardArtifact {
  htmlPath: string;
  generatedAt: string;
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
  codeWorkspace: CodeWorkspace;
  logFilePath: string;
  dashboardArtifact?: DashboardArtifact;
  specArtifact?: SpecArtifact;
  uiArtifact?: UiArtifact;
  uiArtifacts: UiArtifact[];
  alignmentReports: AlignmentReportArtifact[];
  databaseRuns: DatabaseRunRecord[];
  bugReports: BugReport[];
  testRuns: TestRun[];
  agentRuns: AgentRunRecord[];
  releaseApproval?: ReleaseApprovalRecord;
  deployment?: DeploymentRecord;
  events: JobEvent[];
  createdAt: string;
  updatedAt: string;
}
