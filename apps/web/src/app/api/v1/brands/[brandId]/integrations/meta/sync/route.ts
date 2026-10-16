import { NextResponse } from 'next/server';
import { syncMetaAds } from '@mm/core';
import { requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

/** POST /api/v1/brands/:brandId/integrations/meta/sync — read-only sync now (campaigns, ad sets, ads, insights). */
export const POST = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30);
  const sync = await syncMetaAds(ctx, { days: Number.isFinite(days) ? days : 30 });
  return NextResponse.json({ data: sync });
});
