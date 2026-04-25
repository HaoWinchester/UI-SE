// 这个文件定义任务存储层接口与内存版实现。
// orchestrator 通过它保存任务状态，后续也可以很容易替换成数据库实现。
import type { WorkflowJob } from "../types/domain.js";

// JobStore 是任务存储抽象层。
// 以后换成 SQLite / Postgres，只需要替换这里的实现。
export interface JobStore {
  create(job: WorkflowJob): Promise<void>;
  get(jobId: string): Promise<WorkflowJob>;
  update(
    jobId: string,
    updater: (current: WorkflowJob) => WorkflowJob,
  ): Promise<WorkflowJob>;
  list(): Promise<WorkflowJob[]>;
}

// 返回副本而不是原对象，避免外部代码直接改坏存储里的状态。
function cloneJob(job: WorkflowJob): WorkflowJob {
  return structuredClone(job);
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, WorkflowJob>();

  // 当前版本是内存存储，进程重启后数据会丢失。
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
    // 所有更新都统一走 updater，方便集中维护状态变更。
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
