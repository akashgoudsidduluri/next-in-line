import app from "./app";
import { logger } from "./lib/logger";
import { startDecayLoop } from "./scheduler/decayLoop";
import { config } from "./lib/config";

const port = config.port;

startDecayLoop();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
