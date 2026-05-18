export interface ServerConfig {
  host: string;
  port: number;
  dbPath: string | undefined;
  runtimeSupervisorUrl: string | undefined;
}

export interface RuntimeSupervisorConfig {
  host: string;
  port: number;
  dbPath: string | undefined;
}

export function readServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  return {
    host: parseHost(env.CODEXHUB_HOST),
    port: parsePort(env.CODEXHUB_PORT, "CODEXHUB_PORT", 4317),
    dbPath: parseOptionalString(env.CODEXHUB_DB_PATH),
    runtimeSupervisorUrl: parseOptionalUrl(
      env.CODEXHUB_RUNTIME_SUPERVISOR_URL,
      "CODEXHUB_RUNTIME_SUPERVISOR_URL",
    ),
  };
}

export function readRuntimeSupervisorConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeSupervisorConfig {
  return {
    host: parseHost(env.CODEXHUB_RUNTIME_SUPERVISOR_HOST),
    port: parsePort(
      env.CODEXHUB_RUNTIME_SUPERVISOR_PORT,
      "CODEXHUB_RUNTIME_SUPERVISOR_PORT",
      4319,
    ),
    dbPath: parseOptionalString(env.CODEXHUB_DB_PATH),
  };
}

function parseHost(value: string | undefined): string {
  const host = value?.trim();
  return host ? host : "127.0.0.1";
}

function parsePort(
  value: string | undefined,
  envName: string,
  fallback: number,
): number {
  const raw = value?.trim() ?? String(fallback);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535; received ${JSON.stringify(raw)}`,
    );
  }
  return port;
}

function parseOptionalString(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function parseOptionalUrl(
  value: string | undefined,
  envName: string,
): string | undefined {
  const text = parseOptionalString(value);
  if (!text) return undefined;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(
      `${envName} must be an absolute http(s) URL; received ${JSON.stringify(text)}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `${envName} must use http or https; received ${JSON.stringify(text)}`,
    );
  }
  url.hash = "";
  return url.toString();
}
