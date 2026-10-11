import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const extensionRoot = new URL('../../', import.meta.url);

describe('extension action popup', () => {
  it('is registered as the toolbar action popup', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', extensionRoot), 'utf8'),
    ) as {
      action?: { default_popup?: string; default_title?: string };
    };

    expect(manifest.action).toEqual({
      default_title: 'Novel Compass settings',
      default_popup: 'popup/index.html',
    });
  });

  it('starts page restyling as soon as the native DOM is available', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', extensionRoot), 'utf8'),
    ) as { content_scripts?: Array<{ run_at?: string }> };

    expect(manifest.content_scripts?.[0]?.run_at).toBe('document_end');
  });

  it('exposes accessible controls for every popup preference', async () => {
    const html = await readFile(new URL('src/popup/index.html', extensionRoot), 'utf8');

    expect(html).toContain('id="extension-enabled"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('name="theme" value="system"');
    expect(html).toContain('name="theme" value="light"');
    expect(html).toContain('name="theme" value="dark"');
    expect(html).toContain('name="page-mode" value="replacement"');
    expect(html).toContain('name="page-mode" value="original"');
    expect(html).toContain('id="show-original-button"');
    expect(html).toContain('id="data-pack-enable"');
    expect(html).toContain('id="data-pack-remove"');
    expect(html).toContain('Optional enhanced search and similar-novel recommendations.');
    expect(html).toContain('Restyling and live');
    expect(html).toContain('id="data-pack-fallback"');
    expect(html).toContain('href="https://cbangera2.github.io/NovelCompass/"');
    expect(html).toContain('href="https://github.com/cbangera2/NovelCompass"');
    expect(html).toContain('aria-live="polite"');
  });

  it('declares only the NovelCompass static origin as optional', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', extensionRoot), 'utf8'),
    ) as { optional_host_permissions?: string[] };
    expect(manifest.optional_host_permissions).toEqual(['https://cbangera2.github.io/*']);
  });

  it('uses the Novel Compass violet palette in both color schemes', async () => {
    const css = await readFile(new URL('src/popup/popup.css', extensionRoot), 'utf8');

    expect(css).toContain('#9b87f5');
    expect(css).toContain('#b8a8ff');
    expect(css).toContain('#6d5bd0');
    expect(css).toContain('#5945bc');
    expect(css).toContain('#ebe7f6');
    expect(css).not.toMatch(/#(?:2f9965|196342|278f5b|40b978|6bdd9f|79dba4|80d9a7)\b/i);
  });
});
