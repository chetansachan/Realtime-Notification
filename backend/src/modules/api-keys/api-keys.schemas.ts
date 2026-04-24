import { Type, type Static } from '@sinclair/typebox';
import { Uuid } from '../../shared/schemas.js';

export const CreateApiKeyBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  scopes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
    minItems: 1,
    uniqueItems: true,
  })),
});
export type CreateApiKeyBody = Static<typeof CreateApiKeyBody>;

export const ApiKeyResponse = Type.Object({
  id: Uuid,
  appId: Type.String(),
  name: Type.String(),
  keyPrefix: Type.String(),
  scopes: Type.Array(Type.String()),
  active: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
  lastUsedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

export const ApiKeyCreatedResponse = Type.Composite([
  ApiKeyResponse,
  Type.Object({ key: Type.String() }),
]);

export const ApiKeyListResponse = Type.Object({
  items: Type.Array(ApiKeyResponse),
});

export const ApiKeyParams = Type.Object({ id: Uuid });
