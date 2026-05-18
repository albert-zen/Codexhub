import { spawnSync } from "node:child_process";

const validationCommand = process.argv[2] ?? "web validation";

const nodeProbe = spawnSync(process.execPath, ["-e", ""], {
  encoding: "utf8",
  windowsHide: true,
});

if (nodeProbe.error || nodeProbe.status !== 0) {
  fail(validationCommand, "Node child process probe", nodeProbe);
}

if (process.platform === "win32") {
  const netProbe = spawnSync("net", ["use"], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (netProbe.error) {
    fail(validationCommand, "Windows `net use` probe used by Vite", netProbe);
  }
}

function fail(commandName, probeName, result) {
  const details = [
    result.error ? `error=${result.error.message}` : null,
    result.status === null ? null : `status=${result.status}`,
    result.signal ? `signal=${result.signal}` : null,
  ].filter(Boolean);

  console.error(
    [
      `Codexhub web ${commandName} cannot run in this environment because ${probeName} failed${details.length > 0 ? ` (${details.join(", ")})` : ""}.`,
      "",
      "Vite and Vitest require Node child-process support for esbuild, worker pools, and Windows path resolution.",
      "Run the same pnpm command from a checkout or Codexhub worker sandbox that permits Node child_process spawn.",
      "Do not report web build or test validation as passed from this sandbox.",
    ].join("\n"),
  );
  process.exit(1);
}
