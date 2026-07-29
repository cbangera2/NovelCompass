import {
  createOriginalPageVisibility,
  REPLACEMENT_HOST_ID,
  type OriginalPageVisibility,
} from './page-visibility';

const HOST_MARKER = 'novelCompassHost';

export interface ReplacementHost {
  host: HTMLElement;
  productRoot: HTMLElement;
  activate(): void;
  fail(error?: unknown): void;
  showOriginal(): void;
  showReplacement(): void;
}

export function ensureReplacementHost(document: Document): ReplacementHost {
  const existing = document.getElementById(REPLACEMENT_HOST_ID);
  if (existing) {
    if (existing.dataset[HOST_MARKER] !== 'true') {
      throw new Error(`Page already contains #${REPLACEMENT_HOST_ID}.`);
    }

    const controller = hostControllers.get(existing);
    if (!controller) {
      throw new Error('Novel Compass host exists without its controller.');
    }
    return controller;
  }

  if (!document.body) {
    throw new Error('Novel Compass cannot mount before the document body exists.');
  }

  const host = document.createElement('div');
  host.id = REPLACEMENT_HOST_ID;
  host.dataset[HOST_MARKER] = 'true';
  host.dataset.state = 'mounting';
  host.dataset.view = 'original';
  host.hidden = true;

  const shadow = host.attachShadow({ mode: 'open' });
  const shell = createHostShell(document);
  shadow.append(shell.fragment);
  document.body.append(host);

  const visibility = createOriginalPageVisibility(document, host);
  const controller = createController(host, shell.productRoot, shell.toggle, visibility);
  hostControllers.set(host, controller);
  return controller;
}

const hostControllers = new WeakMap<HTMLElement, ReplacementHost>();

function createController(
  host: HTMLElement,
  productRoot: HTMLElement,
  toggle: HTMLButtonElement,
  visibility: OriginalPageVisibility,
): ReplacementHost {
  const syncToggle = () => {
    const replacementVisible = visibility.isReplacementVisible();
    toggle.textContent = replacementVisible ? 'Use original Novel Updates' : 'Use Novel Compass';
    toggle.setAttribute('aria-pressed', String(replacementVisible));
    productRoot.hidden = !replacementVisible;
  };

  const showOriginal = () => {
    visibility.showOriginal();
    syncToggle();
  };
  const showReplacement = () => {
    host.hidden = false;
    visibility.showReplacement();
    syncToggle();
  };

  toggle.addEventListener('click', () => {
    if (visibility.isReplacementVisible()) {
      showOriginal();
    } else {
      showReplacement();
    }
  });

  return {
    host,
    productRoot,
    activate: () => {
      host.dataset.state = 'ready';
      showReplacement();
    },
    fail: (error?: unknown) => {
      console.error('Novel Compass restored the original page after a fatal error.', error);
      visibility.restoreAfterFailure();
      productRoot.replaceChildren();
    },
    showOriginal,
    showReplacement,
  };
}

function createHostShell(document: Document): {
  fragment: DocumentFragment;
  productRoot: HTMLElement;
  toggle: HTMLButtonElement;
} {
  const fragment = document.createDocumentFragment();
  const style = document.createElement('style');
  style.textContent = `
    :host {
      color-scheme: light dark;
      display: block;
    }

    :host([data-view='replacement']) {
      min-height: 100vh;
    }

    :host([hidden]) {
      display: none !important;
    }

    #novel-compass-product-root[hidden] {
      display: none;
    }

    #novel-compass-view-toggle {
      position: fixed;
      z-index: 2147483647;
      right: 1rem;
      bottom: 1rem;
      padding: 0.65rem 0.9rem;
      border: 1px solid #64748b;
      border-radius: 999px;
      color: #f8fafc;
      background: #0f172a;
      box-shadow: 0 0.4rem 1.2rem rgb(15 23 42 / 30%);
      font: 600 0.875rem/1.2 system-ui, sans-serif;
      cursor: pointer;
    }

    #novel-compass-view-toggle:focus-visible {
      outline: 3px solid #38bdf8;
      outline-offset: 3px;
    }
  `;

  const productRoot = document.createElement('main');
  productRoot.id = 'novel-compass-product-root';
  productRoot.hidden = true;

  const toggle = document.createElement('button');
  toggle.id = 'novel-compass-view-toggle';
  toggle.type = 'button';
  toggle.textContent = 'Use Novel Compass';
  toggle.setAttribute('aria-pressed', 'false');

  fragment.append(style, productRoot, toggle);
  return { fragment, productRoot, toggle };
}
