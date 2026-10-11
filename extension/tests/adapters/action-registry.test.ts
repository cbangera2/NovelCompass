import { describe, expect, it, vi } from 'vitest';

import { OpaqueActionRegistry } from '../../src/adapters/action-registry';

describe('OpaqueActionRegistry', () => {
  it('normalizes only HTTPS navigation actions', () => {
    const registry = new OpaqueActionRegistry();
    const generation = registry.beginGeneration('releases');
    const actionId = generation.registerNavigation(
      '/extnu/42/',
      'https://www.novelupdates.com/series/example/',
    );

    expect(actionId).toBeTypeOf('string');
    expect(registry.invoke(actionId!)).toEqual({
      kind: 'navigate',
      url: 'https://www.novelupdates.com/extnu/42/',
    });
    expect(
      generation.registerNavigation('javascript:alert(1)', 'https://www.novelupdates.com/'),
    ).toBeUndefined();
    expect(generation.registerNavigation('http://www.novelupdates.com/extnu/42/')).toBeUndefined();
  });

  it('delegates connected elements without exposing them through the action ID', () => {
    const registry = new OpaqueActionRegistry();
    const click = vi.fn();
    const element = { click, isConnected: true } as unknown as HTMLElement;
    const actionId = registry.beginGeneration('releases').registerElement(element);

    expect(actionId).toMatch(/^releases:1:\d+$/);
    expect(registry.invoke(actionId)).toEqual({ kind: 'delegated' });
    expect(click).toHaveBeenCalledOnce();
  });

  it('fails closed for detached elements and stale generations', () => {
    const registry = new OpaqueActionRegistry();
    const oldElement = { click: vi.fn(), isConnected: true } as unknown as HTMLElement;
    const detachedElement = { click: vi.fn(), isConnected: false } as unknown as HTMLElement;
    const first = registry.beginGeneration('releases');
    const staleId = first.registerElement(oldElement);
    const detachedId = first.registerElement(detachedElement);

    expect(registry.invoke(detachedId)).toEqual({ kind: 'unavailable' });
    registry.beginGeneration('releases');
    expect(registry.invoke(staleId)).toEqual({ kind: 'unavailable' });
    expect(oldElement.click).not.toHaveBeenCalled();
  });

  it('invalidates one namespace without disturbing another adapter', () => {
    const registry = new OpaqueActionRegistry();
    const releaseId = registry
      .beginGeneration('releases')
      .registerNavigation('https://www.novelupdates.com/extnu/1/');
    const reviewId = registry
      .beginGeneration('reviews')
      .registerNavigation('https://www.novelupdates.com/review/1/');

    registry.invalidate('releases');

    expect(registry.invoke(releaseId!)).toEqual({ kind: 'unavailable' });
    expect(registry.invoke(reviewId!)).toEqual({
      kind: 'navigate',
      url: 'https://www.novelupdates.com/review/1/',
    });
  });
});
