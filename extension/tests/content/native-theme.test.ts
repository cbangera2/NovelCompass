// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installNativeTheme,
  NATIVE_THEME_CLASS,
  NATIVE_THEME_HOST_ID,
  NATIVE_THEME_STYLE_ID,
} from '../../src/content/native-theme';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('class');
  document.documentElement.removeAttribute('style');
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('installNativeTheme', () => {
  it('preserves host node and form identity while toggling the scoped theme', () => {
    document.documentElement.className = 'nu-existing';
    document.documentElement.style.setProperty('--nu-setting', 'kept');
    document.body.innerHTML = `
      <header class="l-header">Novel Updates</header>
      <main id="native-content">
        <form action="/account/" method="post">
          <input name="_wpnonce" value="fixture-nonce">
          <button type="submit">Save</button>
        </form>
      </main>
    `;
    const main = document.getElementById('native-content');
    const form = document.querySelector('form');
    const nonce = document.querySelector<HTMLInputElement>('input[name="_wpnonce"]');

    const controller = installNativeTheme(document, 'html.novel-compass-native-theme{color:red}');
    controller.activate();

    expect(document.getElementById('native-content')).toBe(main);
    expect(document.querySelector('form')).toBe(form);
    expect(document.querySelector('input[name="_wpnonce"]')).toBe(nonce);
    expect(nonce?.value).toBe('fixture-nonce');
    expect(document.documentElement.classList.contains(NATIVE_THEME_CLASS)).toBe(true);
    expect(document.documentElement.classList.contains('nu-existing')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--nu-setting')).toBe('kept');

    const style = document.getElementById(NATIVE_THEME_STYLE_ID) as HTMLStyleElement;
    const toggle = controller.host.shadowRoot?.querySelector<HTMLButtonElement>('button');
    const navigation = controller.host.shadowRoot?.querySelector('aside');
    expect(navigation?.textContent).toContain('Discover');
    expect(navigation?.textContent).toContain('Reading list');
    expect(navigation?.textContent).toContain('Account');
    expect(style.disabled).toBe(false);
    toggle?.click();

    expect(document.documentElement.className).toBe('nu-existing');
    expect(document.documentElement.hasAttribute('data-novel-compass-extension')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--nu-setting')).toBe('kept');
    expect(style.disabled).toBe(true);
    expect(document.getElementById('native-content')).toBe(main);
    expect(document.querySelector('form')).toBe(form);
    expect(document.getElementById(NATIVE_THEME_HOST_ID)).toBe(controller.host);
    expect(toggle?.textContent).toBe('Use Novel Compass theme');

    toggle?.click();
    expect(document.documentElement.classList.contains(NATIVE_THEME_CLASS)).toBe(true);
  });

  it('fails open and leaves the native page usable', () => {
    document.body.innerHTML =
      '<main id="native-content"><form><button>Submit</button></form></main>';
    const originalMain = document.getElementById('native-content');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = installNativeTheme(document, 'html.novel-compass-native-theme{}');
    controller.activate();
    controller.fail(new Error('fixture failure'));

    expect(document.documentElement.classList.contains(NATIVE_THEME_CLASS)).toBe(false);
    expect((document.getElementById(NATIVE_THEME_STYLE_ID) as HTMLStyleElement).disabled).toBe(
      true,
    );
    expect(controller.host.hidden).toBe(true);
    expect(document.getElementById('native-content')).toBe(originalMain);
    expect(document.querySelector('button')?.textContent).toBe('Submit');
    expect(errorSpy).toHaveBeenCalled();
  });
});
