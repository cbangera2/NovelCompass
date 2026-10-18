import math
import sqlite3
import threading
from typing import Dict, List, Set, Tuple
import numpy as np
from src.nlp.taxonomy import calculate_tag_idf, weighted_tag_similarity
from src.nlp.embedder import DEFAULT_MODEL_NAME, SynopsisEmbedder
from src.engine.artifacts import CachedArtifact, fingerprint
from src.engine.ease import EASEModel

# Heavy per-catalog state (tag maps, embeddings, EASE neighbours) is shared by every
# CandidateGenerator on the same database so API requests don't rebuild it. The
# embeddings and EASE neighbours are additionally cached on disk (see artifacts.py).
# It is keyed by database path and lives until the process restarts.
_SHARED_STATE: Dict[object, Dict[str, object]] = {}
_SHARED_LOCK = threading.RLock()


def _state_key(conn: sqlite3.Connection):
    for _seq, name, path in conn.execute("PRAGMA database_list"):
        if name == "main" and path:
            return path
    return id(conn)  # in-memory database: scope to this connection


def _shared_property(name: str):
    return property(
        lambda self: self._state.get(name),
        lambda self, value: self._state.__setitem__(name, value),
    )


def _vector_fingerprint(conn: sqlite3.Connection) -> str:
    novels, newest = conn.execute("SELECT COUNT(*), COALESCE(MAX(updated_at), '') FROM novels").fetchone()
    tags = conn.execute("SELECT COUNT(*) FROM novel_tags").fetchone()[0]
    genres = conn.execute("SELECT COUNT(*) FROM novel_genres").fetchone()[0]
    return fingerprint("vectors", DEFAULT_MODEL_NAME, novels, newest, tags, genres)


def _build_vectors(conn: sqlite3.Connection, embedder: SynopsisEmbedder) -> Dict[str, np.ndarray]:
    """Embed title + genres + tags + synopsis for every title (most have no synopsis, so
    without tags/genres the vector channel cannot see ~80% of the catalog)."""
    cur = conn.cursor()
    idf = calculate_tag_idf(conn)
    tags_map: Dict[int, Set[str]] = {}
    cur.execute("SELECT nt.novel_id, t.name FROM novel_tags nt JOIN tags t ON t.id = nt.tag_id")
    for nid, tname in cur.fetchall():
        tags_map.setdefault(nid, set()).add(tname.lower())
    genres_map: Dict[int, List[str]] = {}
    cur.execute("SELECT ng.novel_id, g.name FROM novel_genres ng JOIN genres g ON g.id = ng.genre_id")
    for nid, gname in cur.fetchall():
        genres_map.setdefault(nid, []).append(gname)
    candidates = [c for c in cur.execute("SELECT id, title, synopsis FROM novels ORDER BY id").fetchall()
                  if c[2] or tags_map.get(c[0]) or genres_map.get(c[0])]
    if not candidates:
        return {"ids": np.zeros(0, dtype=np.int64), "vectors": np.zeros((0, 1), dtype=np.float16)}
    texts = [
        embedder.construct_text(
            c[1],
            c[2],
            # Rarest (most specific) tags first; construct_text keeps the top 10.
            sorted(tags_map.get(c[0], ()), key=lambda t: -idf.get(t, 1.0)),
            sorted(genres_map.get(c[0], ())),
        )
        for c in candidates
    ]
    return {
        "ids": np.array([c[0] for c in candidates], dtype=np.int64),
        "vectors": embedder.encode(texts).astype(np.float16),  # unit vectors; fp16 halves the file
    }


def _decode_vectors(arrays: Dict[str, np.ndarray]):
    ids = arrays["ids"]
    if len(ids) == 0:
        return [], {}, None
    id_list = [int(i) for i in ids]
    return id_list, {n: i for i, n in enumerate(id_list)}, arrays["vectors"].astype(np.float32)


class CandidateGenerator:
    _vector_artifact = _shared_property("vector_artifact")
    _idf_dict = _shared_property("idf")
    _novel_tags_map = _shared_property("tags")
    _ease = _shared_property("ease")

    def __init__(self, conn: sqlite3.Connection, embedder: SynopsisEmbedder = None):
        self.conn = conn
        self.embedder = embedder or SynopsisEmbedder()
        with _SHARED_LOCK:
            self._state = _SHARED_STATE.setdefault(_state_key(conn), {})

    def _get_idf_dict(self) -> Dict[str, float]:
        if self._idf_dict is None:
            self._idf_dict = calculate_tag_idf(self.conn)
        return self._idf_dict

    def _get_novel_tags_map(self) -> Dict[int, Set[str]]:
        if self._novel_tags_map is None:
            cur = self.conn.cursor()
            cur.execute("""
                SELECT nt.novel_id, t.name FROM novel_tags nt
                JOIN tags t ON t.id = nt.tag_id
            """)
            m: Dict[int, Set[str]] = {}
            for nid, tname in cur.fetchall():
                if nid not in m:
                    m[nid] = set()
                m[nid].add(tname.lower())
            self._novel_tags_map = m
        return self._novel_tags_map

    def _get_vector_data(self):
        """(ids, id->row, unit vectors); an empty result while the embeddings are still being built."""
        with _SHARED_LOCK:
            if self._vector_artifact is None:
                self._vector_artifact = CachedArtifact(
                    "vectors",
                    self.conn,
                    _vector_fingerprint,
                    lambda conn: _build_vectors(conn, self.embedder),
                    _decode_vectors,
                )
            artifact = self._vector_artifact
        return artifact.get() or ([], {}, None)

    def get_candidate_channels(self, seed_novel_id: int, limit_per_channel: int = 150, conn: sqlite3.Connection = None) -> Dict[str, List[Tuple[int, float]]]:
        """
        Returns candidates for each of the 5 channels:
        Channel -> List of (novel_id, channel_score) sorted descending
        """
        active_conn = conn or self.conn
        channels = {}

        # 1. Vector Channel (in-memory)
        channels['vector'] = self._get_vector_candidates(seed_novel_id, limit=limit_per_channel)

        # 2. Tag Channel (in-memory)
        channels['tag'] = self._get_tag_candidates(seed_novel_id, limit=limit_per_channel)

        # 3. Direct Recommendation Graph Channel
        channels['direct_rec'] = self._get_direct_rec_candidates(seed_novel_id, limit=limit_per_channel, conn=active_conn)

        # 4. Recommendation List Co-occurrence Channel
        channels['rec_list'] = self._get_rec_list_candidates(seed_novel_id, limit=limit_per_channel, conn=active_conn)

        # 5. Structural Channel (Same Author / Related Series)
        channels['structural'] = self._get_structural_candidates(seed_novel_id, limit=limit_per_channel, conn=active_conn)

        # 6. EASE item-item model over list membership
        with _SHARED_LOCK:
            if self._ease is None:
                self._ease = EASEModel(self.conn)
        channels['ease'] = self._ease.candidates(seed_novel_id, limit_per_channel)

        return channels

    def _get_vector_candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        c_ids, id_to_idx, vectors = self._get_vector_data()
        if vectors is None or seed_id not in id_to_idx:
            return []

        seed_idx = id_to_idx[seed_id]
        seed_vec = vectors[seed_idx]

        sims = vectors.dot(seed_vec)
        
        # Sort top indices using argpartition for O(N) selection
        # Mask out seed_idx so seed novel is not returned as its own candidate
        sims_copy = sims.copy()
        sims_copy[seed_idx] = -1.0
        
        if len(sims_copy) > limit:
            top_part = np.argpartition(-sims_copy, limit)[:limit]
            top_indices = top_part[np.argsort(-sims_copy[top_part])]
        else:
            top_indices = np.argsort(-sims_copy)

        scored = [(c_ids[i], float(sims_copy[i])) for i in top_indices if sims_copy[i] > 0]
        return scored

    def _get_tag_candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        idf_dict = self._get_idf_dict()
        novel_tags_map = self._get_novel_tags_map()

        seed_tags = novel_tags_map.get(seed_id)
        if not seed_tags:
            return []

        scored = []
        for nid, tags in novel_tags_map.items():
            if nid == seed_id:
                continue
            intersection = seed_tags.intersection(tags)
            if not intersection:
                continue
            union = seed_tags.union(tags)
            intersection_weight = sum(idf_dict.get(t, 1.0) for t in intersection)
            union_weight = sum(idf_dict.get(t, 1.0) for t in union)
            sim = intersection_weight / union_weight if union_weight > 0 else 0.0
            if sim > 0:
                scored.append((nid, sim))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:limit]

    def _get_direct_rec_candidates(self, seed_id: int, limit: int, conn: sqlite3.Connection = None) -> List[Tuple[int, float]]:
        active_conn = conn or self.conn
        cur = active_conn.cursor()
        cur.execute("""
            SELECT target_novel_id, votes, is_mutual FROM direct_recs
            WHERE source_novel_id = ?
            UNION
            SELECT source_novel_id, votes, is_mutual FROM direct_recs
            WHERE target_novel_id = ?
        """, (seed_id, seed_id))

        scored = []
        for target_id, votes, is_mutual in cur.fetchall():
            vote_factor = 1.0 + math.log(1.0 + max(0, votes or 0))
            score = (1.5 if is_mutual else 1.0) * vote_factor
            scored.append((target_id, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:limit]

    def _get_rec_list_candidates(self, seed_id: int, limit: int, conn: sqlite3.Connection = None) -> List[Tuple[int, float]]:
        active_conn = conn or self.conn
        cur = active_conn.cursor()
        cur.execute("SELECT list_id FROM rec_list_items WHERE novel_id = ?", (seed_id,))
        list_ids = [r[0] for r in cur.fetchall()]
        if not list_ids:
            return []

        cur.execute(f"""
            SELECT novel_id, COUNT(list_id) as co_occur
            FROM rec_list_items
            WHERE list_id IN ({','.join(['?']*len(list_ids))}) AND novel_id != ?
            GROUP BY novel_id
            ORDER BY co_occur DESC
        """, (*list_ids, seed_id))

        scored = [(row[0], float(row[1])) for row in cur.fetchall()]
        return scored[:limit]

    def _get_structural_candidates(self, seed_id: int, limit: int, conn: sqlite3.Connection = None) -> List[Tuple[int, float]]:
        active_conn = conn or self.conn
        cur = active_conn.cursor()
        cur.execute("SELECT author FROM novels WHERE id = ?", (seed_id,))
        row = cur.fetchone()
        author = row[0] if row else ""

        scored = []
        if author:
            cur.execute("SELECT id FROM novels WHERE author = ? AND id != ?", (author, seed_id))
            for nid in cur.fetchall():
                scored.append((nid[0], 2.0))

        cur.execute("""
            SELECT target_novel_id FROM related_series WHERE source_novel_id = ?
            UNION
            SELECT source_novel_id FROM related_series WHERE target_novel_id = ?
        """, (seed_id, seed_id))
        for rel_id in cur.fetchall():
            scored.append((rel_id[0], 1.5))

        return scored[:limit]
