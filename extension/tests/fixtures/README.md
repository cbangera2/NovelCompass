# Sanitized Novel Updates fixtures

These intentionally small documents model only public markup needed by adapter
tests. Names, numeric IDs, review text, and group names are synthetic. Fixtures
must never contain cookies, request headers, active nonces, private reading-list
content, email addresses, or other account identifiers.

When adding an authenticated fixture:

1. Save the rendered HTML locally while logged in.
2. remove scripts, analytics, ads, comments, and unrelated navigation;
3. replace usernames, IDs, review text, list names, and group names;
4. remove cookies, tokens, nonces, hidden account fields, and outbound chapter
   destinations;
5. retain only the minimum elements needed to prove a parser or action contract;
6. inspect the diff before committing.

The repository's older `tests/fixtures/series_page.html` is a useful parser
reference, but it is a large historical capture and should not be copied into
the extension corpus.

## Deterministic fixture host

Run `pnpm --dir web fixtures:extension` to serve these documents from
`http://127.0.0.1:4174`. The server maps stable series and Series Finder paths,
plus explicit challenge and unsupported-markup routes, without contacting Novel
Updates. Browser automation can load a fixture and inject the built content
bundle when testing outside Chrome's production host match.
