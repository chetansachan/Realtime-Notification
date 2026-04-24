import { Type, type Static } from '@sinclair/typebox';
import { CategoryKey } from '../../shared/schemas.js';

export const PreferenceItem = Type.Object({
  category: CategoryKey,
  muted: Type.Optional(Type.Boolean({ default: false })),
  channels: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
});
export type PreferenceItem = Static<typeof PreferenceItem>;

export const PreferencesResponse = Type.Object({
  items: Type.Array(
    Type.Object({
      category: Type.String(),
      muted: Type.Boolean(),
      channels: Type.Record(Type.String(), Type.Boolean()),
    }),
  ),
});

export const PutPreferencesBody = Type.Object({
  preferences: Type.Array(PreferenceItem, { minItems: 1, maxItems: 100 }),
});
export type PutPreferencesBody = Static<typeof PutPreferencesBody>;

export const CategoryResponse = Type.Object({
  items: Type.Array(
    Type.Object({
      key: Type.String(),
      mandatory: Type.Boolean(),
      defaultChannels: Type.Array(Type.String()),
    }),
  ),
});
