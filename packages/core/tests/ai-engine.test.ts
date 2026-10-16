import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@mm/db';
import { setAdapterOverridesForTests } from '../src/ai/adapters';
import { extractJson, getAiUsage, probeProvider, runImage, runText, runTts } from '../src/ai/engine';
import { AiApprovalRequiredError, AiBudgetExceededError, AiPausedError, AiProviderError } from '../src/ai/types';
import type { TextAdapter, TextRequest, TextResult } from '../src/ai/types';
import { getConfig, resetConfigCache } from '../src/config';
import { ForbiddenError } from '../src/errors';
import { decideApproval, listApprovals } from '../src/services/approvals';
import { saveProviderCredentials } from '../src/services/provider-credentials';
import { ctxFor, grantBrand, makeUser, twoBrandFixture } from './helpers';

function withEnv(overrides: Record<string, string>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  resetConfigCache();
  return () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfigCache();
  };
}

class FakeTextAdapter implements TextAdapter {
  readonly provider = 'openai' as const;
  readonly isMock = false;
  calls = 0;
  constructor(private readonly behaviour: (call: number, req: TextRequest) => TextResult) {}
  async generate(modelId: string, req: TextRequest): Promise<TextResult> {
    this.calls += 1;
    return { ...this.behaviour(this.calls, req), modelId };
  }
}

const ok = (text: string): TextResult => ({ text, usage: { inputTokens: 1000, outputTokens: 500 }, modelId: 'x', latencyMs: 3 });

describe('AI engine — ledger and mock mode', () => {
  afterEach(() => {
    setAdapterOverridesForTests(null);
    resetConfigCache();
  });

  it('records every mock run in the ledger at zero cost and reports usage', async () => {
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const result = await runText(ctx, { task: 'CREATIVE_COPY', system: 'sys', prompt: 'כתוב כותרת', json: true });
    expect(result.isMock).toBe(true);
    expect(result.text).toContain('[MOCK]');
    expect(result.json).toMatchObject({ mock: true });
    expect(result.run.status).toBe('SUCCEEDED');
    expect(Number(result.run.costIls)).toBe(0);
    expect(result.run.promptHash).toHaveLength(16);

    const image = await runImage(ctx, { prompt: 'רקע', width: 256, height: 256, quality: 'low' });
    expect(image.images[0]?.data.subarray(1, 4).toString()).toBe('PNG');
    const tts = await runTts(ctx, { text: 'שלום' });
    expect(tts.mimeType).toBe('audio/wav');

    const usage = await getAiUsage(ctx);
    expect(usage.runs).toBe(3);
    expect(usage.spentIls).toBe(0);
    expect(usage.capIls).toBe(getConfig().AI_MONTHLY_BUDGET_ILS);
    expect(Object.keys(usage.byTask).sort()).toEqual(['CREATIVE_BACKGROUND', 'CREATIVE_COPY', 'TTS']);
  });

  it('viewers cannot run AI tasks', async () => {
    const { owner, org, brandA } = await twoBrandFixture();
    const viewer = await makeUser();
    await db.membership.create({ data: { orgId: org.id, userId: viewer.userId, role: 'MEMBER' } });
    await grantBrand(brandA.id, viewer, 'VIEWER');
    void owner;
    const ctx = await ctxFor(viewer, brandA.id);
    await expect(runText(ctx, { task: 'OTHER', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses when the engine is paused', async () => {
    const restore = withEnv({ AI_ENABLED: 'false' });
    try {
      const { owner, brandA } = await twoBrandFixture();
      const ctx = await ctxFor(owner, brandA.id);
      await expect(runText(ctx, { task: 'OTHER', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(AiPausedError);
    } finally {
      restore();
    }
  });
});

describe('AI engine — real-provider gates (fake adapter behind a saved key)', () => {
  afterEach(() => {
    setAdapterOverridesForTests(null);
    resetConfigCache();
  });

  async function fixtureWithKey() {
    const { owner, editor, org, brandA, brandB } = await twoBrandFixture();
    await saveProviderCredentials(owner, org.id, 'openai', { apiKey: 'sk-test-not-a-real-key' });
    return { owner, editor, org, brandA, brandB };
  }

  it('computes cost from returned usage, settles the ledger and isolates usage per brand', async () => {
    const { owner, brandA, brandB } = await fixtureWithKey();
    setAdapterOverridesForTests({ text: new FakeTextAdapter(() => ok('{"ideas":[]}')) });
    const ctx = await ctxFor(owner, brandA.id);
    const result = await runText(ctx, { task: 'CREATIVE_IDEAS', system: 's', prompt: 'p', json: true });
    expect(result.isMock).toBe(false);
    expect(result.run.status).toBe('SUCCEEDED');
    expect(result.run.estimated).toBe(false);
    expect(result.run.inputTokens).toBe(1000);
    expect(Number(result.run.costIls)).toBeGreaterThan(0);
    const usageA = await getAiUsage(ctx);
    expect(usageA.runs).toBe(1);
    expect(usageA.spentIls).toBeCloseTo(Number(result.run.costIls), 4);
    const usageB = await getAiUsage(await ctxFor(owner, brandB.id));
    expect(usageB.runs).toBe(0);
  });

  it('blocks a run that would exceed the monthly cap and records a BLOCKED row', async () => {
    const restore = withEnv({ AI_MONTHLY_BUDGET_ILS: '0.0001' });
    try {
      const { owner, brandA } = await fixtureWithKey();
      const adapter = new FakeTextAdapter(() => ok('x'));
      setAdapterOverridesForTests({ text: adapter });
      const ctx = await ctxFor(owner, brandA.id);
      await expect(runText(ctx, { task: 'OTHER', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(AiBudgetExceededError);
      expect(adapter.calls).toBe(0);
      const blocked = await ctx.db.aiRun.findMany({ where: { status: 'BLOCKED' } });
      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.error).toBe('budget_exceeded');
    } finally {
      restore();
    }
  });

  it('requires an approval above the single-run cap and runs once it is approved', async () => {
    const restore = withEnv({ AI_SINGLE_RUN_MAX_ILS: '0' });
    try {
      const { owner, brandA } = await fixtureWithKey();
      const adapter = new FakeTextAdapter(() => ok('done'));
      setAdapterOverridesForTests({ text: adapter });
      const ctx = await ctxFor(owner, brandA.id);
      let approvalId = '';
      try {
        await runText(ctx, { task: 'STRATEGY_BRIEF', label: 'בריף', system: 's', prompt: 'p' });
        throw new Error('expected approval gate');
      } catch (err) {
        expect(err).toBeInstanceOf(AiApprovalRequiredError);
        approvalId = (err as AiApprovalRequiredError).approvalId;
      }
      expect(adapter.calls).toBe(0);
      const pending = await listApprovals(ctx, { status: 'PENDING', page: 1, pageSize: 10 });
      expect(pending.items.map((a) => a.id)).toContain(approvalId);
      expect(pending.items[0]?.type).toBe('AI_HIGH_COST');

      // Still refused while pending, even when the id is supplied.
      await expect(runText(ctx, { task: 'STRATEGY_BRIEF', system: 's', prompt: 'p', approvalId })).rejects.toBeInstanceOf(AiApprovalRequiredError);

      await decideApproval(ctx, approvalId, { decision: 'APPROVED' });
      const result = await runText(ctx, { task: 'STRATEGY_BRIEF', system: 's', prompt: 'p', approvalId });
      expect(result.text).toBe('done');
      expect(result.run.approvalId).toBe(approvalId);
      const approval = await ctx.db.approval.findUnique({ where: { id: approvalId } });
      expect(approval?.status).toBe('EXECUTED');
    } finally {
      restore();
    }
  });

  it('falls back to the next candidate model when a provider call fails, and records a FAILED run when all fail', async () => {
    const { owner, brandA } = await fixtureWithKey();
    const flaky = new FakeTextAdapter((call) => {
      if (call === 1) throw new AiProviderError('openai', 'rate limited', { status: 429, retryable: true });
      return ok('second');
    });
    setAdapterOverridesForTests({ text: flaky });
    const ctx = await ctxFor(owner, brandA.id);
    const result = await runText(ctx, { task: 'OTHER', system: 's', prompt: 'p' });
    expect(result.text).toBe('second');
    expect(flaky.calls).toBe(2);

    const broken = new FakeTextAdapter(() => {
      throw new AiProviderError('openai', 'down', { status: 502, retryable: true });
    });
    setAdapterOverridesForTests({ text: broken });
    await expect(runText(ctx, { task: 'OTHER', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(AiProviderError);
    const failed = await ctx.db.aiRun.findMany({ where: { status: 'FAILED' } });
    expect(failed).toHaveLength(1);
    expect(Number(failed[0]?.costIls)).toBe(0);
  });

  it('repairs malformed JSON once, then gives up', async () => {
    const { owner, brandA } = await fixtureWithKey();
    const adapter = new FakeTextAdapter((call) => (call === 1 ? ok('```json\n{"a": 1,}\n```') : ok('{"a": 1}')));
    setAdapterOverridesForTests({ text: adapter });
    const ctx = await ctxFor(owner, brandA.id);
    const result = await runText(ctx, { task: 'OTHER', system: 's', prompt: 'p', json: true });
    expect(result.json).toEqual({ a: 1 });
    expect(adapter.calls).toBe(2);
    expect(result.run.inputTokens).toBe(2000);
  });

  it('probeProvider records a PROVIDER_PROBE run', async () => {
    const { owner, brandA } = await fixtureWithKey();
    setAdapterOverridesForTests({ text: new FakeTextAdapter(() => ok('מחובר')) });
    const ctx = await ctxFor(owner, brandA.id);
    const result = await probeProvider(ctx, 'openai');
    expect(result.run.task).toBe('PROVIDER_PROBE');
    expect(result.text).toBe('מחובר');
  });
});

describe('extractJson', () => {
  it('tolerates fences and prose around a JSON object', () => {
    expect(extractJson('Sure:\n```json\n{"a":[1,2]}\n```\nDone')).toEqual({ a: [1, 2] });
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
    expect(extractJson('not json')).toBeNull();
  });
});
