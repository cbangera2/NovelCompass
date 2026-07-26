import math
import sqlite3
from typing import Dict, List, Set, Tuple
from src.nlp.taxonomy import calculate_tag_idf, weighted_tag_similarity
from src.nlp.embedder import SynopsisEmbedder

class CandidateGenerator:
    def __init__(self, conn: sqlite3.Connection, embedder: SynopsisEmbedder = None):
        self.conn = conn
        self.embedder = embedder or SynopsisEmbedder()
        self._idf_dict = None
        self._novel_tags_map = None
        self._vector_cache = None

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
        if self._vector_cache is None:
            cur = self.conn.cursor()
            cur.execute("SELECT id, title, synopsis FROM novels WHERE synopsis IS NOT NULL AND synopsis != '' ORDER BY id")
            candidates = cur.fetchall()
            if not candidates:
                self._vector_cache = ([], {}, None)
            else:
                c_ids = [c[0] for c in candidates]
                id_to_idx = {cid: i for i, cid in enumerate(c_ids)}
                c_texts = [self.embedder.construct_text(c[1], c[2]) for c in candidates]
                vectors = self.embedder.encode(c_texts)
                self._vector_cache = (c_ids, id_to_idx, vectors)
        return self._vector_cache

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
