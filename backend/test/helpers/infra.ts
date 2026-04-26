import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface TestInfra {
  dbUrl: string;
  redisUrl: string;
}

let cached: TestInfra | null = null;

export function infra(): TestInfra {
  if (!cached) {
    cached = JSON.parse(readFileSync(resolve(process.cwd(), 'test/.infra.json'), 'utf8')) as TestInfra;
  }
  return cached;
}
