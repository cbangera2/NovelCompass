import { chromeLocalStorageArea } from '../storage/chrome-storage';
import { ExtensionStorageRepository } from '../storage/repository';
import type { ExtensionPageMode, ExtensionTheme } from '../storage/types';
import type { DataPackStatus } from '../data/protocol';
import {
  enableDataPack,
  readDataPackStatus,
  removeDataPack,
} from './data-controls';

const repository = new ExtensionStorageRepository(chromeLocalStorageArea());

const enabledInput = requiredInput('extension-enabled');
const showOriginalButtonInput = requiredInput('show-original-button');
const statusPill = requiredElement('status-pill');
const saveStatus = requiredElement('save-status');
const dataPackBadge = requiredElement('data-pack-badge');
const dataPackDetail = requiredElement('data-pack-detail');
const dataPackFallback = requiredElement('data-pack-fallback');
const dataPackEnable = requiredButton('data-pack-enable');
const dataPackRemove = requiredButton('data-pack-remove');
const controls = Array.from(document.querySelectorAll('input, button, a[data-external]'));

void initialize();

async function initialize(): Promise<void> {
  setDisabled(true);
  try {
    const result = await repository.loadPreferences();
    const preferences = result.value;
    enabledInput.checked = preferences.extensionEnabled;
    showOriginalButtonInput.checked = preferences.showOriginalButton;
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
    renderDataPackStatus(await readDataPackStatus());
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
  showOriginalButtonInput.addEventListener('change', () => {
    void save(() =>
      repository.updatePreferences({ showOriginalButton: showOriginalButtonInput.checked }),
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

  dataPackEnable.addEventListener('click', () => {
    void runDataPackAction(enableDataPack);
  });
  dataPackRemove.addEventListener('click', () => {
    void runDataPackAction(removeDataPack);
  });
}

async function runDataPackAction(operation: () => Promise<DataPackStatus>): Promise<void> {
  dataPackEnable.disabled = true;
  dataPackRemove.disabled = true;
  dataPackBadge.textContent = 'Working';
  dataPackDetail.textContent = 'Updating optional NovelCompass data…';
  try {
    renderDataPackStatus(await operation());
  } catch {
    renderDataPackStatus({
      state: 'error',
      message: 'The data service could not be reached. Try again when you are online.',
    });
  }
}

function renderDataPackStatus(status: DataPackStatus): void {
  const version = status.datasetVersion ? ` · ${status.datasetVersion}` : '';
  const size = status.bytes ? ` · ${formatBytes(status.bytes)}` : '';
  dataPackBadge.dataset.state = status.state;
  dataPackFallback.hidden = status.state !== 'error' && status.state !== 'update-required';
  dataPackRemove.hidden = status.state !== 'ready';
  dataPackRemove.disabled = false;
  dataPackEnable.disabled = false;
  if (status.state === 'ready') {
    dataPackBadge.textContent = 'Ready';
    dataPackDetail.textContent = `Cached${version}${size}`;
    dataPackEnable.textContent = 'Check for update';
  } else if (status.state === 'update-required') {
    dataPackBadge.textContent = 'Update needed';
    dataPackDetail.textContent = status.message || 'Update the extension to use the latest data.';
    dataPackEnable.textContent = 'Retry';
  } else if (status.state === 'error') {
    dataPackBadge.textContent = 'Unavailable';
    dataPackDetail.textContent = status.message || 'Optional data is currently unavailable.';
    dataPackEnable.textContent = 'Retry';
  } else {
    dataPackBadge.textContent = status.datasetVersion ? 'Enabled' : 'Optional';
    dataPackDetail.textContent = status.datasetVersion
      ? `Version ${status.datasetVersion} is ready to download as features need it.`
      : 'No recommendation data has been downloaded.';
    dataPackEnable.textContent = status.datasetVersion ? 'Check for update' : 'Enable data';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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

function requiredButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button #${id}.`);
  return element;
}
