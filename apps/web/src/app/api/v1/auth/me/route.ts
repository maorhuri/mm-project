import { listAccessibleBrands } from '@mm/core';
import { ok, requireApiUser, withApi } from '@/lib/api';

/** GET /api/v1/auth/me — current user and the brands they can access. */
export const GET = withApi(async (req) => {
  const { user, actor } = await requireApiUser(req);
  const brands = await listAccessibleBrands(actor);
  return ok({ user, brands });
});
