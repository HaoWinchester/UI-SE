import { execFileSync } from "node:child_process";

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export interface ProxyConfigurationResult {
  configured: boolean;
  source: "env" | "system" | "none";
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

let cachedResult: ProxyConfigurationResult | undefined;

export function configureNodeHttpProxy(): ProxyConfigurationResult {
  if (cachedResult) {
    return cachedResult;
  }

  const explicit = readExplicitProxyConfiguration();
  if (explicit) {
    applyProxyEnvironment(explicit);
    cachedResult = {
      configured: true,
      source: "env",
      httpProxy: process.env.HTTP_PROXY,
      httpsProxy: process.env.HTTPS_PROXY,
      noProxy: process.env.NO_PROXY,
    };
    return cachedResult;
  }

  const system = detectMacOsSystemProxy();
  if (system) {
    applyProxyEnvironment(system);
    cachedResult = {
      configured: true,
      source: "system",
      httpProxy: process.env.HTTP_PROXY,
      httpsProxy: process.env.HTTPS_PROXY,
      noProxy: process.env.NO_PROXY,
    };
    return cachedResult;
  }

  cachedResult = {
    configured: false,
    source: "none",
  };
  return cachedResult;
}

function readExplicitProxyConfiguration():
  | {
      httpProxy?: string;
      httpsProxy?: string;
      noProxy?: string;
    }
  | undefined {
  const sharedProxy = readOptionalEnv("STITCH_PROXY_URL");
  const httpProxy = readOptionalEnv("HTTP_PROXY") ?? readOptionalEnv("http_proxy") ?? sharedProxy;
  const httpsProxy = readOptionalEnv("HTTPS_PROXY") ?? readOptionalEnv("https_proxy") ?? sharedProxy;
  const noProxy = readOptionalEnv("NO_PROXY") ?? readOptionalEnv("no_proxy");

  if (!httpProxy && !httpsProxy) {
    return undefined;
  }

  return {
    httpProxy,
    httpsProxy,
    noProxy,
  };
}

function detectMacOsSystemProxy():
  | {
      httpProxy?: string;
      httpsProxy?: string;
      noProxy?: string;
    }
  | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }

  try {
    const output = execFileSync("scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 3_000,
    });
    const config = parseScutilProxyOutput(output);
    const httpProxy =
      config.HTTPEnable === "1" && config.HTTPProxy && config.HTTPPort
        ? `http://${config.HTTPProxy}:${config.HTTPPort}`
        : undefined;
    const httpsProxy =
      config.HTTPSEnable === "1" && config.HTTPSProxy && config.HTTPSPort
        ? `http://${config.HTTPSProxy}:${config.HTTPSPort}`
        : httpProxy;

    if (!httpProxy && !httpsProxy) {
      return undefined;
    }

    const exceptions = Array.isArray(config.ExceptionsList)
      ? config.ExceptionsList.join(",")
      : undefined;

    return {
      httpProxy,
      httpsProxy,
      noProxy: exceptions,
    };
  } catch {
    return undefined;
  }
}

function applyProxyEnvironment(config: {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}): void {
  if (config.httpProxy) {
    process.env.HTTP_PROXY = config.httpProxy;
    process.env.http_proxy = config.httpProxy;
  }

  if (config.httpsProxy) {
    process.env.HTTPS_PROXY = config.httpsProxy;
    process.env.https_proxy = config.httpsProxy;
  }

  if (config.noProxy) {
    process.env.NO_PROXY = config.noProxy;
    process.env.no_proxy = config.noProxy;
  }

  // undici does not pick up the macOS system proxy automatically in our runtime,
  // so we bind an environment-aware dispatcher explicitly for all fetch calls.
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

function parseScutilProxyOutput(output: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const lines = output.split(/\r?\n/);
  let activeArrayKey: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "<dictionary> {" || line === "{" || line === "<array> {") {
      continue;
    }

    const arrayHeader = line.match(/^([A-Za-z0-9]+)\s*:\s*<array>\s*\{$/);
    if (arrayHeader) {
      activeArrayKey = arrayHeader[1];
      result[activeArrayKey] = [];
      continue;
    }

    if (activeArrayKey && line === "}") {
      activeArrayKey = undefined;
      continue;
    }

    if (activeArrayKey) {
      if (line === "}") {
        activeArrayKey = undefined;
        continue;
      }

      const arrayEntry = line.match(/^\d+\s*:\s*(.+)$/);
      if (arrayEntry) {
        (result[activeArrayKey] as string[]).push(arrayEntry[1]);
      }
      continue;
    }

    if (line === "}") {
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9]+)\s*:\s*(.+)$/);
    if (keyValue) {
      result[keyValue[1]] = keyValue[2];
    }
  }

  return result;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
