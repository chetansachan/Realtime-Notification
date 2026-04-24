import { Type, type Static } from '@sinclair/typebox';
import { CategoryKey, NotificationDto, Seq, UserId } from '../../shared/schemas.js';

export const InboxQuery = Type.Object({
  before: Type.Optional(Seq),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
  unread: Type.Optional(Type.Boolean({ default: false })),
  category: Type.Optional(CategoryKey),
});
export type InboxQuery = Static<typeof InboxQuery>;

export const InboxResponse = Type.Object({
  items: Type.Array(NotificationDto),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  unreadCount: Type.Integer(),
});

export const UnreadCountResponse = Type.Object({
  unreadCount: Type.Integer(),
});

export const ReadResponse = Type.Object({
  id: Type.String(),
  changed: Type.Boolean(),
  unreadCount: Type.Integer(),
});

export const ReadAllBody = Type.Object({
  upToSeq: Type.Optional(Seq),
  category: Type.Optional(CategoryKey),
});
export type ReadAllBody = Static<typeof ReadAllBody>;

export const ReadAllResponse = Type.Object({
  updated: Type.Integer(),
  unreadCount: Type.Integer(),
});

export const AckResponse = Type.Object({
  id: Type.String(),
  status: Type.String(),
});

export const NotificationIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const SubscriberIdentity = Type.Object({
  appId: Type.String(),
  userId: UserId,
});
