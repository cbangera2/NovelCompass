// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';

import {
  installFollowingTheme,
  installReadingLibraryTheme,
} from '../../src/content/reading-library-theme';

afterEach(() => {
  document.documentElement.removeAttribute('class');
  document.body.replaceChildren();
});

describe('installReadingLibraryTheme', () => {
  it('frames the live reading list without replacing authenticated controls', () => {
    document.body.innerHTML = `
      <main class="l-main">
        <form id="reading-controls" action="/reading-list/" method="post">
          <input name="_wpnonce" value="short-lived-fixture">
          <select name="list"><option>Reading</option></select>
          <button type="submit">Move selected</button>
        </form>
        <table id="myTable"><tbody><tr>
          <td><a href="/series/example/">Example</a></td>
          <td><a href="/extnu/1/">c12</a></td>
        </tr></tbody></table>
      </main>
    `;
    const main = document.querySelector('main');
    const form = document.querySelector('form');
    const nonce = document.querySelector<HTMLInputElement>('input[name="_wpnonce"]');
    const chapter = document.querySelector<HTMLAnchorElement>('a[href="/extnu/1/"]');

    installReadingLibraryTheme(document);

    expect(document.documentElement.classList.contains('novel-compass-reading-library')).toBe(true);
    expect(document.querySelector('main')).toBe(main);
    expect(document.querySelector('form')).toBe(form);
    expect(document.querySelector('input[name="_wpnonce"]')).toBe(nonce);
    expect(nonce?.value).toBe('short-lived-fixture');
    expect(document.querySelector('a[href="/extnu/1/"]')).toBe(chapter);
    expect(chapter?.getAttribute('href')).toBe('/extnu/1/');
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Reading list');
  });

  it('is idempotent', () => {
    document.body.innerHTML = '<main class="l-main"></main>';
    installReadingLibraryTheme(document);
    installReadingLibraryTheme(document);

    expect(document.querySelectorAll('#novel-compass-reading-library-header')).toHaveLength(1);
  });

  it('frames Following while preserving authenticated controls', () => {
    document.body.innerHTML = `
      <main class="l-main">
        <form id="following-actions" action="/following/" method="post">
          <input name="_wpnonce" value="following-fixture">
          <button name="unfollow" value="42" type="submit">Unfollow</button>
        </form>
      </main>
    `;
    const form = document.getElementById('following-actions');
    const button = document.querySelector<HTMLButtonElement>('button[name="unfollow"]');

    installFollowingTheme(document);

    expect(document.documentElement.classList.contains('novel-compass-following')).toBe(true);
    expect(document.getElementById('following-actions')).toBe(form);
    expect(document.querySelector('button[name="unfollow"]')).toBe(button);
    expect(document.querySelector<HTMLInputElement>('input[name="_wpnonce"]')?.value)
      .toBe('following-fixture');
    expect(document.querySelector('#novel-compass-reading-library-title')?.textContent)
      .toBe('Following');
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Following');
  });
});
