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

  it('exposes accessible controls for every popup preference', async () => {
    const html = await readFile(new URL('src/popup/index.html', extensionRoot), 'utf8');

    expect(html).toContain('id="extension-enabled"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('name="theme" value="system"');
    expect(html).toContain('name="theme" value="light"');
    expect(html).toContain('name="theme" value="dark"');
    expect(html).toContain('name="page-mode" value="replacement"');
    expect(html).toContain('name="page-mode" value="original"');
    expect(html).toContain('aria-live="polite"');
  });
});
