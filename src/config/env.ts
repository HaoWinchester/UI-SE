// 这个文件集中读取 Stitch 运行时所需的环境变量。
// 统一放在这里，可以避免业务代码里到处散落配置解析逻辑。
import "dotenv/config";

// 这里统一读取 .env 和进程环境变量，避免配置逻辑散落在各处。
const DEFAULT_STITCH_TIMEOUT_MS = 300_000;

export type StitchDeviceType =
  | "DEVICE_TYPE_UNSPECIFIED"
  | "MOBILE"
  | "DESKTOP"
  | "TABLET"
  | "AGNOSTIC";

export type StitchModelId =
  | "MODEL_ID_UNSPECIFIED"
  | "GEMINI_3_PRO"
  | "GEMINI_3_FLASH"
  | "GEMINI_3_1_PRO";

export interface StitchRuntimeEnv {
  apiKey?: string;
  accessToken?: string;
  googleCloudProject?: string;
  projectId?: string;
  baseUrl?: string;
  timeoutMs: number;
  deviceType: StitchDeviceType;
  modelId?: StitchModelId;
}

export interface DatabaseRuntimeEnv {
  url: string;
  autoStartDocker: boolean;
  dockerImage: string;
  dockerContainerName: string;
  dockerPort: number;
  connectTimeoutMs: number;
}

// 读取可选环境变量；如果没配置，就返回 undefined。
function readOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

// 读取数字配置，并在非法时回退到默认值。
function readNumber(name: string, fallback: number): number {
  const raw = readOptional(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = readOptional(name);
  if (!raw) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) {
    return false;
  }

  return fallback;
}

// 读取 Stitch 的设备类型，例如 DESKTOP / MOBILE。
function readDeviceType(): StitchDeviceType {
  const value = readOptional("STITCH_DEVICE_TYPE");
  const allowed: StitchDeviceType[] = ["DEVICE_TYPE_UNSPECIFIED", "MOBILE", "DESKTOP", "TABLET", "AGNOSTIC"];
  return allowed.includes(value as StitchDeviceType) ? (value as StitchDeviceType) : "DESKTOP";
}

// 读取 Stitch 的模型类型。
function readModelId(): StitchModelId | undefined {
  const value = readOptional("STITCH_MODEL_ID");
  const allowed: StitchModelId[] = [
    "MODEL_ID_UNSPECIFIED",
    "GEMINI_3_PRO",
    "GEMINI_3_FLASH",
    "GEMINI_3_1_PRO",
  ];

  return allowed.includes(value as StitchModelId) ? (value as StitchModelId) : undefined;
}

// 把和 Stitch 相关的配置统一组装成一个对象。
export function readStitchRuntimeEnv(): StitchRuntimeEnv {
  return {
    apiKey: readOptional("STITCH_API_KEY"),
    accessToken: readOptional("STITCH_ACCESS_TOKEN"),
    googleCloudProject: readOptional("GOOGLE_CLOUD_PROJECT"),
    projectId: readOptional("STITCH_PROJECT_ID"),
    baseUrl: readOptional("STITCH_HOST"),
    timeoutMs: readNumber("STITCH_TIMEOUT_MS", DEFAULT_STITCH_TIMEOUT_MS),
    deviceType: readDeviceType(),
    modelId: readModelId(),
  };
}

// 只要配置了 API Key，或者配置了 OAuth 所需参数，就认为可以尝试走真实 Stitch。
export function hasRealStitchCredentials(env: StitchRuntimeEnv): boolean {
  const hasApiKey = Boolean(env.apiKey);
  const hasOAuth = Boolean(env.accessToken && env.googleCloudProject);
  return hasApiKey || hasOAuth;
}

// 数据库执行阶段默认会优先读取 DATABASE_URL；
// 如果没有配置，就自动回退到项目专用的本地 Docker PostgreSQL。
export function readDatabaseRuntimeEnv(): DatabaseRuntimeEnv {
  const dockerPort = readNumber("POSTGRES_DOCKER_PORT", 55_432);
  const defaultUrl = `postgresql://postgres:postgres@127.0.0.1:${dockerPort}/ui_se`;

  return {
    url: readOptional("DATABASE_URL") ?? defaultUrl,
    autoStartDocker: readBoolean("POSTGRES_AUTO_START", true),
    dockerImage: readOptional("POSTGRES_DOCKER_IMAGE") ?? "postgres:16-alpine",
    dockerContainerName: readOptional("POSTGRES_DOCKER_CONTAINER") ?? "ui-se-postgres",
    dockerPort,
    connectTimeoutMs: readNumber("DATABASE_CONNECT_TIMEOUT_MS", 8_000),
  };
}
