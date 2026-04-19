import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUIDv7 so IDs sort roughly by insertion time and stay index-friendly. */
export function newId(): string {
  return uuidv7();
}

export function nowIso(): string {
  return new Date().toISOString();
}
