import { readServerConfig } from "./config.js";
import { createServer } from "./server.js";

const { host, port, dbPath, runtimeSupervisorUrl } = readServerConfig();

const app = await createServer({
  ...(dbPath ? { dbPath } : {}),
  ...(runtimeSupervisorUrl ? { runtimeSupervisorUrl } : {}),
});
await app.listen({ host, port });

app.log.info(`Codexhub API listening on http://${host}:${port}`);
