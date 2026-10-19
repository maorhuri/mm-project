'use server';

import { revalidatePath } from 'next/cache';
import {
  cancelPost,
  captionRequestSchema,
  createPosts,
  deletePost,
  fromJerusalemLocal,
  generateCaption,
  postSchema,
  postUpdateSchema,
  requestPostApproval,
  retryPost,
  updatePost,
} from '@mm/core';
import { optionalStr, runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireBrandContext } from '@/lib/brand';

function refresh() {
  revalidatePath('/app/calendar');
  revalidatePath('/app/approvals');
  revalidatePath('/app', 'layout');
}

export async function createPostAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = postSchema.parse({
      channels: formData.getAll('channels').map(String),
      caption: str(formData, 'caption'),
      mediaId: optionalStr(formData, 'mediaId'),
      sourceType: optionalStr(formData, 'sourceType'),
      sourceId: optionalStr(formData, 'sourceId'),
      scheduledAt: str(formData, 'scheduledAt'),
    });
    const posts = await createPosts(ctx, { ...input, mediaId: input.mediaId ?? null, scheduledAt: fromJerusalemLocal(input.scheduledAt) });
    const send = formData.get('intent') === 'approve';
    if (send) for (const p of posts) await requestPostApproval(ctx, p.id);
    refresh();
    return { message: send ? `${posts.length} פוסטים נשלחו לאישור — יתפרסמו אוטומטית במועד אחרי האישור` : `${posts.length} פוסטים נשמרו כטיוטה` };
  }, formData, prev);
}

export async function updatePostAction(postId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = postUpdateSchema.parse({ caption: str(formData, 'caption'), mediaId: optionalStr(formData, 'mediaId'), scheduledAt: str(formData, 'scheduledAt') });
    const post = await updatePost(ctx, postId, { caption: input.caption, mediaId: input.mediaId ?? null, scheduledAt: fromJerusalemLocal(input.scheduledAt) });
    refresh();
    return { message: post.status === 'DRAFT' ? 'נשמר — התוכן השתנה ולכן נדרש אישור מחדש' : 'נשמר' };
  }, formData, prev);
}

export async function captionAction(channel: string, brief: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = captionRequestSchema.parse({ channel, brief });
    const res = await generateCaption(ctx, input);
    return { message: res.qa.status === 'BLOCKED' ? 'נוצר כיתוב — בקרת האיכות מצאה בעיה, בדקו לפני שליחה' : 'הכיתוב נוצר', data: res };
  });
}

export async function postCommandAction(postId: string, command: 'approve' | 'cancel' | 'retry' | 'delete'): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    if (command === 'approve') await requestPostApproval(ctx, postId);
    else if (command === 'cancel') await cancelPost(ctx, postId);
    else if (command === 'retry') await retryPost(ctx, postId);
    else await deletePost(ctx, postId);
    refresh();
    return { message: { approve: 'נשלח לאישור', cancel: 'הפוסט בוטל', retry: 'הפוסט יפורסם בדקה הקרובה', delete: 'נמחק' }[command] };
  });
}
