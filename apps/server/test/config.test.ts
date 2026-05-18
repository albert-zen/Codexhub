import { describe, expect, it } from "vitest";
import {
  readRuntimeSupervisorConfig,
  readServerConfig,
} from "../src/config.js";

describe("server config", () => {
  it("uses local defaults", () => {
    expect(readServerConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4317,
      dbPath: undefined,
      runtimeSupervisorUrl: undefined,
    });
  });

  it("parses host, port, db path, and supervisor url from environment", () => {
    expect(
      readServerConfig({
        CODEXHUB_HOST: "0.0.0.0",
        CODEXHUB_PORT: "5432",
        CODEXHUB_DB_PATH: "D:\\data\\codexhub.sqlite",
        CODEXHUB_RUNTIME_SUPERVISOR_URL: "http://127.0.0.1:4319",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 5432,
      dbPath: "D:\\data\\codexhub.sqlite",
      runtimeSupervisorUrl: "http://127.0.0.1:4319/",
    });
  });

  it("rejects invalid ports before listening", () => {
    expect(() => readServerConfig({ CODEXHUB_PORT: "not-a-port" })).toThrow(
      /CODEXHUB_PORT/,
    );
    expect(() => readServerConfig({ CODEXHUB_PORT: "70000" })).toThrow(
      /CODEXHUB_PORT/,
    );
  });

  it("rejects invalid runtime supervisor urls before listening", () => {
    expect(() =>
      readServerConfig({
        CODEXHUB_RUNTIME_SUPERVISOR_URL: "not-a-url",
      }),
    ).toThrow(/CODEXHUB_RUNTIME_SUPERVISOR_URL/);
    expect(() =>
      readServerConfig({
        CODEXHUB_RUNTIME_SUPERVISOR_URL: "file:///tmp/supervisor",
      }),
    ).toThrow(/CODEXHUB_RUNTIME_SUPERVISOR_URL/);
  });

  it("parses runtime supervisor listener config", () => {
    expect(readRuntimeSupervisorConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4319,
      dbPath: undefined,
    });

    expect(
      readRuntimeSupervisorConfig({
        CODEXHUB_RUNTIME_SUPERVISOR_HOST: "0.0.0.0",
        CODEXHUB_RUNTIME_SUPERVISOR_PORT: "6432",
        CODEXHUB_DB_PATH: "D:\\data\\codexhub.sqlite",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 6432,
      dbPath: "D:\\data\\codexhub.sqlite",
    });
  });
});
