import { readServerConfig } from "./config.js";
import { createServer } from "./server.js";

const { host, port, dbPath } = readServerConfig();

const app = await createServer(dbPath ? { dbPath } : {});
await app.listen({ host, port });

app.log.info(`Codexhub API listening on http://${host}:${port}`);
