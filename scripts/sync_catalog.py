"""Sync the local SQLite catalog from the published novelcompass-data static dataset.

Adds Novel Updates and AniList titles the local DB is missing and refreshes
metadata and popularity numbers for the ones it has. The recommendation graph
(direct recs, list memberships), imported lists and local-only titles are left
untouched: the static dataset only carries counts for those, not the edges.

    .venv/bin/python scripts/sync_catalog.py [--ref main] [--dry-run]
"""
import argparse
import json
import shutil
import sqlite3
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_RAW = "https://raw.githubusercontent.com/cbangera2/novelcompass-data/{ref}/{path}"
BUCKETS = [f"{i:02x}" for i in range(256)]


def fetch_json(ref: str, path: str, cache: Path):
    target = cache / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        url = REPO_RAW.format(ref=ref, path=path)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=60) as response:
                    target.write_bytes(response.read())
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2)
    return json.loads(target.read_text(encoding="utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="main", help="branch or commit of cbangera2/novelcompass-data")
    ap.add_argument("--db", default=str(ROOT / "data" / "recommender.db"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    manifest_raw = urllib.request.urlopen(REPO_RAW.format(ref=args.ref, path="manifest.json"), timeout=60).read()
    manifest = json.loads(manifest_raw)
    version = manifest["dataset_version"]
    cache = ROOT / "data" / "cache" / "catalog-sync" / version
    print(f"{args.ref}: dataset {version}, generated {manifest.get('generated_at')}, {manifest['novel_count']} titles")

    catalog = fetch_json(args.ref, manifest.get("catalog_url", "catalog.json"), cache)
    fields = {name: i for i, name in enumerate(catalog["fields"])}
    rows = catalog["rows"]
    with ThreadPoolExecutor(8) as pool:
        buckets = list(pool.map(lambda b: fetch_json(args.ref, f"details/{b}.json", cache), BUCKETS))
    details = {int(k): v for bucket in buckets for k, v in bucket.items()}
    print(f"downloaded catalog ({len(rows)} rows) and {len(details)} detail records")

    conn = sqlite3.connect(args.db)
    existing = {r[0] for r in conn.execute("SELECT id FROM novels")}
    new_rows = [r for r in rows if r[fields["id"]] not in existing]
    print(f"{len(rows) - len(new_rows)} to refresh, {len(new_rows)} new, {len(existing - {r[fields['id']] for r in rows})} local-only (kept)")
    if args.dry_run:
        return

    backup = Path(args.db).with_name(Path(args.db).name + f".bak-{time.strftime('%Y%m%d-%H%M%S')}")
    conn.close()
    shutil.copy2(args.db, backup)
    print(f"backup written to {backup}")
    conn = sqlite3.connect(args.db)

    genre_names, tag_names = catalog["genres"], catalog["tags"]
    languages, statuses = catalog["languages"], catalog["statuses"]
    genre_ids = {n: conn.execute("SELECT id FROM genres WHERE name=?", (n,)).fetchone() for n in genre_names}
    for name, found in list(genre_ids.items()):
        if found is None:
            conn.execute("INSERT INTO genres (name) VALUES (?)", (name,))
            found = conn.execute("SELECT id FROM genres WHERE name=?", (name,)).fetchone()
        genre_ids[name] = found[0]
    tag_ids = {}
    for name in tag_names:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
    for tid, name in conn.execute("SELECT id, name FROM tags"):
        tag_ids[name] = tid

    inserted = updated = 0
    with conn:
        for row in rows:
            nid = row[fields["id"]]
            d = details.get(nid, {})
            g = lambda key: row[fields[key]]  # noqa: E731
            record = {
                "slug": g("slug"),
                "title": g("title"),
                "author": g("author") or None,
                "language": languages[g("language_id")] or None,
                "rating": g("rating") or 0.0,
                "rating_votes": g("votes") or 0,
                "reading_list_count": g("readers") or 0,
                "year": g("year") or None,
                "chapters_trans": g("translated_chapters") or 0,
                "status_trans": statuses[g("status_id")] or None,
                "cover_url": g("cover") or None,
                "synopsis": d.get("synopsis") or None,
                "associated_names": json.dumps(d.get("associated_names") or []),
                "chapters_orig": d.get("original_chapters") or 0,
                **{f"rating_votes_{n}": d.get(f"rating_votes_{n}") or 0 for n in range(1, 6)},
            }
            clash = conn.execute("SELECT id FROM novels WHERE slug=? AND id!=?", (record["slug"], nid)).fetchone()
            if clash:  # slugs are UNIQUE; disambiguate rather than fail the whole sync
                record["slug"] = f"{record['slug']}-{nid}"
            if nid in existing:
                # Keep locally scraped text/covers when the dataset has nothing better.
                sets = ", ".join(
                    f"{k}=COALESCE(?, {k})" if k in ("cover_url", "synopsis", "author", "language", "status_trans", "year") else f"{k}=?"
                    for k in record
                )
                conn.execute(f"UPDATE novels SET {sets}, updated_at=CURRENT_TIMESTAMP WHERE id=?", (*record.values(), nid))
                updated += 1
            else:
                cols = ", ".join(["id", *record, "media_type", "source", "external_id", "external_url"])
                marks = ", ".join("?" * (len(record) + 5))
                conn.execute(
                    f"INSERT INTO novels ({cols}) VALUES ({marks})",
                    (nid, *record.values(), g("media_type") or "novel", g("source"), g("external_id") or str(nid), g("external_url")),
                )
                inserted += 1
            if g("source") != "novelupdates":
                conn.execute(
                    "INSERT INTO source_records (source_key, external_id, novel_id, raw_media_type, updated_at) "
                    "VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) "
                    "ON CONFLICT(source_key, external_id) DO UPDATE SET novel_id=excluded.novel_id, "
                    "raw_media_type=excluded.raw_media_type, updated_at=CURRENT_TIMESTAMP",
                    (g("source"), g("external_id") or str(nid), nid, g("media_type")),
                )
            gids = d.get("genre_ids") or g("genre_ids") or []
            tids = d.get("tag_ids") or []
            if gids:
                conn.execute("DELETE FROM novel_genres WHERE novel_id=?", (nid,))
                conn.executemany(
                    "INSERT OR IGNORE INTO novel_genres (novel_id, genre_id) VALUES (?, ?)",
                    [(nid, genre_ids[genre_names[i]]) for i in gids],
                )
            if tids:
                conn.execute("DELETE FROM novel_tags WHERE novel_id=?", (nid,))
                conn.executemany(
                    "INSERT OR IGNORE INTO novel_tags (novel_id, tag_id) VALUES (?, ?)",
                    [(nid, tag_ids[tag_names[i]]) for i in tids],
                )
        conn.execute(
            "INSERT INTO artifact_metadata (key, value) VALUES ('catalog_sync', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps({"ref": args.ref, "dataset_version": version, "synced_at": time.strftime("%Y-%m-%dT%H:%M:%S")}),),
        )
    print(f"done: {inserted} inserted, {updated} refreshed")
    print("Restart the API so the embedding and EASE caches pick up the new titles.")


if __name__ == "__main__":
    main()
