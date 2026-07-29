import { chromeLocalStorageArea } from '../storage/chrome-storage';
import { ExtensionStorageRepository } from '../storage/repository';
import type { ExtensionPageMode, ExtensionTheme } from '../storage/types';

const repository = new ExtensionStorageRepository(chromeLocalStorageArea());

const enabledInput = requiredInput('extension-enabled');
const statusPill = requiredElement('status-pill');
const saveStatus = requiredElement('save-status');
const controls = Array.from(document.querySelectorAll('input, a[data-external]'));

void initialize();

async function initialize(): Promise<void> {
  setDisabled(true);
  try {
    const result = await repository.loadPreferences();
    const preferences = result.value;
    enabledInput.checked = preferences.extensionEnabled;
    checkedRadio('theme', preferences.theme).checked = true;

    const pageModes = Object.values(preferences.pageModes);
    const defaultMode: ExtensionPageMode = pageModes.every((mode) => mode === 'original')
      ? 'original'
      : 'replacement';
    checkedRadio('page-mode', defaultMode).checked = true;
    renderEnabled(preferences.extensionEnabled);

    if (result.status === 'corrupt' || result.status === 'unsupported') {
      showStatus('Settings were reset to safe defaults.', true);
    }
    bindEvents();
    setDisabled(false);
  } catch {
    renderEnabled(false);
    showStatus('Settings are unavailable. Reload the extension.', true);
  }
}

function bindEvents(): void {
  enabledInput.addEventListener('change', () => {
    void save(
      () => repository.setEnabled(enabledInput.checked),
      () => renderEnabled(enabledInput.checked),
    );
  });

  document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        void save(() => repository.updatePreferences({ theme: input.value as ExtensionTheme }));
      }
    });
  });

  document.querySelectorAll<HTMLInputElement>('input[name="page-mode"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const mode = input.value as ExtensionPageMode;
      void save(() =>
        repository.updatePreferences({
          pageModes: { series: mode, seriesFinder: mode },
        }),
      );
    });
  });

  document.querySelectorAll<HTMLAnchorElement>('a[data-external]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void chrome.tabs.create({ url: link.href });
    });
  });
}

async function save(
  operation: () => Promise<unknown>,
  onSaved: () => void = () => undefined,
): Promise<void> {
  setDisabled(true);
  showStatus('Saving…');
  try {
    await operation();
    onSaved();
    showStatus('Saved');
  } catch {
    showStatus('Could not save this setting.', true);
  } finally {
    setDisabled(false);
  }
}

function renderEnabled(enabled: boolean): void {
  statusPill.textContent = enabled ? 'On' : 'Off';
  statusPill.dataset.enabled = String(enabled);
}

function showStatus(message: string, error = false): void {
  saveStatus.textContent = message;
  saveStatus.dataset.error = String(error);
}

function setDisabled(disabled: boolean): void {
  for (const control of controls) {
    if (control instanceof HTMLInputElement) control.disabled = disabled;
    else control.setAttribute('aria-disabled', String(disabled));
  }
}

function checkedRadio(name: string, value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `input[name="${name}"][value="${value}"]`,
  );
  if (!input) throw new Error(`Missing ${name} option ${value}.`);
  return input;
}

function requiredInput(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input #${id}.`);
  return element;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}.`);
  return element;
}
