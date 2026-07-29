# Novel Compass Chrome Extension

## Load the browser-ready local build

The full local build includes the current Novel Compass static dataset:

```bash
pnpm --dir web run build:extension:full
```

Then open `chrome://extensions`, enable **Developer mode**, choose
**Load unpacked**, and select:

```text
extension/dist
```

Visit either:

- `https://www.novelupdates.com/series/<slug>/`
- `https://www.novelupdates.com/series-finder/`

Use the fixed **Use original Novel Updates** control to switch back without
reloading the page.

## Smaller deterministic package

CI and package validation use a three-title fixture instead of the full local
dataset:

```bash
pnpm --dir web run test:extension
pnpm --dir web run package:extension
```

The validated ZIP is written to:

```text
extension/dist/novel-compass-extension.zip
```

Running the deterministic package command replaces `extension/dist` with the
small fixture build. Run `build:extension:full` again before manual testing.

## Local fixture server

For parser and fallback fixture pages:

```bash
pnpm --dir web run fixtures:extension
```

Live Novel Updates testing remains necessary for authenticated chapter,
reading-list, rating, and review behavior. Never save cookies or active session
tokens into repository fixtures.
