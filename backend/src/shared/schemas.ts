import { Type, type Static } from '@sinclair/typebox';

export const ErrorResponse = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer(),
    detail: Type.Optional(Type.String()),
    code: Type.Optional(Type.String()),
    errors: Type.Optional(Type.Unknown()),
    requestId: Type.Optional(Type.String()),
  },
  { $id: 'ErrorResponse' },
);
export type ErrorResponse = Static<typeof ErrorResponse>;

export const UserId = Type.String({ minLength: 1, maxLength: 128, pattern: '^[^\\u0000]*$' });
export const AppId = Type.String({ minLength: 1, maxLength: 64 });
export const Seq = Type.Integer({ minimum: 0 });
export const Cursor = Type.String({ minLength: 1, maxLength: 32 });
export const Uuid = Type.String({ format: 'uuid' });
export const CategoryKey = Type.String({ pattern: '^[a-z0-9_.-]{1,64}$' });

export const DeliveryChannel = Type.Union([
  Type.Literal('in_app'),
  Type.Literal('email'),
  Type.Literal('webhook'),
]);
export type DeliveryChannel = Static<typeof DeliveryChannel>;

export const DeliveryStatus = Type.Union([
  Type.Literal('queued'),
  Type.Literal('sent'),
  Type.Literal('delivered'),
  Type.Literal('read'),
  Type.Literal('failed'),
  Type.Literal('suppressed'),
]);
export type DeliveryStatus = Static<typeof DeliveryStatus>;

export const NotificationDto = Type.Object({
  id: Uuid,
  seq: Seq,
  category: CategoryKey,
  title: Type.String(),
  body: Type.Union([Type.String(), Type.Null()]),
  data: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  priority: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  readAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
export type NotificationDto = Static<typeof NotificationDto>;

export const PaginationQuery = Type.Object({
  before: Type.Optional(Seq),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
});

export const IdempotencyHeader = Type.Object({
  'idempotency-key': Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

export const HealthResponse = Type.Object({
  status: Type.String(),
  instanceId: Type.String(),
  uptimeSeconds: Type.Number(),
});

export const ReadyResponse = Type.Object({
  status: Type.String(),
  instanceId: Type.String(),
  checks: Type.Object({
    postgres: Type.String(),
    redis: Type.String(),
  }),
});
