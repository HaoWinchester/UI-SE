// 这个文件负责把数据库产物真正执行到 PostgreSQL。
// 它会读取 db-agent 生成的 migration/seed，必要时自动拉起本地 Docker Postgres，
// 然后把执行结果写成独立记录，供 orchestrator、日志和网页面板复用。
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { Client } from "pg";

import { readDatabaseRuntimeEnv, type DatabaseRuntimeEnv } from "../config/env.js";
import type { DatabaseRunMode, DatabaseRunRecord, FeatureSpec, WorkflowJob } from "../types/domain.js";
import { getFeatureCodePaths } from "../utils/feature-paths.js";

const execFileAsync = promisify(execFile);
const CONNECT_RETRY_COUNT = 15;
const CONNECT_RETRY_DELAY_MS = 1_500;

interface DatabaseTarget {
  connectionString: string;
  databaseName: string;
  mode: DatabaseRunMode;
  containerName?: string;
}

export interface DatabaseRunner {
  applyFeatureArtifacts(job: WorkflowJob, feature: FeatureSpec): Promise<DatabaseRunRecord>;
}

export class PostgresDatabaseRunner implements DatabaseRunner {
  constructor(
    private readonly baseDir: string,
    private readonly env: DatabaseRuntimeEnv = readDatabaseRuntimeEnv(),
  ) {}

  async applyFeatureArtifacts(job: WorkflowJob, feature: FeatureSpec): Promise<DatabaseRunRecord> {
    const startedAt = Date.now();
    const executedAt = new Date().toISOString();
    const paths = getFeatureCodePaths(job.codeWorkspace, feature);
    const recordFilePath = path.posix.join(
      "artifacts",
      "db-runs",
      job.id,
      `${feature.id}-${executedAt.replaceAll(":", "-")}.json`,
    );

    try {
      const [migrationSql, seedSql] = await Promise.all([
        readFile(path.join(this.baseDir, paths.prismaMigrationPath), "utf8"),
        readFile(path.join(this.baseDir, paths.prismaSeedSqlPath), "utf8"),
      ]);

      const target = await this.ensureDatabaseReady();
      const client = new Client({
        connectionString: target.connectionString,
        connectionTimeoutMillis: this.env.connectTimeoutMs,
      });

      await client.connect();

      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ui_se_migration_history (
            feature_id TEXT PRIMARY KEY,
            migration_path TEXT NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS ui_se_seed_history (
            feature_id TEXT PRIMARY KEY,
            seed_path TEXT NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);

        await client.query(migrationSql);
        await client.query(seedSql);
        await client.query(
          `
            INSERT INTO ui_se_migration_history (feature_id, migration_path, executed_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (feature_id)
            DO UPDATE SET
              migration_path = EXCLUDED.migration_path,
              executed_at = EXCLUDED.executed_at;
          `,
          [feature.id, paths.prismaMigrationPath],
        );
        await client.query(
          `
            INSERT INTO ui_se_seed_history (feature_id, seed_path, executed_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (feature_id)
            DO UPDATE SET
              seed_path = EXCLUDED.seed_path,
              executed_at = EXCLUDED.executed_at;
          `,
          [feature.id, paths.prismaSeedSqlPath],
        );
      } finally {
        await client.end();
      }

      const record: DatabaseRunRecord = {
        id: randomUUID(),
        featureId: feature.id,
        status: "applied",
        mode: target.mode,
        databaseUrl: redactDatabaseUrl(target.connectionString),
        databaseName: target.databaseName,
        containerName: target.containerName,
        migrationPath: paths.prismaMigrationPath,
        seedScriptPath: paths.prismaSeedPath,
        seedSqlPath: paths.prismaSeedSqlPath,
        logPath: recordFilePath,
        summary: `已将 ${feature.name} 的 migration 和 seed 执行到 PostgreSQL。`,
        executedAt,
        durationMs: Date.now() - startedAt,
      };

      await this.persistRunRecord(recordFilePath, {
        ...record,
        rawDatabaseUrl: target.connectionString,
      });

      return record;
    } catch (error) {
      const failedRecord: DatabaseRunRecord = {
        id: randomUUID(),
        featureId: feature.id,
        status: "failed",
        mode: process.env.DATABASE_URL?.trim() ? "existing_database" : "docker_container",
        databaseUrl: redactDatabaseUrl(this.env.url),
        databaseName: readDatabaseName(this.env.url),
        containerName: this.env.autoStartDocker ? this.env.dockerContainerName : undefined,
        migrationPath: paths.prismaMigrationPath,
        seedScriptPath: paths.prismaSeedPath,
        seedSqlPath: paths.prismaSeedSqlPath,
        logPath: recordFilePath,
        summary: `执行 PostgreSQL migration 失败：${formatError(error)}`,
        executedAt,
        durationMs: Date.now() - startedAt,
      };

      await this.persistRunRecord(recordFilePath, {
        ...failedRecord,
        rawDatabaseUrl: this.env.url,
        error: formatError(error),
      });

      return failedRecord;
    }
  }

  private async ensureDatabaseReady(): Promise<DatabaseTarget> {
    const databaseName = readDatabaseName(this.env.url);
    const explicitDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());

    if (explicitDatabaseUrl && (await this.ensureDatabaseExists(this.env.url))) {
      return {
        connectionString: this.env.url,
        databaseName,
        mode: "existing_database",
        containerName: undefined,
      };
    }

    if (!explicitDatabaseUrl) {
      const discoveredLocalUrl = "postgresql://postgres:postgres@127.0.0.1:5432/ui_se";
      if (await this.ensureDatabaseExists(discoveredLocalUrl)) {
        return {
          connectionString: discoveredLocalUrl,
          databaseName: readDatabaseName(discoveredLocalUrl),
          mode: "existing_database",
          containerName: undefined,
        };
      }
    }

    if (await this.ensureDatabaseExists(this.env.url)) {
      return {
        connectionString: this.env.url,
        databaseName,
        mode: explicitDatabaseUrl ? "existing_database" : "docker_container",
        containerName: explicitDatabaseUrl ? undefined : this.env.dockerContainerName,
      };
    }

    if (!this.env.autoStartDocker || !isLocalDatabaseUrl(this.env.url)) {
      throw new Error(`Unable to connect to PostgreSQL at ${redactDatabaseUrl(this.env.url)}.`);
    }

    await this.ensureDockerPostgres();
    await this.waitForConnection(this.env.url);

    return {
      connectionString: this.env.url,
      databaseName,
      mode: "docker_container",
      containerName: this.env.dockerContainerName,
    };
  }

  private async ensureDockerPostgres(): Promise<void> {
    const runningState = await this.inspectContainerState(this.env.dockerContainerName);
    if (runningState === "running") {
      return;
    }

    if (runningState === "stopped") {
      await execFileAsync("docker", ["start", this.env.dockerContainerName], {
        maxBuffer: 1024 * 1024,
      });
      return;
    }

    const parsedUrl = new URL(this.env.url);
    const postgresUser = decodeURIComponent(parsedUrl.username || "postgres");
    const postgresPassword = decodeURIComponent(parsedUrl.password || "postgres");
    const postgresDb = readDatabaseName(this.env.url);

    await execFileAsync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        this.env.dockerContainerName,
        "-e",
        `POSTGRES_USER=${postgresUser}`,
        "-e",
        `POSTGRES_PASSWORD=${postgresPassword}`,
        "-e",
        `POSTGRES_DB=${postgresDb}`,
        "-p",
        `${this.env.dockerPort}:5432`,
        this.env.dockerImage,
      ],
      {
        maxBuffer: 1024 * 1024,
      },
    );
  }

  private async inspectContainerState(containerName: string): Promise<"missing" | "running" | "stopped"> {
    try {
      const result = await execFileAsync(
        "docker",
        ["inspect", "-f", "{{.State.Running}}", containerName],
        {
          maxBuffer: 1024 * 1024,
        },
      );
      return result.stdout.trim() === "true" ? "running" : "stopped";
    } catch {
      return "missing";
    }
  }

  private async waitForConnection(connectionString: string): Promise<void> {
    for (let attempt = 0; attempt < CONNECT_RETRY_COUNT; attempt += 1) {
      if (await this.canConnect(connectionString)) {
        return;
      }

      await sleep(CONNECT_RETRY_DELAY_MS);
    }

    throw new Error(`Timed out while waiting for PostgreSQL at ${redactDatabaseUrl(connectionString)}.`);
  }

  private async canConnect(connectionString: string): Promise<boolean> {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: this.env.connectTimeoutMs,
    });

    try {
      await client.connect();
      await client.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async ensureDatabaseExists(connectionString: string): Promise<boolean> {
    if (await this.canConnect(connectionString)) {
      return true;
    }

    if (!isLocalDatabaseUrl(connectionString)) {
      return false;
    }

    try {
      const adminConnectionString = toAdminConnectionString(connectionString);
      const client = new Client({
        connectionString: adminConnectionString,
        connectionTimeoutMillis: this.env.connectTimeoutMs,
      });
      await client.connect();

      try {
        const databaseName = readDatabaseName(connectionString);
        const queryResult = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists";`,
          [databaseName],
        );
        if (!queryResult.rows[0]?.exists) {
          await client.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
        }
      } finally {
        await client.end();
      }

      return this.canConnect(connectionString);
    } catch {
      return false;
    }
  }

  private async persistRunRecord(relativePath: string, record: Record<string, unknown>): Promise<void> {
    const absolutePath = path.join(this.baseDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, JSON.stringify(record, null, 2), "utf8");
  }
}

function readDatabaseName(connectionString: string): string {
  const parsedUrl = new URL(connectionString);
  return parsedUrl.pathname.replace(/^\/+/, "") || "postgres";
}

function toAdminConnectionString(connectionString: string): string {
  const parsedUrl = new URL(connectionString);
  parsedUrl.pathname = "/postgres";
  return parsedUrl.toString();
}

function isLocalDatabaseUrl(connectionString: string): boolean {
  const parsedUrl = new URL(connectionString);
  return ["127.0.0.1", "localhost"].includes(parsedUrl.hostname);
}

function redactDatabaseUrl(connectionString: string): string {
  const parsedUrl = new URL(connectionString);
  if (parsedUrl.password) {
    parsedUrl.password = "***";
  }

  return parsedUrl.toString();
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
