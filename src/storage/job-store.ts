import type { WorkflowJob } from "../types/domain.js";

export interface JobStore {
  create(job: WorkflowJob): Promise<void>;
  get(jobId: string): Promise<WorkflowJob>;
  update(
    jobId: string,
    updater: (current: WorkflowJob) => WorkflowJob,
  ): Promise<WorkflowJob>;
  list(): Promise<WorkflowJob[]>;
}

function cloneJob(job: WorkflowJob): WorkflowJob {
  return structuredClone(job);
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, WorkflowJob>();

  async create(job: WorkflowJob): Promise<void> {
    this.jobs.set(job.id, cloneJob(job));
  }

  async get(jobId: string): Promise<WorkflowJob> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    return cloneJob(job);
  }

  async update(
    jobId: string,
    updater: (current: WorkflowJob) => WorkflowJob,
  ): Promise<WorkflowJob> {
    const current = await this.get(jobId);
    const updated = updater(current);
    updated.updatedAt = new Date().toISOString();
    this.jobs.set(jobId, cloneJob(updated));
    return cloneJob(updated);
  }

  async list(): Promise<WorkflowJob[]> {
    return [...this.jobs.values()].map((job) => cloneJob(job));
  }
}
