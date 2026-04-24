import { Type, type Static } from '@sinclair/typebox';
import { Uuid } from '../../shared/schemas.js';

export const WebhookParams = Type.Object({ id: Uuid });

export const CreateWebhookBody = Type.Object({
  url: Type.String({ minLength: 8, maxLength: 2048 }),
});
export type CreateWebhookBody = Static<typeof CreateWebhookBody>;

export const UpdateWebhookBody = Type.Object({
  url: Type.Optional(Type.String({ minLength: 8, maxLength: 2048 })),
  active: Type.Optional(Type.Boolean()),
});
export type UpdateWebhookBody = Static<typeof UpdateWebhookBody>;

export const WebhookResponse = Type.Object({
  id: Uuid,
  url: Type.String(),
  active: Type.Boolean(),
  failureCount: Type.Integer(),
  disabledAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

export const WebhookCreatedResponse = Type.Composite([
  WebhookResponse,
  Type.Object({ secret: Type.String() }),
]);

export const WebhookListResponse = Type.Object({
  items: Type.Array(WebhookResponse),
});
