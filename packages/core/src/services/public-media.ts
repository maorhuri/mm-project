/**
 * Short-lived signed public links to a media file. Needed only where a platform
 * must fetch the file itself (Instagram images). The link carries brand, media,
 * expiry and an HMAC; nothing else about the media library is exposed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@mm/db';
import type { MediaAsset } from '@mm/db';
import { getConfig } from '../config';
import { getStorage } from '../storage';
import type { StoredObject } from '../storage';

function sign(brandId: string, mediaId: string, exp: number): string {
  return createHmac('sha256', `${getConfig().APP_SECRET}:public-media`).update(`${brandId}.${mediaId}.${exp}`).digest('base64url');
}

export function createPublicMediaUrl(media: Pick<MediaAsset, 'id' | 'brandId'>, ttlSec = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const base = getConfig().APP_URL.replace(/\/$/, '');
  return `${base}/api/v1/public/media/${media.id}?b=${media.brandId}&e=${exp}&s=${sign(media.brandId, media.id, exp)}`;
}

export function verifyPublicMediaLink(mediaId: string, brandId: string | null, exp: string | null, sig: string | null): boolean {
  if (!brandId || !exp || !sig) return false;
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(brandId, mediaId, e));
  const provided = Buffer.from(sig);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function openPublicMedia(mediaId: string, brandId: string): Promise<{ asset: MediaAsset; object: StoredObject } | null> {
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, brandId, deletedAt: null } });
  if (!asset) return null;
  const object = await getStorage().get(asset.storageKey);
  return object ? { asset, object } : null;
}
