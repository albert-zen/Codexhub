import { readRuntimeSupervisorConfig } from "./config.js";
import { createRuntimeSupervisorServer } from "./runtime-supervisor.js";

const { host, port, dbPath } = readRuntimeSupervisorConfig();

const app = await createRuntimeSupervisorServer(dbPath ? { dbPath } : {});
await app.listen({ host, port });

app.log.info(`Codexhub runtime supervisor listening on http://${host}:${port}`);
