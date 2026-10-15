import { approvalListQuerySchema, listApprovals } from '@mm/core';
import { ok, parseQuery, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

/** GET /api/v1/brands/:brandId/approvals?status=&type=&page= */
export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const query = parseQuery(req, approvalListQuerySchema);
  return ok(await listApprovals(ctx, query));
});
