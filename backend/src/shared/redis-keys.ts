export const CHANNEL_PREFIX = 'ntf:';

/** Pub/Sub channel for one user. appId never contains a colon; userId may. */
export function userChannel(appId: string, userId: string): string {
  return `${CHANNEL_PREFIX}${appId}:${userId}`;
}

export function parseUserChannel(channel: string): { appId: string; userId: string } | null {
  if (!channel.startsWith(CHANNEL_PREFIX)) return null;
  const rest = channel.slice(CHANNEL_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0 || separator === rest.length - 1) return null;
  return { appId: rest.slice(0, separator), userId: rest.slice(separator + 1) };
}

export function streamTicketKey(ticket: string): string {
  return `ntf:ticket:${ticket}`;
}
