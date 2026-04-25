import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DeploymentRecord, WorkflowJob } from "../types/domain.js";

export interface Deployer {
  deploy(job: WorkflowJob, environment: string): Promise<DeploymentRecord>;
}

export class MockDeployer implements Deployer {
  constructor(private readonly baseDir: string) {}

  async deploy(job: WorkflowJob, environment: string): Promise<DeploymentRecord> {
    const artifactDir = path.join(this.baseDir, "artifacts", "build");
    await mkdir(artifactDir, { recursive: true });

    const manifestPath = path.join(artifactDir, `deployment-${job.id}.json`);
    const manifest = {
      jobId: job.id,
      environment,
      deployedAt: new Date().toISOString(),
      features: job.requirement.features.map((feature) => feature.name),
      uiArtifact: job.uiArtifact?.downloadPath ?? null,
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
