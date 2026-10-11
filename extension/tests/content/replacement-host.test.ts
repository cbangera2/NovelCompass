// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';

import { ensureReplacementHost } from '../../src/content/replacement-host';

afterEach(() => {
  document.documentElement.removeAttribute('class');
  document.body.replaceChildren();
});

describe('ensureReplacementHost runtime preferences', () => {
  it('switches theme without remounting and restores the original page when disabled', () => {
    document.body.innerHTML = '<main id="native-content">Native Novel Updates</main>';
    const nativeContent = document.getElementById('native-content');
    const controller = ensureReplacementHost(document);
    const hostStyle = controller.host.shadowRoot?.querySelector('style')?.textContent ?? '';

    expect(hostStyle).toContain('@media (max-width: 900px)');
    expect(hostStyle).toMatch(
      /#novel-compass-view-toggle\s*\{[^}]*position:\s*static;/s,
    );

    controller.setTheme('light');
    controller.setRecoveryControlVisible(false);
    expect(
      controller.host.shadowRoot?.querySelector<HTMLButtonElement>('#novel-compass-view-toggle')
        ?.hidden,
    ).toBe(true);
    controller.setRecoveryControlVisible(true);
    controller.activate();
    expect(controller.host.dataset.theme).toBe('light');
    expect(controller.host.hidden).toBe(false);
    expect(document.documentElement.classList.contains('novel-compass-replacement-active')).toBe(
      true,
    );

    controller.setTheme('dark');
    expect(controller.host.dataset.theme).toBe('dark');

    controller.deactivate();
    expect(controller.host.hidden).toBe(true);
    expect(document.documentElement.classList.contains('novel-compass-replacement-active')).toBe(
      false,
    );
    expect(document.getElementById('native-content')).toBe(nativeContent);

    controller.showReplacement();
    expect(controller.host.hidden).toBe(false);
    expect(document.documentElement.classList.contains('novel-compass-replacement-active')).toBe(
      true,
    );
  });
});
