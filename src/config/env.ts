import "dotenv/config";

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

function readOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = readOptional(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readDeviceType(): StitchDeviceType {
  const value = readOptional("STITCH_DEVICE_TYPE");
  const allowed: StitchDeviceType[] = ["DEVICE_TYPE_UNSPECIFIED", "MOBILE", "DESKTOP", "TABLET", "AGNOSTIC"];
  return allowed.includes(value as StitchDeviceType) ? (value as StitchDeviceType) : "DESKTOP";
}

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

export function hasRealStitchCredentials(env: StitchRuntimeEnv): boolean {
  const hasApiKey = Boolean(env.apiKey);
  const hasOAuth = Boolean(env.accessToken && env.googleCloudProject);
  return hasApiKey || hasOAuth;
}
