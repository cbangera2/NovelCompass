"""Precompute For You list rows for static hosting (GitHub Pages / Cloudflare Pages).

Writes web/public/for-you-data/: lists.json plus one list-<id>.json per list holding the
ranked recommendation ids for "Because you love <list>". The browser blends lists, hides
read titles and resolves ids to cards client-side, so no API is needed.

    .venv/bin/python scripts/build_for_you_static.py [--limit 150]
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import src.api.main as api  # noqa: E402


def wait_for_ease(timeout: float = 600.0) -> None:
    """EASE rebuilds in the background after list imports; rows would silently lack that channel until it is ready."""
    conn = api.get_db()
    try:
        gen = api.CandidateGenerator(conn)
        seed = conn.execute("SELECT novel_id FROM rec_list_items LIMIT 1").fetchone()[0]
        deadline = time.time() + timeout
        while not gen.get_candidate_channels(seed, limit_per_channel=5).get("ease"):
            if time.time() > deadline:
                raise SystemExit("EASE model did not become ready")
            time.sleep(5)
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "web" / "public" / "for-you-data"))
    ap.add_argument("--limit", type=int, default=150)
    ap.add_argument("--min-items", type=int, default=10)
    ap.add_argument("--all-lists", action="store_true",
                    help="also include lists with no curator name (just the largest ones; low signal)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("list-*.json"):
        stale.unlink()

    wait_for_ease()
    lists = api.for_you_lists(min_items=args.min_items)["lists"]
    if not args.all_lists:
        # Without a curator name nothing says anyone likes a list, so don't ship it.
        lists = [l for l in lists if l["curator"]]
    kept = []
    for entry in lists:
        lid = entry["id"]
        try:
            row = api.for_you_row(api.ForYouRowRequest(list_ids=[lid], limit=args.limit))
        except Exception as exc:  # a list without members in the catalog
            print(f"skip {lid}: {exc}")
            continue
        conn = api.get_db()
        try:
            members = [m["id"] for m in api._list_members(conn, lid)]
        finally:
            conn.close()
        recs = [[r["target_id"], r["match_score_percent"], r.get("shared_tags", [])[:3]] for r in row["recommendations"]]
        payload = {"id": lid, "title": entry["title"], "seeds": row["seeds"], "members": members, "recs": recs}
        (out / f"list-{lid}.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        kept.append(entry)
        print(f"list {lid}: {len(recs)} recs", flush=True)
    (out / "lists.json").write_text(json.dumps({"lists": kept}, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(kept)} lists to {out}")


if __name__ == "__main__":
    main()
