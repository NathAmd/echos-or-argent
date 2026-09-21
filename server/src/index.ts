import { createApplication, type ApplicationLogger } from "./app.js";
import { loadServerConfig } from "./config.js";
import { describeUnknownError } from "./errors.js";

const logger: ApplicationLogger = {
  error(event, fields) {
    console.error(JSON.stringify({ event, level: "error", ...fields, timestamp: new Date().toISOString() }));
  },
  info(event, fields) {
    console.log(JSON.stringify({ event, level: "info", ...fields, timestamp: new Date().toISOString() }));
  },
};

try {
  const config = loadServerConfig(process.env);
  const application = await createApplication(config, { logger });
  const address = await application.listen();
  logger.info("ready", { host: address.host, port: address.port });

  let shutdownStarted = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    logger.info("shutdown_requested", { signal });
    try {
      await application.close(10_000);
      process.exitCode = 0;
    } catch (error) {
      logger.error("shutdown_failed", { error: describeUnknownError(error) });
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
} catch (error) {
  logger.error("startup_failed", { error: describeUnknownError(error) });
  process.exitCode = 1;
}
