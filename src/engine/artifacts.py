"""Disk-cached engine artifacts (embeddings, EASE neighbours) that never block a request.

Fitting EASE takes ~40s and embedding the catalog ~1-2 min, so they are built once,
saved under data/cache/engine/ and reloaded in well under a second. A saved copy is
served even when the database has since changed (it is stale, not wrong) while a
fresh one is rebuilt in the background. When nothing is saved yet, requests get
"not ready" instead of waiting, and the channel simply contributes no candidates
until the build finishes.

In-memory databases (tests, offline eval) have no file to key a cache on, so they
build inline and synchronously, exactly as before.
"""
import hashlib
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Callable, Dict, Optional

import numpy as np

CACHE_DIR = Path(os.environ.get("NOVEL_ENGINE_CACHE", Path(__file__).resolve().parents[2] / "data" / "cache" / "engine"))
FORMAT_VERSION = "1"


def db_file(conn: sqlite3.Connection) -> Optional[str]:
    for _seq, name, path in conn.execute("PRAGMA database_list"):
        if name == "main" and path:
            return path
    return None


def open_readonly(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)


def fingerprint(*parts: object) -> str:
    return hashlib.sha256("|".join(map(str, (FORMAT_VERSION, *parts))).encode()).hexdigest()[:16]


class CachedArtifact:
    """One named artifact with a fast disk-backed lifecycle (see module docstring)."""

    def __init__(
        self,
        name: str,
        conn: sqlite3.Connection,
        fingerprint_fn: Callable[[sqlite3.Connection], str],
        build_fn: Callable[[sqlite3.Connection], Dict[str, np.ndarray]],
        decode_fn: Callable[[Dict[str, np.ndarray]], object],
    ):
        self.name = name
        self._fingerprint_fn = fingerprint_fn
        self._build_fn = build_fn
        self._decode_fn = decode_fn
        self._db = db_file(conn)
        self._inline_conn = conn if self._db is None else None
        stem = Path(self._db).stem if self._db else None
        self._path = CACHE_DIR / f"{stem}-{name}.npz" if stem else None
        self._lock = threading.Lock()
        self._started = False
        self._building = False
        self.value: object = None

    @property
    def building(self) -> bool:
        return self._building

    def get(self) -> object:
        """The decoded artifact, or None while it is still being built."""
        if self.value is not None:
            return self.value
        with self._lock:
            if not self._started:
                self._started = True
                self._start()
        return self.value

    def _start(self) -> None:
        saved = self._load()
        if saved is not None:
            self.value = self._decode_fn(saved)
            current = self._current_fingerprint()
            if str(saved["fingerprint"]) != current:
                print(f"[engine] {self.name}: serving saved copy, rebuilding in background")
                self._rebuild_async()
            return
        if self._inline_conn is not None:
            self._build_now(self._inline_conn)
        else:
            print(f"[engine] {self.name}: no saved copy, building in background")
            self._rebuild_async()

    def _current_fingerprint(self) -> str:
        conn = self._inline_conn or open_readonly(self._db)
        try:
            return self._fingerprint_fn(conn)
        finally:
            if self._inline_conn is None:
                conn.close()

    def _load(self) -> Optional[Dict[str, np.ndarray]]:
        if self._path is None or not self._path.exists():
            return None
        try:
            with np.load(self._path, allow_pickle=False) as data:
                return {k: data[k] for k in data.files}
        except Exception as exc:  # corrupt or half-written file
            print(f"[engine] {self.name}: ignoring unreadable cache ({exc})")
            return None

    def _rebuild_async(self) -> None:
        if self._building:
            return
        self._building = True
        threading.Thread(target=self._build_in_thread, daemon=True, name=f"engine-{self.name}").start()

    def _build_in_thread(self) -> None:
        conn = open_readonly(self._db)
        try:
            self._build_now(conn)
        except Exception as exc:
            print(f"[engine] {self.name}: background build failed: {exc}")
        finally:
            conn.close()
            self._building = False

    def _build_now(self, conn: sqlite3.Connection) -> None:
        t0 = time.time()
        fp = self._fingerprint_fn(conn)
        arrays = self._build_fn(conn)
        arrays["fingerprint"] = np.array(fp)
        if self._path is not None:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_name(f"{self._path.stem}.{os.getpid()}.tmp.npz")  # unique per process
            np.savez(tmp, **arrays)
            os.replace(tmp, self._path)  # readers never see a partial file
        self.value = self._decode_fn(arrays)
        print(f"[engine] {self.name}: built in {time.time() - t0:.0f}s")
