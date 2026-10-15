import { deleteKnowledge, knowledgeSchema, updateKnowledge } from '@mm/core';
import { noContent, ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string; knowledgeId: string };

export const PATCH = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const input = await parseJson(req, knowledgeSchema);
  return ok(await updateKnowledge(ctx, params.knowledgeId, input));
});

export const DELETE = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  await deleteKnowledge(ctx, params.knowledgeId);
  return noContent();
});
