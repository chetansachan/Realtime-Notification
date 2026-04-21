import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/client.js';
import { generateApiKey, sha256Hex } from '../src/shared/crypto.js';
import { insertApiClient } from '../src/modules/api-keys/api-keys.repository.js';

/**
 * Bootstrap the first API key. After that, use POST /v1/api-keys with an
 * admin-scoped key to mint more.
 *
 *   npm run seed:key -- --app demo --name bootstrap --scopes "*"
 *   npm run seed:key -- --app myapp --name ci --key ntf_live_xxx
 */
const { values } = parseArgs({
  options: {
    app: { type: 'string', default: 'demo' },
    name: { type: 'string', default: 'bootstrap' },
    scopes: { type: 'string', default: '*' },
    key: { type: 'string' },
  },
});

const config = loadConfig();
const { db, pool } = createDb({
  connectionString: config.DATABASE_URL,
  maxConnections: 1,
  applicationName: 'seed-key',
});

try {
  const scopes = (values.scopes ?? '*')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

  let plaintext: string;
  let prefix: string;
  let hash: string;

  if (values.key) {
    const match = /^ntf_(?:live|test)_([0-9a-f]{12})_/.exec(values.key);
    if (!match?.[1]) {
      console.error('Provided key is not a valid ntf_<env>_<prefix>_<secret> key');
      process.exit(1);
    }
    plaintext = values.key;
    prefix = match[1];
    hash = sha256Hex(plaintext);
  } else {
    const generated = generateApiKey(config.NODE_ENV === 'test' ? 'test' : 'live');
    plaintext = generated.plaintext;
    prefix = generated.prefix;
    hash = generated.hash;
  }

  const client = await insertApiClient(db, {
    appId: values.app ?? 'demo',
    name: values.name ?? 'bootstrap',
    prefix,
    hash,
    scopes,
  });

  console.log('API key created (shown once):');
  console.log(`  id:      ${client.id}`);
  console.log(`  appId:   ${client.app_id}`);
  console.log(`  scopes:  ${scopes.join(', ')}`);
  console.log(`  key:     ${plaintext}`);
} finally {
  await db.destroy();
  void pool;
}
