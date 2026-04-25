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

export interface FeatureSpec {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  status: FeatureStatus;
  implementationAttempts: number;
  testAttempts: number;
}

export interface ProductRequirement {
  id: string;
  title: string;
  summary: string;
  rawInput: string;
  acceptanceCriteria: string[];
  features: FeatureSpec[];
}

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

export interface BugReport {
  id: string;
  featureId: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  status: BugStatus;
}

export interface TestRun {
  id: string;
  scope: TestScope;
  targetId?: string;
  passed: boolean;
  summary: string;
  bugs: BugReport[];
  createdAt: string;
}

export interface DeploymentRecord {
  environment: string;
  status: "deployed" | "failed";
  manifestPath: string;
  createdAt: string;
}

export interface JobEvent {
  stage: JobStage;
  message: string;
  createdAt: string;
}

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
