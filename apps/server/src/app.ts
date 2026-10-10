import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastify, { LogController, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { DATABASE_SCHEMA_VERSION, defaultDatabasePath, openDatabase } from "./database.js";
import { Orchestrator } from "./orchestrator.js";
import { BUILT_IN_PROFILES, codexScratchDirectoryFor, createAdapters } from "./profiles.js";
import { TaskRepository } from "./repository.js";
import { registerTaskRoutes } from "./task-routes.js";

export interface AppOptions { databasePath?: string; logger?: boolean; development?: boolean }
const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const port = Number(process.env.PORT ?? 4317);
  const databasePath = options.databasePath ?? defaultDatabasePath();
  const database = openDatabase(databasePath);
  const app = fastify({
    logger: options.logger ?? true,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
  });

  const scratchDirectory = codexScratchDirectoryFor(databasePath);
  mkdirSync(scratchDirectory, { recursive: true });
  const orchestrator = new Orchestrator({
    repository: new TaskRepository(database.raw),
    profiles: BUILT_IN_PROFILES,
    adapters: createAdapters(scratchDirectory),
    log: app.log,
  });
  const recovered = orchestrator.recoverInterrupted();
  if (recovered > 0) app.log.info({ recovered }, "Marked interrupted tasks as failed");

  // 先停止运行中的任务并等待其写入终态，再关闭数据库。
  app.addHook("onClose", async () => {
    await orchestrator.shutdown();
    database.close();
  });

  app.addHook("onRequest", async (request, reply) => {
    const address = app.server.address();
    const activePort = address && typeof address === "object" ? address.port : port;
    if (request.headers.host !== `127.0.0.1:${activePort}`) {
      return reply.code(421).send({ error: "Request host is not allowed" });
    }
    if (!SAFE_METHODS.has(request.method)) {
      const allowedOrigins = new Set([`http://127.0.0.1:${activePort}`]);
      if (options.development ?? process.env.NODE_ENV !== "production") allowedOrigins.add("http://127.0.0.1:5173");
      if (!request.headers.origin || !allowedOrigins.has(request.headers.origin)) {
        return reply.code(403).send({ error: "Request origin is not allowed" });
      }
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "no-referrer")
      .header("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; connect-src 'self'");
    return payload;
  });
  app.get("/api/health", async (_request, reply) => {
    try {
      database.checkReady();
      return { status: "ready", service: "agent-operations-manager", storage: "sqlite", storageStatus: "ready", schemaVersion: DATABASE_SCHEMA_VERSION };
    } catch (error) {
      app.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Health check failed");
      return reply.code(503).send({ status: "not_ready", storage: "sqlite", storageStatus: "error" });
    }
  });
  registerTaskRoutes(app, orchestrator);
  if (existsSync(WEB_DIST)) await app.register(fastifyStatic, { root: WEB_DIST, prefix: "/", maxAge: 0, cacheControl: false });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "Not found" }));
  app.setErrorHandler((error, _request, reply) => {
    const requestError = error as Error & { code?: string };
    app.log.error({ errorName: requestError.name, errorCode: requestError.code }, "Request failed");
    if (!reply.sent) return reply.code(500).send({ error: "Internal server error" });
  });
  return app;
}
