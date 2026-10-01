import { createApp } from './app';
import { config } from './config';
import { createLogger } from './logger';

const logger = createLogger();
const app = createApp({ logger });

app.listen(config.port, () => {
  logger.info(`Cart API chạy tại http://localhost:${config.port} — docs: http://localhost:${config.port}/docs`);
});
