// Horizontal-overflow sanity check, no Playwright needed.
// Usage: run the dev server, open any page of the app, paste this file into the
// browser console (or `preview_evaluate`). It loads each view in a hidden iframe
// at 390px and 1280px wide and reports scrollWidth vs innerWidth.
// Returns an array of rows; `ok:false` rows overflow horizontally.
(async () => {
  const novelHref = document.querySelector('a[href*="view=novel"]')?.getAttribute('href') || '/?view=novel&id=18721';
  const views = ['/?view=foryou', '/?view=discover', '/?view=discover&seed=6780', '/?view=browse', '/?view=settings', '/?view=profile', novelHref];
  const rows = [];
  for (const width of [390, 1280]) {
    for (const url of views) {
      const frame = document.createElement('iframe');
      frame.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:900px;border:0`;
      frame.src = url;
      document.body.appendChild(frame);
      await new Promise((resolve) => { frame.onload = resolve; });
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const doc = frame.contentDocument.documentElement;
      const win = frame.contentWindow;
      const wide = [...frame.contentDocument.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > win.innerWidth + 1)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
      rows.push({ width, url, scrollWidth: doc.scrollWidth, innerWidth: win.innerWidth, ok: doc.scrollWidth <= win.innerWidth, wide });
      frame.remove();
    }
  }
  return rows;
})();
