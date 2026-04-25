// 这个文件定义部署工具层。
// 当前版本先用 mock deployer 生成部署记录，后续再替换成真实发布逻辑。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DeploymentRecord, WorkflowJob } from "../types/domain.js";

// Deployer 是发布层抽象。
// 当前版本只是生成一份部署清单，不会真的推到服务器。
export interface Deployer {
  deploy(job: WorkflowJob, environment: string): Promise<DeploymentRecord>;
}

export class MockDeployer implements Deployer {
  constructor(private readonly baseDir: string) {}

  async deploy(job: WorkflowJob, environment: string): Promise<DeploymentRecord> {
    // 把本次发布的关键信息写成 JSON，方便后续追踪和调试。
    const artifactDir = path.join(this.baseDir, "artifacts", "build");
    await mkdir(artifactDir, { recursive: true });

    const manifestPath = path.join(artifactDir, `deployment-${job.id}.json`);
    const manifest = {
      jobId: job.id,
      environment,
      deployedAt: new Date().toISOString(),
      features: job.requirement.features.map((feature) => feature.name),
      releaseApproval: job.releaseApproval ?? null,
      uiArtifact: job.uiArtifact
        ? {
            versionNumber: job.uiArtifact.versionNumber,
            directoryPath: job.uiArtifact.directoryPath,
            runtime: job.uiArtifact.runtime,
            projectId: job.uiArtifact.projectId ?? null,
            screenId: job.uiArtifact.screenId ?? null,
            downloadPath: job.uiArtifact.downloadPath,
            imagePath: job.uiArtifact.imagePath ?? null,
            htmlPath: job.uiArtifact.htmlPath ?? null,
            metadataPath: job.uiArtifact.metadataPath ?? null,
            reviewStatus: job.uiArtifact.reviewStatus,
            reviewFeedback: job.uiArtifact.reviewFeedback ?? null,
          }
        : null,
      uiArtifacts: job.uiArtifacts.map((artifact) => ({
        versionNumber: artifact.versionNumber,
        directoryPath: artifact.directoryPath,
        runtime: artifact.runtime,
        reviewStatus: artifact.reviewStatus,
        reviewFeedback: artifact.reviewFeedback ?? null,
        downloadPath: artifact.downloadPath,
        imagePath: artifact.imagePath ?? null,
        htmlPath: artifact.htmlPath ?? null,
      })),
    };

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return {
      environment,
      status: "deployed",
      manifestPath,
      createdAt: new Date().toISOString(),
    };
  }
}
