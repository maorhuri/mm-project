import { z } from 'zod';
import { createKnowledge, knowledgeSchema, listKnowledge } from '@mm/core';
import { ok, parseJson, parseQuery, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

const listQuery = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() });
const createBody = knowledgeSchema.extend({ approveNow: z.boolean().optional() });

/** GET /api/v1/brands/:brandId/knowledge?status= */
export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const { status } = parseQuery(req, listQuery);
  return ok(await listKnowledge(ctx, status));
});

/** POST — new entry; PENDING unless a BRAND_ADMIN passes approveNow. */
export const POST = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const { approveNow, ...input } = await parseJson(req, createBody);
  return ok(await createKnowledge(ctx, input, { approveNow }), { status: 201 });
});
