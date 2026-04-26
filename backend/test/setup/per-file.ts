import { afterAll } from 'vitest';
import { closeTestPool } from '../helpers/db.js';

// Keep worker processes free of dangling handles between test files.
afterAll(async () => {
  await closeTestPool();
});
