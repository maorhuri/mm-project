import { approvalDecisionSchema, decideApproval } from '@mm/core';
import { ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string; approvalId: string };

/** POST /api/v1/brands/:brandId/approvals/:approvalId/decision — { decision, note? } (BRAND_ADMIN). */
export const POST = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const input = await parseJson(req, approvalDecisionSchema);
  return ok(await decideApproval(ctx, params.approvalId, input));
});
