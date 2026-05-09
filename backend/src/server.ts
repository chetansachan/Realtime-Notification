import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const app = await buildApp({ config });

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  try {
    // onClose (realtime plugin) sends `event: reconnect` and ends every stream,
    // so clients re-establish elsewhere and replay from Postgres.
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  const address = await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ address, instanceId: config.INSTANCE_ID }, 'notification service listening');
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}

