const NOVEL_UPDATES_ORIGIN = 'https://www.novelupdates.com';

/**
 * Resolve UI-driven navigation without trusting catalog or adapter strings.
 * Milestone 1 navigates only within Novel Updates.
 */
export function resolveNovelUpdatesNavigation(
  value: string,
  baseUrl: string | URL,
): string | undefined {
  if (!/^https:\/\//i.test(value) && !/^[/?#]/.test(value)) {
    return undefined;
  }
  try {
    const url = new URL(value, baseUrl instanceof URL ? baseUrl.href : baseUrl);
    return url.protocol === 'https:' && url.origin === NOVEL_UPDATES_ORIGIN ? url.href : undefined;
  } catch {
    return undefined;
  }
}
