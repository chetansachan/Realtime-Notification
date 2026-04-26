import type { AppInstance } from '../../src/app.js';
import { generateApiKey } from '../../src/shared/crypto.js';
import { insertApiClient } from '../../src/modules/api-keys/api-keys.repository.js';
import { issueStreamTicket, issueSubscriberToken } from '../../src/plugins/subscriber-auth.js';

export interface TestApiKey {
  key: string;
  prefix: string;
  id: string;
  appId: string;
}

export async function createApiKey(
  app: AppInstance,
  options: { appId?: string; scopes?: string[]; name?: string } = {},
): Promise<TestApiKey> {
  const generated = generateApiKey('test');
  const row = await insertApiClient(app.db, {
    appId: options.appId ?? 'app-test',
    name: options.name ?? 'test-key',
    prefix: generated.prefix,
    hash: generated.hash,
    scopes: options.scopes ?? ['*'],
  });

  return { key: generated.plaintext, prefix: generated.prefix, id: row.id, appId: row.app_id };
}

export function authHeader(key: string): { authorization: string } {
  return { authorization: `Bearer ${key}` };
}

export function subscriberToken(app: AppInstance, appId: string, userId: string): string {
  return issueSubscriberToken(app, appId, userId).token;
}

export async function streamTicket(
  app: AppInstance,
  appId: string,
  userId: string,
): Promise<string> {
  const { ticket } = await issueStreamTicket(app, appId, userId);
  return ticket;
}

export interface NotifyInput {
  userIds?: string[];
  groupId?: string;
  category?: string;
  title?: string;
  body?: string;
  channels?: ('in_app' | 'email' | 'webhook')[];
  data?: Record<string, unknown>;
  expiresAt?: string;
}

export async function notify(
  app: TestAppLike,
  key: string,
  input: NotifyInput,
  idempotencyKey?: string,
) {
  return fetch(`${app.url}/v1/notify`, {
    method: 'POST',
    headers: {
      ...authHeader(key),
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      category: 'test',
      title: 'Hello',
      ...(input.userIds ? { userIds: input.userIds } : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.body ? { body: input.body } : {}),
      ...(input.channels ? { channels: input.channels } : {}),
      ...(input.data ? { data: input.data } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    }),
  });
}

export interface TestAppLike {
  url: string;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
