import { describe, expect, it } from 'vitest';
import {
  isPrivateAddress,
  resolveWebhookTarget,
  WebhookSecurityError,
} from '../../src/delivery/webhook.channel.js';
import { signWebhook, verifyWebhookSignature } from '../../src/shared/crypto.js';

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof WebhookSecurityError) return err.reason;
    throw err;
  }
  throw new Error('expected the URL to be rejected');
}

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['172.32.0.1', false],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['::ffff:127.0.0.1', true],
    ['2606:4700:4700::1111', false],
  ])('%s -> %s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe('resolveWebhookTarget', () => {
  it('rejects non-https schemes by default', async () => {
    expect(await rejection(resolveWebhookTarget('http://127.0.0.1/hook', {
      allowHttp: false,
      allowPrivateIps: false,
    }))).toBe('insecure_scheme');
  });

  it('rejects private addresses by default', async () => {
    expect(await rejection(resolveWebhookTarget('https://10.0.0.5/hook', {
      allowHttp: false,
      allowPrivateIps: false,
    }))).toBe('private_address');

    expect(await rejection(resolveWebhookTarget('http://127.0.0.1:9000/hook', {
      allowHttp: true,
      allowPrivateIps: false,
    }))).toBe('private_address');
  });

  it('rejects unsupported schemes', async () => {
    expect(await rejection(resolveWebhookTarget('ftp://example.com/hook', {
      allowHttp: false,
      allowPrivateIps: false,
    }))).toBe('insecure_scheme');
  });

  it('rejects malformed URLs', async () => {
    expect(await rejection(resolveWebhookTarget('not a url', {
      allowHttp: true,
      allowPrivateIps: true,
    }))).toBe('invalid_url');
  });

  it('pins the resolved address when explicitly allowed', async () => {
    const target = await resolveWebhookTarget('http://127.0.0.1:9000/hook', {
      allowHttp: true,
      allowPrivateIps: true,
    });
    expect(target.address).toBe('127.0.0.1');
    expect(target.url.port).toBe('9000');
  });
});

describe('webhook signatures', () => {
  it('verifies a fresh signature and rejects tampering or replay', () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ hello: 'world' });
    const now = Math.floor(Date.now() / 1000);
    const header = signWebhook(secret, now, body);

    expect(verifyWebhookSignature(secret, header, body, 300, now)).toBe(true);
    expect(verifyWebhookSignature(secret, header, `${body} `, 300, now)).toBe(false);
    expect(verifyWebhookSignature(secret, header, body, 300, now + 10_000)).toBe(false);
    expect(verifyWebhookSignature('other-secret', header, body, 300, now)).toBe(false);
  });
});
