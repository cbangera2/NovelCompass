export const REPLACEMENT_ACTIVE_CLASS = 'novel-compass-replacement-active';
export const REPLACEMENT_HOST_ID = 'novel-compass-extension-root';

const VISIBILITY_STYLE_ID = 'novel-compass-page-visibility';

export interface OriginalPageVisibility {
  isReplacementVisible(): boolean;
  showOriginal(): void;
  showReplacement(): void;
  restoreAfterFailure(): void;
}

export function createOriginalPageVisibility(
  document: Document,
  host: HTMLElement,
): OriginalPageVisibility {
  if (host.id !== REPLACEMENT_HOST_ID) {
    throw new Error('Novel Compass visibility requires the registered extension host.');
  }

  ensureVisibilityStyle(document);

  const showOriginal = () => {
    document.documentElement.classList.remove(REPLACEMENT_ACTIVE_CLASS);
    host.dataset.view = 'original';
  };

  return {
    isReplacementVisible: () =>
      document.documentElement.classList.contains(REPLACEMENT_ACTIVE_CLASS),
    showOriginal,
    showReplacement: () => {
      host.dataset.view = 'replacement';
      document.documentElement.classList.add(REPLACEMENT_ACTIVE_CLASS);
    },
    restoreAfterFailure: () => {
      showOriginal();
      host.dataset.state = 'failed';
      host.hidden = true;
    },
  };
}

function ensureVisibilityStyle(document: Document): void {
  if (document.getElementById(VISIBILITY_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = VISIBILITY_STYLE_ID;
  style.textContent = `
    html.${REPLACEMENT_ACTIVE_CLASS} body > :not(#${REPLACEMENT_HOST_ID}) {
      display: none !important;
    }
  `;
  (document.head ?? document.documentElement).append(style);
}
