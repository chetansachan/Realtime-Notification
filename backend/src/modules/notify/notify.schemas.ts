import { Type, type Static } from '@sinclair/typebox';
import { CategoryKey, DeliveryChannel, Uuid, UserId } from '../../shared/schemas.js';

export const NotifyBody = Type.Object({
  userIds: Type.Optional(
    Type.Array(UserId, { minItems: 1, maxItems: 1000, uniqueItems: true }),
  ),
  groupId: Type.Optional(Uuid),
  category: CategoryKey,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  body: Type.Optional(Type.String({ maxLength: 2000 })),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  channels: Type.Optional(Type.Array(DeliveryChannel, { uniqueItems: true, minItems: 1 })),
  priority: Type.Optional(
    Type.Union([Type.Literal('low'), Type.Literal('normal'), Type.Literal('high')], {
      default: 'normal',
    }),
  ),
  expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
});
export type NotifyBody = Static<typeof NotifyBody>;

export const NotifyStatus = Type.Union([
  Type.Literal('created'),
  Type.Literal('fanout_queued'),
  Type.Literal('duplicate'),
]);
export type NotifyStatus = Static<typeof NotifyStatus>;

export const NotifyResponse = Type.Object({
  id: Uuid,
  status: NotifyStatus,
  recipients: Type.Integer(),
  accepted: Type.Integer(),
  suppressed: Type.Integer(),
  createdAt: Type.String({ format: 'date-time' }),
});
export type NotifyResponse = Static<typeof NotifyResponse>;

export const NotifyHeaders = Type.Object({
  'idempotency-key': Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

export const DeliveryStatusItem = Type.Object({
  userId: UserId,
  channel: DeliveryChannel,
  status: Type.String(),
  seq: Type.Union([Type.Integer(), Type.Null()]),
  sentAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  deliveredAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  readAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  attemptCount: Type.Integer(),
  lastError: Type.Union([Type.String(), Type.Null()]),
});

export const NotificationStatusResponse = Type.Object({
  id: Uuid,
  category: Type.String(),
  title: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  deliveries: Type.Array(DeliveryStatusItem),
  totals: Type.Record(Type.String(), Type.Integer()),
});
