/**
 * Lightweight browser smoke test over CDP (no Playwright dependency).
 *
 * Requires the API and the Vite dev server to be running:
 *   (cd backend && npm run dev)  +  (cd frontend && npm run dev)
 * then:
 *   node scripts/browser-check.mjs
 *
 * It verifies the playground renders, the stream goes live, a send arrives,
 * and an offline batch replays on reconnect. Screenshot goes to docs/playground.png.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const PORT = Number(process.env.CDP_PORT ?? 9229);
const SCREENSHOT = resolve(process.env.SCREENSHOT ?? 'docs/playground.png');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chromePath = CANDIDATES.find((candidate) => candidate && existsSync(candidate));
if (!chromePath) {
  console.error('No Chrome/Chromium found. Set CHROME_PATH.');
  process.exit(1);
}

const user = `user-${Math.random().toString(16).slice(2, 8)}`;
const url = `${BASE}/playground?user=${user}`;
const profile = mkdtempSync(join(tmpdir(), 'ntf-cdp-'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const fail = (message) => {
  throw new Error(message);
};

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
let nextId = 1;
const pending = new Map();
const pageErrors = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolvePromise, rejectPromise) => {
    pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    fail(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitUntil(description, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(expression);
    if (last) return last;
    await sleep(200);
  }
  fail(`timed out waiting for ${description} (last=${JSON.stringify(last)})`);
}

try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const version = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (version.ok) break;
    } catch {
      // still starting
    }
    if (attempt === 79) fail('Chrome did not expose the debugging port');
    await sleep(250);
  }

  const target = await fetch(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' },
  ).then((response) => response.json());

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', rejectOpen, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(
        message.params.exceptionDetails?.exception?.description ??
          message.params.exceptionDetails?.text ??
          'exception',
      );
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      pageErrors.push(message.params.entry.text);
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  await waitUntil('playground heading', `document.body.innerText.includes('Watch a notification travel')`);
  await waitUntil(
    'live connection',
    `document.querySelector('.pill')?.innerText?.includes('Live') ?? false`,
  );
  console.log('ok  stream live');

  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((el) => el.textContent.trim().startsWith('Send to'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) fail('send button not found');

  const firstTitle = await waitUntil(
    'first notification in the inbox',
    `document.querySelector('.notification-item .title')?.textContent?.trim() ?? ''`,
  );
  console.log('ok  live notification received:', JSON.stringify(firstTitle));

  const offlineClicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Go offline + send 5');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!offlineClicked) fail('offline simulation button not found');

  await waitUntil(
    'catch-up to seq 6 after reconnect',
    `document.querySelectorAll('dl dd')[1]?.textContent?.trim() === '6'`,
    40_000,
  );
  const items = await evaluate(`document.querySelectorAll('.notification-item').length`);
  if (items !== 6) fail(`expected 6 inbox items after catch-up, saw ${items}`);
  console.log('ok  replay caught up to seq 6 with 6 items');

  const kinds = JSON.parse(
    await evaluate(
      `JSON.stringify([...document.querySelectorAll('.event-log-row')].map((row) => row.children[1].textContent))`,
    ),
  );
  if (!kinds.includes('notification')) fail('event log missing notifications');
  if (kinds.includes('duplicate')) fail('duplicate event from a stale stream client');
  if (kinds.filter((kind) => kind === 'hello').length !== 1) {
    fail(`expected one hello, saw ${JSON.stringify(kinds)}`);
  }
  console.log('ok  event log has one hello and no duplicates');

  mkdirSync(dirname(SCREENSHOT), { recursive: true });
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  console.log('ok  screenshot:', SCREENSHOT);

  if (pageErrors.length > 0) fail(`console errors: ${pageErrors.join(' | ')}`);
  console.log('BROWSER CHECK PASS');
} catch (error) {
  console.error('FAIL:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {
    // ignore
  }
  chrome.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Windows file locks may linger briefly
  }
  process.exit(process.exitCode ?? 0);
}
