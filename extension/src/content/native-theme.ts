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
  const sidebar = document.createElement('aside');
  sidebar.setAttribute('aria-label', 'Novel Compass navigation');
  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = '/';
  brand.textContent = 'Novel Compass';
  const tagline = document.createElement('span');
  tagline.className = 'tagline';
  tagline.textContent = 'Novel Updates, reimagined';
  const primaryNav = createNavigation(document, 'Explore', [
    ['Home', '/'],
    ['Discover', '/series-finder/'],
    ['Rankings', '/series-ranking/'],
    ['Recommendation lists', '/recommendation-lists/'],
    ['Latest series', '/latest-series/'],
  ]);
  const libraryNav = createNavigation(document, 'Your library', [
    ['Reading list', '/reading-list/'],
    ['Following', '/following/'],
    ['Profile', '/your-profile/'],
    ['Account', '/account/'],
  ]);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Use Novel Compass theme';
  button.className = 'view-toggle';
  const chromeStyle = document.createElement('style');
  chromeStyle.textContent = `
    :host { position: fixed; z-index: 2147483647; inset: 0 auto 0 0; pointer-events: none; }
    :host([hidden]) { display: none !important; }
    aside {
      box-sizing: border-box; display: flex; flex-direction: column; gap: 1.35rem;
      width: 236px; height: 100vh; overflow-y: auto; padding: 1.5rem 1rem 1rem;
      background: #0d1018; border-right: 1px solid rgb(255 255 255 / 9%);
      box-shadow: .8rem 0 2.5rem rgb(0 0 0 / 18%); color: #f5f3ff;
      font-family: Inter, system-ui, sans-serif; pointer-events: auto;
    }
    a { color: inherit; text-decoration: none; }
    .brand { color: #fff; font-size: 1.1rem; font-weight: 800; letter-spacing: -.02em; }
    .brand::before {
      content: "N"; display: inline-grid; place-items: center; width: 2rem; height: 2rem;
      margin-right: .65rem; border-radius: .65rem; background: #6d5bd0; color: #fff;
    }
    .tagline { display: block; color: #817d8e; font-size: .72rem; margin: -.95rem 0 0 2.7rem; }
    .nav-label {
      color: #777383; font-size: .65rem; font-weight: 800; letter-spacing: .13em;
      margin: 0 0 .45rem .6rem; text-transform: uppercase;
    }
    nav { display: grid; gap: .25rem; }
    nav a {
      border-radius: .6rem; color: #bbb7c8; font-size: .84rem; font-weight: 600;
      padding: .58rem .65rem;
    }
    nav a:hover, nav a:focus-visible, nav a[aria-current="page"] {
      background: #1b1829; color: #d8d2ff; outline: none;
    }
    nav a[aria-current="page"] { box-shadow: inset 3px 0 #8d7ce8; }
    .view-toggle {
      border: 1px solid rgb(255 255 255 / 14%); border-radius: .65rem;
      background: #171b26; color: #d8d6e2; cursor: pointer; margin-top: auto;
      font: 600 .75rem/1.2 Inter, system-ui, sans-serif; padding: .65rem .7rem;
    }
    :host([data-view="original"]) { inset: auto 1rem 1rem auto; }
    :host([data-view="original"]) aside {
      width: auto; height: auto; overflow: visible; padding: 0; border: 0; background: transparent;
      box-shadow: none;
    }
    :host([data-view="original"]) aside > :not(.view-toggle) { display: none; }
    :host([data-view="original"]) .view-toggle {
      background: #15121f; border-radius: 999px; box-shadow: 0 .4rem 1.2rem rgb(0 0 0 / 35%);
      color: #f5f3ff; margin: 0; padding: .7rem .95rem;
    }
    :where(a, button):focus-visible { outline: 3px solid #b8a8ff; outline-offset: 2px; }
    @media (max-width: 800px) {
      :host { inset: 0 0 auto; }
      aside {
        align-items: center; flex-direction: row; gap: .6rem; height: 3.75rem; width: 100vw;
        overflow-x: auto; overflow-y: hidden; padding: .55rem .7rem;
        border-right: 0; border-bottom: 1px solid rgb(255 255 255 / 9%);
      }
      .brand { font-size: 0; flex: 0 0 auto; }
      .brand::before { font-size: 1rem; margin: 0; }
      .tagline, .nav-label { display: none; }
      nav { display: flex; }
      nav a { white-space: nowrap; }
      .view-toggle { flex: 0 0 auto; margin: 0 0 0 auto; white-space: nowrap; }
    }
  `;
  sidebar.append(brand, tagline, primaryNav, libraryNav, button);
  shadow.append(chromeStyle, sidebar);
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

function createNavigation(
  document: Document,
  label: string,
  links: ReadonlyArray<readonly [label: string, href: string]>,
): DocumentFragment {
  const group = document.createDocumentFragment();
  const heading = document.createElement('p');
  heading.className = 'nav-label';
  heading.textContent = label;
  const navigation = document.createElement('nav');
  navigation.setAttribute('aria-label', label);
  for (const [linkLabel, href] of links) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = linkLabel;
    if (isCurrentPath(document.location.pathname, href)) link.setAttribute('aria-current', 'page');
    navigation.append(link);
  }
  group.append(heading, navigation);
  return group;
}

function isCurrentPath(pathname: string, href: string): boolean {
  return pathname.replace(/\/+$/, '') === href.replace(/\/+$/, '');
}
