"""Find Novel Updates covers that now 404 and look for the re-uploaded file.

NU re-uploads covers into a newer year/month folder (often changing the format, .jpg -> .png) with the same
filename, so for each broken URL we probe the same filename across later folders on the CDN. Series pages sit
behind Cloudflare; the CDN does not.

Resumable: every result is appended to a JSONL state file the moment it is known, and a re-run skips anything
already recorded for the same URL. Ctrl-C (or kill) at any point loses at most the requests in flight.

    .venv/bin/python scripts/fix_broken_covers.py [--apply] [--status] [--reset]
"""
import argparse
import concurrent.futures as cf
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CDN = "https://cdn.novelupdates.com/images/"
UA = {"User-Agent": "Mozilla/5.0"}
DEFAULT_STATE = ROOT / "data" / "cache" / "cover-fix-state.jsonl"
END_FOLDER = (2026, 12)


def status(url: str) -> int:
    for attempt in range(2):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=UA), timeout=20).status
        except urllib.error.HTTPError as exc:
            return exc.code
        except Exception:
            if attempt:
                return 0
            time.sleep(1)
    return 0


def folders(year: int, month: int):
    while (year, month) <= END_FOLDER:
        yield f"{year}/{month:02d}"
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def find_replacement(url: str):
    match = re.match(rf"{re.escape(CDN)}(\d{{4}})/(\d{{2}})/(.+)$", url)
    if not match:
        return None
    year, month, name = int(match[1]), int(match[2]), match[3]
    stem, _, ext = name.rpartition(".")
    for suffix in [ext, *[e for e in ("png", "jpg", "jpeg", "webp") if e != ext]]:
        for folder in folders(year, month):
            candidate = f"{CDN}{folder}/{stem}.{suffix}"
            if candidate != url and status(candidate) == 200:
                return candidate
    return None


class State:
    """Append-only JSONL: {"id", "url", "check": http status} and {"id", "url", "fix": new url or null}."""

    def __init__(self, path: Path):
        self.path = path
        self.checked: dict = {}  # (id, url) -> status
        self.fixed: dict = {}    # (id, url) -> new url or None
        if path.exists():
            for line in path.read_text().splitlines():
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue  # a torn last line from a kill
                key = (rec["id"], rec["url"])
                if "check" in rec:
                    self.checked[key] = rec["check"]
                if "fix" in rec:
                    self.fixed[key] = rec["fix"]
        path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = path.open("a", buffering=1)

    def add(self, nid: int, url: str, **kw) -> None:
        self.handle.write(json.dumps({"id": nid, "url": url, **kw}) + "\n")


def say(msg: str) -> None:
    print(msg, flush=True)


def run_phase(pool, items, work, on_result, label: str, every: int):
    started, done, total = time.time(), 0, len(items)
    if not total:
        say(f"{label}: nothing to do")
        return
    futures = {pool.submit(work, it): it for it in items}
    for fut in cf.as_completed(futures):
        on_result(futures[fut], fut.result())
        done += 1
        if done % every == 0 or done == total:
            rate = done / (time.time() - started)
            say(f"{label}: {done}/{total} ({100 * done // total}%), {rate:.1f}/s, ~{(total - done) / rate / 60:.1f} min left")


def apply_fixes(conn, pairs) -> None:
    if pairs:
        with conn:
            conn.executemany("UPDATE novels SET cover_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", pairs)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "data" / "recommender.db"))
    ap.add_argument("--state", default=str(DEFAULT_STATE))
    ap.add_argument("--apply", action="store_true", help="write found replacements to the DB as they are found")
    ap.add_argument("--status", action="store_true", help="print progress from the state file and exit")
    ap.add_argument("--reset", action="store_true", help="discard saved progress")
    ap.add_argument("--threads", type=int, default=16)
    args = ap.parse_args()

    state_path = Path(args.state)
    if args.reset and state_path.exists():
        state_path.unlink()
    conn = sqlite3.connect(args.db, timeout=30)
    rows = conn.execute(
        "SELECT id, cover_url FROM novels WHERE source='novelupdates' AND cover_url LIKE ?", (CDN + "%",)
    ).fetchall()
    state = State(state_path)

    todo_check = [r for r in rows if (r[0], r[1]) not in state.checked]
    broken = [r for r in rows if state.checked.get((r[0], r[1])) == 404]
    if args.status:
        pending = [r for r in broken if (r[0], r[1]) not in state.fixed]
        found = sum(1 for r in broken if state.fixed.get((r[0], r[1])))
        say(f"covers: {len(rows)} | checked {len(rows) - len(todo_check)} | broken {len(broken)} | "
            f"replacements found {found} | not found {len(broken) - found - len(pending)} | still to search {len(pending)}")
        return

    say(f"{len(rows)} covers; {len(rows) - len(todo_check)} already checked, {len(todo_check)} to check")
    with cf.ThreadPoolExecutor(args.threads) as pool:
        def got_check(row, code):
            state.checked[(row[0], row[1])] = code
            state.add(row[0], row[1], check=code)
        run_phase(pool, todo_check, lambda r: status(r[1]), got_check, "check", 500)

        broken = [r for r in rows if state.checked.get((r[0], r[1])) == 404]
        todo_fix = [r for r in broken if (r[0], r[1]) not in state.fixed]
        say(f"{len(broken)} covers are 404; {len(broken) - len(todo_fix)} already searched, {len(todo_fix)} to search")
        batch = []

        def got_fix(row, new):
            state.fixed[(row[0], row[1])] = new
            state.add(row[0], row[1], fix=new)
            if new and args.apply:
                batch.append((new, row[0]))
                if len(batch) >= 10:
                    apply_fixes(conn, batch)
                    batch.clear()
        run_phase(pool, todo_fix, lambda r: find_replacement(r[1]), got_fix, "search", 10)
        apply_fixes(conn, batch)

    found = [(state.fixed[(i, u)], i) for i, u in broken if state.fixed.get((i, u))]
    say(f"done: {len(found)} replacements found, {len(broken) - len(found)} unresolved"
        + (" (applied to DB)" if args.apply else "; re-run with --apply to write them"))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        say("interrupted; progress is saved, re-run to resume")
        sys.exit(130)
