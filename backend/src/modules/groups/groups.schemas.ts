import { Type, type Static } from '@sinclair/typebox';
import { Uuid, UserId } from '../../shared/schemas.js';

export const CreateGroupBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
});
export type CreateGroupBody = Static<typeof CreateGroupBody>;

export const GroupParams = Type.Object({ id: Uuid });

export const GroupResponse = Type.Object({
  id: Uuid,
  name: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  memberCount: Type.Integer(),
});

export const GroupListResponse = Type.Object({
  items: Type.Array(GroupResponse),
});

export const GroupMembersBody = Type.Object({
  userIds: Type.Optional(Type.Array(UserId, { minItems: 1, maxItems: 1000, uniqueItems: true })),
  removeUserIds: Type.Optional(
    Type.Array(UserId, { minItems: 1, maxItems: 1000, uniqueItems: true }),
  ),
});
export type GroupMembersBody = Static<typeof GroupMembersBody>;

export const GroupMembersResponse = Type.Object({
  added: Type.Integer(),
  removed: Type.Integer(),
  memberCount: Type.Integer(),
});
