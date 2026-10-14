import { buildApp } from "./app.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535");
  process.exitCode = 1;
} else {
  try {
    const app = await buildApp();
    let stopping = false;
    async function stop(signal: string): Promise<void> {
      if (stopping) return;
      stopping = true;
      app.log.info({ signal }, "Stopping local service");
      try { await app.close(); }
      catch (error) {
        app.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Service shutdown failed");
        process.exitCode = 1;
      }
    }
    process.once("SIGINT", () => void stop("SIGINT"));
    process.once("SIGTERM", () => void stop("SIGTERM"));

    try {
      await app.listen({ host, port });
      app.log.info({ url: `http://${host}:${port}` }, "Local service ready");
    } catch (error) {
      // 错误码（如 EADDRINUSE 表示端口已被其它进程占用）不含敏感内容，便于定位启动失败的原因。
      app.log.error({ errorName: error instanceof Error ? error.name : "UnknownError", errorCode: (error as NodeJS.ErrnoException).code }, "Local service failed to start");
      await app.close().catch((closeError) => {
        app.log.error({ errorName: closeError instanceof Error ? closeError.name : "UnknownError" }, "Service cleanup failed");
      });
      process.exitCode = 1;
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(JSON.stringify({ level: "error", event: "service_initialization_failed", errorName }));
    process.exitCode = 1;
  }
}
