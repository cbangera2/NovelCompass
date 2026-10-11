# Extension static-data fixture

This is the deterministic, deliberately tiny dataset used by extension and
shared-data tests. It follows the production static snapshot contract while
remaining small enough to package in browser-test builds.

The fixture contains three Novel Updates titles chosen to exercise:

- exact slug, numeric-id, alias, and title identity resolution;
- language, genre, tag, year, status, chapter, and readership filters;
- deterministic popularity/rating/title sorting;
- detail and recommendation shard loading.

Tests should address the directory as a dataset root; they must not special-case
fixture records in application code.
