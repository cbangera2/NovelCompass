"""EASE (Embarrassingly Shallow Autoencoder) item-item model over curated-list membership.

Each recommendation list acts as a pseudo-user and its members as the items that
user liked. EASE learns a closed-form item-item weight matrix B that, unlike raw
co-occurrence, discounts items that merely co-occur because they are popular.
"""
import sqlite3
from typing import Dict, List, Tuple

import numpy as np
from scipy import sparse

from src.engine.artifacts import CachedArtifact, fingerprint


TOP_K = 200  # neighbours kept per item; callers ask for at most ~150


def _fingerprint(conn: sqlite3.Connection, min_item_lists: int, min_list_items: int, reg: float) -> str:
    count, mix = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(list_id * 1000003 + novel_id), 0) FROM rec_list_items"
    ).fetchone()
    return fingerprint("ease", count, mix, min_item_lists, min_list_items, reg)


def _fit_topk(conn: sqlite3.Connection, min_item_lists: int, min_list_items: int, reg: float) -> Dict[str, np.ndarray]:
    """Fit EASE and keep only each item's strongest positive neighbours (the dense matrix is discarded)."""
    rows = conn.execute("SELECT list_id, novel_id FROM rec_list_items").fetchall()
    list_counts: Dict[int, int] = {}
    item_counts: Dict[int, int] = {}
    for lid, nid in rows:
        list_counts[lid] = list_counts.get(lid, 0) + 1
        item_counts[nid] = item_counts.get(nid, 0) + 1
    items = sorted(n for n, c in item_counts.items() if c >= min_item_lists)
    item_index = {n: i for i, n in enumerate(items)}
    list_index: Dict[int, int] = {}
    r, c = [], []
    for lid, nid in rows:
        if nid not in item_index or list_counts[lid] < min_list_items:
            continue
        r.append(list_index.setdefault(lid, len(list_index)))
        c.append(item_index[nid])
    X = sparse.csr_matrix((np.ones(len(r), dtype=np.float32), (r, c)), shape=(len(list_index), len(items)))
    G = (X.T @ X).toarray().astype(np.float32)
    G[np.diag_indices_from(G)] += reg
    P = np.linalg.inv(G)
    del G
    B = P / (-np.diag(P))
    del P
    B[np.diag_indices_from(B)] = 0.0
    k = min(TOP_K, len(items) - 1)
    top = np.argpartition(-B, k, axis=1)[:, :k]
    vals = np.take_along_axis(B, top, axis=1)
    order = np.argsort(-vals, axis=1)
    return {
        "item_ids": np.array(items, dtype=np.int64),
        "neighbor_idx": np.take_along_axis(top, order, axis=1).astype(np.int32),
        "neighbor_val": np.take_along_axis(vals, order, axis=1).astype(np.float32),
    }


class EASEModel:
    """Item-item neighbours learned from list membership, served from a disk-cached artifact."""

    def __init__(self, conn: sqlite3.Connection, min_item_lists: int = 3, min_list_items: int = 2, reg: float = 500.0):
        self._artifact = CachedArtifact(
            "ease",
            conn,
            lambda c: _fingerprint(c, min_item_lists, min_list_items, reg),
            lambda c: _fit_topk(c, min_item_lists, min_list_items, reg),
            self._decode,
        )

    @staticmethod
    def _decode(arrays: Dict[str, np.ndarray]):
        ids = arrays["item_ids"]
        return ids, {int(n): i for i, n in enumerate(ids)}, arrays["neighbor_idx"], arrays["neighbor_val"]

    @property
    def ready(self) -> bool:
        return self._artifact.value is not None

    def candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        model = self._artifact.get()
        if model is None:  # still building: contribute nothing rather than make the request wait
            return []
        ids, index, neighbor_idx, neighbor_val = model
        row = index.get(seed_id)
        if row is None:
            return []
        return [
            (int(ids[j]), float(v))
            for j, v in zip(neighbor_idx[row][:limit], neighbor_val[row][:limit])
            if v > 0
        ]
