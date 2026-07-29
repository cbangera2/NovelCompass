export type ActionInvocation =
  { kind: 'navigate'; url: string } | { kind: 'delegated' } | { kind: 'unavailable' };

type RegisteredAction =
  { kind: 'navigate'; url: string } | { kind: 'element'; element: HTMLElement };

export interface ActionGeneration {
  readonly generation: number;
  registerNavigation(url: string | URL, baseUrl?: string | URL): string | undefined;
  registerElement(element: HTMLElement): string;
}

/**
 * Keeps host-page elements out of normalized adapter records. A new generation
 * invalidates all prior handles in the same namespace while leaving other
 * adapters' handles alone.
 */
export class OpaqueActionRegistry {
  readonly #actions = new Map<string, RegisteredAction>();
  readonly #generations = new Map<string, number>();
  #nextAction = 0;

  beginGeneration(namespace: string): ActionGeneration {
    validateNamespace(namespace);
    const generation = (this.#generations.get(namespace) ?? 0) + 1;
    this.#generations.set(namespace, generation);

    const prefix = `${namespace}:`;
    for (const actionId of this.#actions.keys()) {
      if (actionId.startsWith(prefix)) {
        this.#actions.delete(actionId);
      }
    }

    const register = (action: RegisteredAction): string => {
      const actionId = `${namespace}:${generation}:${++this.#nextAction}`;
      this.#actions.set(actionId, action);
      return actionId;
    };

    return {
      generation,
      registerNavigation: (url, baseUrl) => {
        const normalizedUrl = normalizeHttpsUrl(url, baseUrl);
        return normalizedUrl ? register({ kind: 'navigate', url: normalizedUrl }) : undefined;
      },
      registerElement: (element) => register({ kind: 'element', element }),
    };
  }

  invoke(actionId: string): ActionInvocation {
    const action = this.#actions.get(actionId);
    if (!action || !this.#isCurrentGeneration(actionId)) {
      return { kind: 'unavailable' };
    }

    if (action.kind === 'navigate') {
      return { kind: 'navigate', url: action.url };
    }
    if (!action.element.isConnected) {
      this.#actions.delete(actionId);
      return { kind: 'unavailable' };
    }

    action.element.click();
    return { kind: 'delegated' };
  }

  invalidate(namespace: string): void {
    validateNamespace(namespace);
    this.#generations.set(namespace, (this.#generations.get(namespace) ?? 0) + 1);
    const prefix = `${namespace}:`;
    for (const actionId of this.#actions.keys()) {
      if (actionId.startsWith(prefix)) {
        this.#actions.delete(actionId);
      }
    }
  }

  #isCurrentGeneration(actionId: string): boolean {
    const [namespace, rawGeneration] = actionId.split(':', 2);
    if (!namespace || !rawGeneration) {
      return false;
    }
    return this.#generations.get(namespace) === Number(rawGeneration);
  }
}

function normalizeHttpsUrl(value: string | URL, baseUrl?: string | URL): string | undefined {
  try {
    const url =
      value instanceof URL
        ? new URL(value.href)
        : new URL(value, baseUrl instanceof URL ? baseUrl.href : baseUrl);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function validateNamespace(namespace: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) {
    throw new Error('Action namespace must contain lowercase letters, numbers, and hyphens.');
  }
}
