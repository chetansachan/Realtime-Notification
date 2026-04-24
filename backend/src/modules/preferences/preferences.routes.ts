import type { AppServer } from '../../types/app.js';
import { Type } from '@sinclair/typebox';
import { CategoryKey, ErrorResponse } from '../../shared/schemas.js';
import { notFound } from '../../shared/errors.js';
import {
  getCategory,
  listCategories,
  listPreferences,
  upsertPreference,
} from './preferences.repository.js';
import {
  CategoryResponse,
  PreferencesResponse,
  PutPreferencesBody,
} from './preferences.schemas.js';

export default async function preferencesRoutes(app: AppServer) {
  app.get(
    '/v1/preferences',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['preferences'],
        response: { 200: PreferencesResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      const { appId, userId } = req.subscriber!;
      return { items: await listPreferences(app.db, appId, userId) };
    },
  );

  app.put(
    '/v1/preferences',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['preferences'],
        body: PutPreferencesBody,
        response: { 200: PreferencesResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      const { appId, userId } = req.subscriber!;

      await app.withTransaction(async (trx) => {
        for (const preference of req.body.preferences) {
          await upsertPreference(trx, {
            appId,
            userId,
            category: preference.category,
            muted: preference.muted ?? false,
            channels: preference.channels ?? {},
          });
        }
      });

      return { items: await listPreferences(app.db, appId, userId) };
    },
  );

  app.get(
    '/v1/categories',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['preferences'],
        response: { 200: CategoryResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      const { appId } = req.subscriber!;
      const categories = await listCategories(app.db, appId);
      return {
        items: categories.map((category) => ({
          key: category.key,
          mandatory: category.mandatory,
          defaultChannels: category.default_channels,
        })),
      };
    },
  );

  app.get(
    '/v1/categories/:key',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['preferences'],
        params: Type.Object({ key: CategoryKey }),
        response: {
          200: Type.Object({
            key: Type.String(),
            mandatory: Type.Boolean(),
            defaultChannels: Type.Array(Type.String()),
          }),
          401: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req) => {
      const { appId } = req.subscriber!;
      const category = await getCategory(app.db, appId, req.params.key);
      if (!category) throw notFound('Category not found');
      return {
        key: category.key,
        mandatory: category.mandatory,
        defaultChannels: category.default_channels,
      };
    },
  );
}
