import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";
import { DecayScheduler } from "./scheduler/decayLoop";
import { config } from "./lib/config";

const port = config.port;
const scheduler = new DecayScheduler();

scheduler.start();

app.listen(port, () => {
  logger.info({ port }, "Server listening");
});
