import "dotenv/config";
import { createApp } from "./app.js";
import { closeDb } from "./db.js";
import { log } from "./log.js";
import { defaultProvider, registry } from "./providers/index.js";
import { startWorker } from "./worker.js";

let app;
try { app = createApp(); }
catch (e) { console.error((e as Error).message); process.exit(1); }

const port = Number(process.env.PORT ?? 3000);
const stopWorker = startWorker();
const server = app.listen(port, () =>
  log.info("API no ar", { port, providers: Object.keys(registry()), default: defaultProvider() }));

// Encerramento limpo (SIGTERM do Docker/Kubernetes): para de aceitar conexões, espera a rodada do worker, fecha o banco.
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info("encerrando", { signal });
  const force = setTimeout(() => { log.error("tempo esgotado no encerramento"); process.exit(1); }, 130_000);
  force.unref();
  await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeIdleConnections(); });
  await stopWorker();
  closeDb();
  log.info("encerrado");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
