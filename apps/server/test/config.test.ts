import { describe, expect, it } from "vitest";
import { readServerConfig } from "../src/config.js";

describe("server config", () => {
  it("uses local defaults", () => {
    expect(readServerConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4317,
      dbPath: undefined,
    });
  });

  it("parses host, port, and db path from environment", () => {
    expect(
      readServerConfig({
        CODEXHUB_HOST: "0.0.0.0",
        CODEXHUB_PORT: "5432",
        CODEXHUB_DB_PATH: "D:\\data\\codexhub.sqlite",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 5432,
      dbPath: "D:\\data\\codexhub.sqlite",
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
});
