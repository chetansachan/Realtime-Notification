import { Redis } from 'ioredis';

export function createRedis(
  url: string,
  connectionName: string,
  onError?: (err: Error) => void,
): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName,
  });
  if (onError) client.on('error', onError);
  return client;
}
