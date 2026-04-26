import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { authHeader, createApiKey, notify, streamTicket, subscriberToken } from '../helpers/api.js';
import { SseTestClient, streamUrl } from '../helpers/sse.js';
import { resetDatabase } from '../helpers/db.js';

let tested: TestApp;

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp();
});

afterEach(async () => {
  await tested.close();
});

describe('authentication', () => {
  it('rejects missing and malformed credentials', async () => {
    const missing = await fetch(`${tested.url}/v1/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(missing.status).toBe(401);

    const malformed = await fetch(`${tested.url}/v1/notify`, {
      method: 'POST',
      headers: { ...authHeader('not-a-real-key'), 'content-type': 'application/json' },
      body: '{}',
    });
    expect(malformed.status).toBe(401);
  });

  it('enforces scopes', async () => {
    const limited = await createApiKey(tested.app, { scopes: ['notify:write'] });

    const mint = await fetch(`${tested.url}/v1/subscriber-tokens`, {
      method: 'POST',
      headers: { ...authHeader(limited.key), 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    expect(mint.status).toBe(403);
    const body = (await mint.json()) as { code: string };
    expect(body.code).toBe('forbidden');

    const write = await notify(tested, limited.key, { userIds: ['user-1'] });
    expect(write.status).toBe(201);

    const admin = await createApiKey(tested.app);
    const ok = await fetch(`${tested.url}/v1/subscriber-tokens`, {
      method: 'POST',
      headers: { ...authHeader(admin.key), 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    expect(ok.status).toBe(200);
  });

  it('rejects API keys on subscriber endpoints and subscriber tokens on ingest', async () => {
    const key = await createApiKey(tested.app);
    const token = subscriberToken(tested.app, key.appId, 'user-1');

    const ingest = await fetch(`${tested.url}/v1/notify`, {
      method: 'POST',
      headers: { ...authHeader(token), 'content-type': 'application/json' },
      body: JSON.stringify({ userIds: ['user-1'], category: 'test', title: 'x' }),
    });
    expect(ingest.status).toBe(401);

    const history = await fetch(`${tested.url}/v1/notifications`, {
      headers: authHeader(key.key),
    });
    expect(history.status).toBe(401);
  });

  it('consumes a stream ticket exactly once', async () => {
    const key = await createApiKey(tested.app);
    const ticket = await streamTicket(tested.app, key.appId, 'user-1');

    const client = await SseTestClient.connect(streamUrl(tested.url, ticket));
    client.close();

    const replay = await fetch(streamUrl(tested.url, ticket));
    expect(replay.status).toBe(401);
    const body = (await replay.json()) as { code: string };
    expect(body.code).toBe('unauthorized');
  });

  it('rejects expired subscriber tokens', async () => {
    const key = await createApiKey(tested.app);
    const minted = await fetch(`${tested.url}/v1/subscriber-tokens`, {
      method: 'POST',
      headers: { ...authHeader(key.key), 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', ttlSeconds: 60 }),
    });
    const { token } = (await minted.json()) as { token: string };
    expect(typeof token).toBe('string');

    const tampered = `${token.slice(0, -3)}abc`;
    const history = await fetch(`${tested.url}/v1/notifications`, {
      headers: authHeader(tampered),
    });
    expect(history.status).toBe(401);
  });
});

describe('tenancy', () => {
  it('never exposes one app\'s notification to another app', async () => {
    const tenantA = await createApiKey(tested.app, { appId: 'tenant-a' });
    const tenantB = await createApiKey(tested.app, { appId: 'tenant-b' });

    const created = await notify(tested, tenantA.key, {
      userIds: ['user-1'],
      title: 'tenant A only',
    });
    const { id } = (await created.json()) as { id: string };

    const own = await fetch(`${tested.url}/v1/notifications/${id}`, {
      headers: authHeader(tenantA.key),
    });
    expect(own.status).toBe(200);

    const other = await fetch(`${tested.url}/v1/notifications/${id}`, {
      headers: authHeader(tenantB.key),
    });
    expect(other.status).toBe(404);
  });
});
