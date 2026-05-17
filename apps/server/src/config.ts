export interface ServerConfig {
  host: string;
  port: number;
  dbPath: string | undefined;
}

export function readServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  return {
    host: parseHost(env.CODEXHUB_HOST),
    port: parsePort(env.CODEXHUB_PORT),
    dbPath: parseOptionalString(env.CODEXHUB_DB_PATH),
  };
}

function parseHost(value: string | undefined): string {
  const host = value?.trim();
  return host ? host : "127.0.0.1";
}

function parsePort(value: string | undefined): number {
  const raw = value?.trim() ?? "4317";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `CODEXHUB_PORT must be an integer between 1 and 65535; received ${JSON.stringify(raw)}`,
    );
  }
  return port;
}

function parseOptionalString(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}
