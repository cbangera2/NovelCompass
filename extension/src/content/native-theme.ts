export const NATIVE_THEME_CLASS = 'novel-compass-native-theme';
export const NATIVE_THEME_HOST_ID = 'novel-compass-native-theme-root';
export const NATIVE_THEME_STYLE_ID = 'novel-compass-native-theme-styles';

export interface NativeThemeController {
  host: HTMLElement;
  activate(): void;
  showOriginal(): void;
  showThemed(): void;
  fail(error?: unknown): void;
}

export function installNativeTheme(document: Document, css: string): NativeThemeController {
  if (!document.body) {
    throw new Error('Novel Compass cannot theme a page before its body exists.');
  }

  const existing = document.getElementById(NATIVE_THEME_HOST_ID);
  if (existing) {
    const controller = controllers.get(existing);
    if (!controller) throw new Error('Native theme host exists without its controller.');
    return controller;
  }

  const style = document.createElement('style');
  style.id = NATIVE_THEME_STYLE_ID;
  style.textContent = css;
  style.disabled = true;
  (document.head ?? document.documentElement).append(style);

  const host = document.createElement('div');
  host.id = NATIVE_THEME_HOST_ID;
  host.dataset.novelCompassHost = 'native-theme';
  const shadow = host.attachShadow({ mode: 'open' });
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Use Novel Compass theme';
  const chromeStyle = document.createElement('style');
  chromeStyle.textContent = `
    :host { position: fixed; z-index: 2147483647; right: 1rem; bottom: 1rem; }
    :host([hidden]) { display: none !important; }
    button {
      border: 1px solid rgb(255 255 255 / 16%); border-radius: 999px;
      background: #15121f; color: #f5f3ff; cursor: pointer;
      box-shadow: 0 .4rem 1.2rem rgb(0 0 0 / 35%);
      font: 600 .8125rem/1.2 Inter, system-ui, sans-serif; padding: .7rem .95rem;
    }
    button:focus-visible { outline: 3px solid #b8a8ff; outline-offset: 3px; }
  `;
  shadow.append(chromeStyle, button);
  document.body.append(host);

  const originalExtensionMarker = document.documentElement.dataset.novelCompassExtension;
  const setThemed = (themed: boolean) => {
    document.documentElement.classList.toggle(NATIVE_THEME_CLASS, themed);
    if (themed) {
      document.documentElement.dataset.novelCompassExtension = 'native-theme';
    } else if (originalExtensionMarker === undefined) {
      document.documentElement.removeAttribute('data-novel-compass-extension');
    } else {
      document.documentElement.dataset.novelCompassExtension = originalExtensionMarker;
    }
    style.disabled = !themed;
    host.dataset.view = themed ? 'themed' : 'original';
    button.textContent = themed ? 'Use original Novel Updates' : 'Use Novel Compass theme';
    button.setAttribute('aria-pressed', String(themed));
  };
  const controller: NativeThemeController = {
    host,
    activate: () => setThemed(true),
    showOriginal: () => setThemed(false),
    showThemed: () => setThemed(true),
    fail: (error?: unknown) => {
      console.error('Novel Compass restored the original page after a native-theme error.', error);
      setThemed(false);
      host.hidden = true;
    },
  };
  button.addEventListener('click', () => {
    setThemed(!document.documentElement.classList.contains(NATIVE_THEME_CLASS));
  });
  controllers.set(host, controller);
  return controller;
}

const controllers = new WeakMap<HTMLElement, NativeThemeController>();
