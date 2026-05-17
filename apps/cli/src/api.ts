export type JsonObject = Record<string, unknown>;

export interface RequestOptions {
  body?: JsonObject;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ApiError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(message: string, status: number, responseBody: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
  }

  async get<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async post<T = unknown>(
    path: string,
    body?: JsonObject,
    options: RequestOptions = {},
  ): Promise<T> {
    const requestOptions: RequestOptions = { ...options };
    if (body !== undefined) requestOptions.body = body;
    return this.request<T>("POST", path, requestOptions);
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const init: RequestInit = { method };
    if (options.body) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, path, options.query),
      init,
    );

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      throw new ApiError(
        errorMessage(response, responseBody),
        response.status,
        responseBody,
      );
    }

    return responseBody as T;
  }
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, string | number | boolean | null | undefined> = {},
): string {
  const url = new URL(
    `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`,
  );
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;

  const text = await response.text();
  if (text.trim() === "") return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(response: Response, body: unknown): string {
  if (isRecord(body)) {
    const message = body.message ?? body.error;
    if (typeof message === "string" && message.trim() !== "") return message;
  }

  if (typeof body === "string" && body.trim() !== "") return body;
  return `HTTP ${response.status} ${response.statusText}`.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
