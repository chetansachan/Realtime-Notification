import type { AppServer } from '../../types/app.js';
import { Type } from '@sinclair/typebox';
import { ErrorResponse } from '../../shared/schemas.js';
import { badRequest, notFound } from '../../shared/errors.js';
import {
  CreateGroupBody,
  GroupListResponse,
  GroupMembersBody,
  GroupMembersResponse,
  GroupParams,
  GroupResponse,
} from './groups.schemas.js';
import {
  addGroupMembers,
  countGroupMembers,
  createGroup,
  deleteGroup,
  findGroup,
  listGroups,
  removeGroupMembers,
} from './groups.repository.js';

function toResponse(group: { id: string; name: string; created_at: Date }, memberCount: number) {
  return {
    id: group.id,
    name: group.name,
    createdAt: group.created_at.toISOString(),
    memberCount,
  };
}

export default async function groupsRoutes(app: AppServer) {
  app.post(
    '/v1/groups',
    {
      onRequest: app.requireApiKey('groups:write'),
      schema: {
        tags: ['groups'],
        body: CreateGroupBody,
        response: { 201: GroupResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      const appId = req.apiClient!.appId;
      const group = await createGroup(app.db, appId, req.body.name);
      return reply.status(201).send(toResponse(group, 0));
    },
  );

  app.get(
    '/v1/groups',
    {
      onRequest: app.requireApiKey('groups:read'),
      schema: {
        tags: ['groups'],
        response: { 200: GroupListResponse },
      },
    },
    async (req) => {
      const appId = req.apiClient!.appId;
      const groups = await listGroups(app.db, appId);
      return {
        items: groups.map((group) => toResponse(group, Number(group.member_count))),
      };
    },
  );

  app.get(
    '/v1/groups/:id',
    {
      onRequest: app.requireApiKey('groups:read'),
      schema: {
        tags: ['groups'],
        params: GroupParams,
        response: { 200: GroupResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      const appId = req.apiClient!.appId;
      const group = await findGroup(app.db, appId, req.params.id);
      if (!group) throw notFound('Group not found');
      return toResponse(group, await countGroupMembers(app.db, group.id));
    },
  );

  app.put(
    '/v1/groups/:id/members',
    {
      onRequest: app.requireApiKey('groups:write'),
      schema: {
        tags: ['groups'],
        params: GroupParams,
        body: GroupMembersBody,
        response: { 200: GroupMembersResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      const appId = req.apiClient!.appId;
      const { userIds = [], removeUserIds = [] } = req.body;
      if (userIds.length === 0 && removeUserIds.length === 0) {
        throw badRequest('Provide "userIds" and/or "removeUserIds"');
      }

      return app.withTransaction(async (trx) => {
        const group = await findGroup(trx, appId, req.params.id);
        if (!group) throw notFound('Group not found');

        const added = await addGroupMembers(trx, group.id, [...new Set(userIds)]);
        const removed = await removeGroupMembers(trx, group.id, [...new Set(removeUserIds)]);
        return {
          added,
          removed,
          memberCount: await countGroupMembers(trx, group.id),
        };
      });
    },
  );

  app.delete(
    '/v1/groups/:id',
    {
      onRequest: app.requireApiKey('groups:write'),
      schema: {
        tags: ['groups'],
        params: GroupParams,
        response: { 204: Type.Null(), 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const appId = req.apiClient!.appId;
      const deleted = await deleteGroup(app.db, appId, req.params.id);
      if (!deleted) throw notFound('Group not found');
      return reply.status(204).send(null);
    },
  );
}
