"""EASE (Embarrassingly Shallow Autoencoder) item-item model over curated-list membership.

Each recommendation list acts as a pseudo-user and its members as the items that
user liked. EASE learns a closed-form item-item weight matrix B that, unlike raw
co-occurrence, discounts items that merely co-occur because they are popular.
"""
import sqlite3
import threading
import time
from typing import Dict, List, Tuple

import numpy as np
from scipy import sparse


class EASEModel:
    def __init__(self, conn: sqlite3.Connection, min_item_lists: int = 3, min_list_items: int = 2, reg: float = 500.0):
        self.conn = conn
        self.min_item_lists = min_item_lists
        self.min_list_items = min_list_items
        self.reg = reg
        self._fitted = False
        self._lock = threading.Lock()
        self.item_ids: List[int] = []
        self.item_index: Dict[int, int] = {}
        self.B: np.ndarray | None = None

    def fit(self) -> None:
        t0 = time.time()
        rows = self.conn.execute("SELECT list_id, novel_id FROM rec_list_items").fetchall()
        list_counts: Dict[int, int] = {}
        item_counts: Dict[int, int] = {}
        for lid, nid in rows:
            list_counts[lid] = list_counts.get(lid, 0) + 1
            item_counts[nid] = item_counts.get(nid, 0) + 1
        items = sorted(n for n, c in item_counts.items() if c >= self.min_item_lists)
        self.item_ids = items
        self.item_index = {n: i for i, n in enumerate(items)}
        list_index: Dict[int, int] = {}
        r, c = [], []
        for lid, nid in rows:
            if nid not in self.item_index or list_counts[lid] < self.min_list_items:
                continue
            r.append(list_index.setdefault(lid, len(list_index)))
            c.append(self.item_index[nid])
        X = sparse.csr_matrix(
            (np.ones(len(r), dtype=np.float32), (r, c)), shape=(len(list_index), len(items))
        )
        G = (X.T @ X).toarray().astype(np.float32)
        G[np.diag_indices_from(G)] += self.reg
        P = np.linalg.inv(G)
        B = P / (-np.diag(P))
        B[np.diag_indices_from(B)] = 0.0
        self.B = B.astype(np.float32)
        self._fitted = True
        print(f"[ease] fit {X.shape[0]} lists x {X.shape[1]} items in {time.time() - t0:.0f}s")

    def candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        with self._lock:
            if not self._fitted:
                self.fit()
        idx = self.item_index.get(seed_id)
        if idx is None:
            return []
        row = self.B[idx]
        top = np.argpartition(-row, min(limit, len(row) - 1))[:limit]
        top = top[np.argsort(-row[top])]
        return [(self.item_ids[i], float(row[i])) for i in top if row[i] > 0]
