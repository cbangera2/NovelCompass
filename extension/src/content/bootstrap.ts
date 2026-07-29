import { Component, createElement, type ErrorInfo, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { OpaqueActionRegistry } from '../adapters/action-registry';
import { parseNovelUpdatesAccountState } from '../adapters/account';
import { parseCatalogPage } from '../adapters/catalog';
import { classifyNovelUpdatesDocument } from '../adapters/page-classifier';
import { parseRankingPage } from '../adapters/ranking';
import { parseRecommendationListsPage } from '../adapters/recommendation-lists';
import { parseReleasePage } from '../adapters/releases';
import { parseReviewPage } from '../adapters/reviews';
import { parseLiveSeriesMetadata } from '../adapters/series-page';
import { chromeLocalStorageArea, ExtensionStorageRepository } from '../storage';
import { SeriesRuntimeApp } from '../runtime/SeriesRuntimeApp';
import { ExtensionFinderApp } from '../ui/ExtensionFinderApp';
import { ExtensionCatalogApp } from '../ui/ExtensionCatalogApp';
import { ExtensionRankingApp } from '../ui/ExtensionRankingApp';
import { ExtensionRecommendationListsApp } from '../ui/ExtensionRecommendationListsApp';
import { ExtensionShell, type ExtensionRoute } from '../ui/ExtensionShell';
import { ensureReplacementHost } from './replacement-host';
import { resolveNovelUpdatesNavigation } from './navigation';
import { installNativeTheme } from './native-theme';
import { installReadingLibraryTheme } from './reading-library-theme';

const classification = classifyNovelUpdatesDocument(window.location.href, document);

if (classification.kind === 'supported') {
  void bootstrapReplacement();
} else if (
  classification.kind === 'blocked' &&
  classification.reason === 'replacement-not-implemented' &&
  classification.route?.policy !== 'pass-through'
) {
  void bootstrapNativeTheme();
}

async function bootstrapNativeTheme(): Promise<void> {
  let controller: ReturnType<typeof installNativeTheme> | undefined;
  try {
    const preferences = await new ExtensionStorageRepository(
      chromeLocalStorageArea(),
    ).loadPreferences();
    if (!preferences.value.extensionEnabled) return;
    const response = await fetch(chrome.runtime.getURL('content/native-theme.css'));
    if (!response.ok) throw new Error(`Native theme styles failed to load (${response.status}).`);
    controller = installNativeTheme(document, await response.text());
    if (
      classification.kind === 'blocked' &&
      classification.route?.family === 'reading-library'
    ) {
      installReadingLibraryTheme(document);
    }
    controller.activate();
  } catch (error) {
    controller?.fail(error);
    document.documentElement.removeAttribute('data-novel-compass-extension');
    console.error('Novel Compass could not initialize its native theme.', error);
  }
}

async function bootstrapReplacement(): Promise<void> {
  let replacementHost: ReturnType<typeof ensureReplacementHost> | undefined;
  try {
    const preferences = await new ExtensionStorageRepository(
      chromeLocalStorageArea(),
    ).loadPreferences();
    const pagePreference =
      classification.kind === 'supported' && classification.identity.pageType === 'series-finder'
        ? preferences.value.pageModes.seriesFinder
        : preferences.value.pageModes.series;
    if (!preferences.value.extensionEnabled || pagePreference === 'original') {
      return;
    }

    replacementHost = ensureReplacementHost(document);
    await installProductStyles(replacementHost.productRoot);

    let renderFailed = false;
    const onFatalError = (error: unknown) => {
      renderFailed = true;
      replacementHost?.fail(error);
    };
    const datasetBaseUrl = chrome.runtime.getURL('data/');
    const actionRegistry = new OpaqueActionRegistry();
    const account = parseNovelUpdatesAccountState(
      document,
      window.location.href,
      actionRegistry,
    ).account;
    const routeApp = createRouteApp(
      onFatalError,
      datasetBaseUrl,
      actionRegistry,
      replacementHost.showOriginal,
    );
    const pageType =
      classification.kind === 'supported' ? classification.identity.pageType : 'other';
    const activeRoute: ExtensionRoute =
      pageType === 'series' ||
      pageType === 'series-finder' ||
      pageType === 'series-ranking' ||
      pageType === 'recommendation-lists'
        ? pageType
        : 'other';
    const app = createElement(
      ExtensionShell,
      {
        activeRoute,
        account,
        onInvokeAccountAction: (actionId: string) => {
          const result = actionRegistry.invoke(actionId);
          if (result.kind === 'navigate') window.location.assign(result.url);
        },
        onShowOriginal: replacementHost.showOriginal,
      },
      routeApp,
    );

    const root = createRoot(replacementHost.productRoot);
    flushSync(() => {
      root.render(createElement(RuntimeErrorBoundary, { onFatalError }, app));
    });
    if (renderFailed) {
      root.unmount();
      return;
    }

    replacementHost.activate();
    document.documentElement.dataset.novelCompassExtension = 'active';
  } catch (error) {
    replacementHost?.fail(error);
    document.documentElement.classList.remove('novel-compass-replacement-active');
    console.error('Novel Compass could not initialize its replacement UI.', error);
  }
}

function createRouteApp(
  onFatalError: (error: unknown) => void,
  datasetBaseUrl: string,
  actionRegistry: OpaqueActionRegistry,
  onShowOriginal: () => void,
): ReactNode {
  if (classification.kind !== 'supported') {
    onFatalError(new Error('Replacement UI received an unsupported route.'));
    return null;
  }
  if (classification.identity.pageType === 'series-finder') {
    return createElement(ExtensionFinderApp, { datasetBaseUrl, onShowOriginal });
  }
  if (classification.identity.pageType === 'series-ranking') {
    const ranking = parseRankingPage(document, window.location.href);
    if (!ranking.ok) {
      onFatalError(new Error(ranking.message ?? 'Series Ranking could not be parsed.'));
      return null;
    }
    return createElement(ExtensionRankingApp, {
      page: ranking.page,
      onNavigate: navigateHttps,
      onShowOriginal,
    });
  }
  if (classification.identity.pageType === 'recommendation-lists') {
    const recommendationLists = parseRecommendationListsPage(document, window.location.href);
    if (!recommendationLists.ok) {
      onFatalError(
        new Error(
          recommendationLists.message ?? 'Recommendation Lists could not be parsed.',
        ),
      );
      return null;
    }
    return createElement(ExtensionRecommendationListsApp, {
      page: recommendationLists.page,
      onShowOriginal,
    });
  }
  if (
    classification.identity.pageType === 'catalog-feed' ||
    classification.identity.pageType === 'catalog-taxonomy'
  ) {
    const catalog = parseCatalogPage(document, window.location.href);
    if (!catalog.ok) {
      onFatalError(new Error(catalog.message ?? 'Catalog page could not be parsed.'));
      return null;
    }
    return createElement(ExtensionCatalogApp, {
      page: catalog.page,
      onShowOriginal,
    });
  }
  return createSeriesApp(onFatalError, datasetBaseUrl, actionRegistry);
}

function createSeriesApp(
  onFatalError: (error: unknown) => void,
  datasetBaseUrl: string,
  registry: OpaqueActionRegistry,
): ReactNode {
  if (classification.kind !== 'supported' || classification.identity.pageType !== 'series') {
    onFatalError(new Error('Series UI received a non-series page identity.'));
    return null;
  }

  const metadata = parseLiveSeriesMetadata(document, classification.identity);
  if (!metadata.ok) {
    onFatalError(new Error(metadata.message));
    return null;
  }

  const releases = parseReleasePage(document, window.location.href, registry).page;
  const reviews = parseReviewPage(document, window.location.href, registry).page;
  return createElement(SeriesRuntimeApp, {
    datasetBaseUrl,
    identity: classification.identity,
    metadata: metadata.value,
    releases,
    reviews,
    onInvokeAction: (actionId: string) => {
      const result = registry.invoke(actionId);
      if (result.kind === 'navigate') {
        window.location.assign(result.url);
      }
    },
    onNavigate: navigateHttps,
  });
}

async function installProductStyles(productRoot: HTMLElement): Promise<void> {
  const response = await fetch(chrome.runtime.getURL('content/style.css'));
  if (!response.ok) {
    throw new Error(`Extension styles failed to load (${response.status}).`);
  }
  const shadow = productRoot.getRootNode();
  if (!(shadow instanceof ShadowRoot)) {
    throw new Error('Extension product root is not inside Shadow DOM.');
  }
  const style = document.createElement('style');
  style.dataset.novelCompassProductStyles = 'true';
  style.textContent = await response.text();
  shadow.prepend(style);
}

function navigateHttps(value: string): void {
  const url = resolveNovelUpdatesNavigation(value, window.location.href);
  if (url) {
    window.location.assign(url);
  }
}

interface RuntimeErrorBoundaryProps {
  children?: ReactNode;
  onFatalError: (error: unknown) => void;
}

class RuntimeErrorBoundary extends Component<RuntimeErrorBoundaryProps> {
  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onFatalError(error);
  }

  override render(): ReactNode {
    return this.props.children;
  }
}
