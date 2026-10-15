import { describe, expect, it } from 'vitest';
import { scopeArgs } from '@mm/db';

const B1 = '11111111-1111-7111-8111-111111111111';
const B2 = '22222222-2222-7222-8222-222222222222';

describe('scopeArgs (pure tenant rewriting)', () => {
  it('adds brandId to reads', () => {
    expect(scopeArgs('MediaAsset', 'findMany', { where: { kind: 'IMAGE' } }, B1)).toEqual({
      where: { kind: 'IMAGE', brandId: B1 },
    });
    expect(scopeArgs('MediaAsset', 'count', undefined, B1)).toEqual({ where: { brandId: B1 } });
  });

  it('overrides a caller-supplied brandId instead of widening the scope', () => {
    const out = scopeArgs('Approval', 'findMany', { where: { brandId: B2 } }, B1);
    expect(out.where).toEqual({ brandId: B1 });
  });

  it('stamps creates and strips brandId from updates', () => {
    expect(scopeArgs('BrandProduct', 'create', { data: { name: 'x', brandId: B2 } }, B1)).toEqual({
      data: { name: 'x', brandId: B1 },
    });
    expect(
      scopeArgs('BrandProduct', 'createMany', { data: [{ name: 'a' }, { name: 'b', brandId: B2 }] }, B1),
    ).toEqual({ data: [{ name: 'a', brandId: B1 }, { name: 'b', brandId: B1 }] });
    expect(
      scopeArgs('BrandProduct', 'update', { where: { id: 'p1' }, data: { name: 'y', brandId: B2 } }, B1),
    ).toEqual({ where: { id: 'p1', brandId: B1 }, data: { name: 'y' } });
  });

  it('scopes the Brand model by id', () => {
    expect(scopeArgs('Brand', 'findUnique', { where: { id: B2 } }, B1)).toEqual({
      where: { id: B1 },
    });
    expect(scopeArgs('Brand', 'update', { where: { id: B2 }, data: { name: 'n' } }, B1)).toEqual({
      where: { id: B1 },
      data: { name: 'n' },
    });
  });

  it('leaves non-tenant models alone', () => {
    expect(scopeArgs('User', 'findMany', { where: { email: 'a' } }, B1)).toEqual({
      where: { email: 'a' },
    });
  });

  it('rejects unsupported operations on tenant models', () => {
    expect(() => scopeArgs('MediaAsset', 'weirdOp', {}, B1)).toThrow();
  });
});
