import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createQueues } from '../jobs/queues.js';

export default fp(
  async function queuesPlugin(app: FastifyInstance) {
    const queues = createQueues(app.config.REDIS_URL);
    app.decorate('queues', queues);

    app.addHook('onClose', async () => {
      await queues.close();
    });
  },
  { name: 'queues' },
);
