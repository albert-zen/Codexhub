import { createServer } from "./server.js";

const port = Number(process.env.CODEXHUB_PORT ?? "4317");
const host = process.env.CODEXHUB_HOST ?? "127.0.0.1";

const app = await createServer();
await app.listen({ host, port });

app.log.info(`Codexhub API listening on http://${host}:${port}`);
