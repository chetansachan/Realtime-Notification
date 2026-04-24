import { Type, type Static } from '@sinclair/typebox';
import { UserId } from '../../shared/schemas.js';

export const SubscriberTokenBody = Type.Object({
  userId: UserId,
  ttlSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 86_400 })),
});
export type SubscriberTokenBody = Static<typeof SubscriberTokenBody>;

export const SubscriberTokenResponse = Type.Object({
  token: Type.String(),
  expiresIn: Type.Integer(),
  appId: Type.String(),
  userId: Type.String(),
});

export const StreamTicketBody = Type.Object({
  userId: Type.Optional(UserId),
});
export type StreamTicketBody = Static<typeof StreamTicketBody>;

export const StreamTicketResponse = Type.Object({
  ticket: Type.String(),
  expiresIn: Type.Integer(),
  expiresAt: Type.String({ format: 'date-time' }),
  appId: Type.String(),
  userId: Type.String(),
});
