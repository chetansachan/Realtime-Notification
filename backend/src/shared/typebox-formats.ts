import { FormatRegistry } from '@sinclair/typebox';

/**
 * TypeBox's Value.Check does not validate `format` keywords until the format is
 * registered, and an unknown format evaluates to false (not "skip"). Register
 * the one we use so WS control messages are actually accepted.
 */
let registered = false;

export function ensureTypeBoxFormats(): void {
  if (registered) return;
  registered = true;
  FormatRegistry.Set(
    'uuid',
    (value) =>
      typeof value === 'string' &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value),
  );
}
