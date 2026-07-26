import math
import sqlite3
from typing import Dict, List, Set, Tuple
from src.nlp.taxonomy import calculate_tag_idf, weighted_tag_similarity
from src.nlp.embedder import SynopsisEmbedder

class CandidateGenerator:
    def __init__(self, conn: sqlite3.Connection, embedder: SynopsisEmbedder = None):
        self.conn = conn
        self.embedder = embedder or SynopsisEmbedder()

    def get_candidate_channels(self, seed_novel_id: int, limit_per_channel: int = 150) -> Dict[str, List[Tuple[int, float]]]:
        """
        Returns candidates for each of the 5 channels:
        Channel -> List of (novel_id, channel_score) sorted descending
        """
        channels = {}

        # 1. Vector Channel
        channels['vector'] = self._get_vector_candidates(seed_novel_id, limit=limit_per_channel)

        # 2. Tag Channel
        channels['tag'] = self._get_tag_candidates(seed_novel_id, limit=limit_per_channel)

        # 3. Direct Recommendation Graph Channel
        channels['direct_rec'] = self._get_direct_rec_candidates(seed_novel_id, limit=limit_per_channel)

        # 4. Recommendation List Co-occurrence Channel
        channels['rec_list'] = self._get_rec_list_candidates(seed_novel_id, limit=limit_per_channel)

        # 5. Structural Channel (Same Author / Related Series)
        channels['structural'] = self._get_structural_candidates(seed_novel_id, limit=limit_per_channel)

        return channels

    def _get_vector_candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        cur = self.conn.cursor()
        cur.execute("SELECT id, title, synopsis FROM novels WHERE id = ?", (seed_id,))
        seed_row = cur.fetchone()
        if not seed_row or not seed_row[2]:
            return []

        seed_text = self.embedder.construct_text(seed_row[1], seed_row[2])

        # Load candidate novels
        cur.execute("SELECT id, title, synopsis FROM novels WHERE id != ? AND synopsis IS NOT NULL AND synopsis != ''", (seed_id,))
        candidates = cur.fetchall()
        if not candidates:
            return []

        c_ids = [c[0] for c in candidates]
        c_texts = [self.embedder.construct_text(c[1], c[2]) for c in candidates]

        # Encode the seed and candidates together. This is required for the
        # TF-IDF fallback because separately fitted vocabularies are not
        # comparable, and it also avoids two model calls.
        vectors = self.embedder.encode([seed_text, *c_texts])
        seed_vec = vectors[0]
        cand_vecs = vectors[1:]

        sims = cand_vecs.dot(seed_vec)
        scored = list(zip(c_ids, [float(s) for s in sims]))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:limit]

    def _get_tag_candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        cur = self.conn.cursor()
        idf_dict = calculate_tag_idf(self.conn)

        # Get seed tags
        cur.execute("""
            SELECT t.name FROM tags t
            JOIN novel_tags nt ON t.id = nt.tag_id
            WHERE nt.novel_id = ?
        """, (seed_id,))
        seed_tags = {r[0] for r in cur.fetchall()}
        if not seed_tags:
            return []

        # Get all other novels and their tags
        cur.execute("""
            SELECT nt.novel_id, t.name FROM novel_tags nt
            JOIN tags t ON t.id = nt.tag_id
            WHERE nt.novel_id != ?
        """, (seed_id,))
        novel_tags_map = {}
        for nid, tname in cur.fetchall():
            if nid not in novel_tags_map:
                novel_tags_map[nid] = set()
            novel_tags_map[nid].add(tname)

        scored = []
        for nid, tags in novel_tags_map.items():
            sim = weighted_tag_similarity(seed_tags, tags, idf_dict)
            if sim > 0:
                scored.append((nid, sim))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:limit]

    def _get_direct_rec_candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        cur = self.conn.cursor()
        cur.execute("""
            SELECT target_novel_id, votes, is_mutual FROM direct_recs
            WHERE source_novel_id = ?
            UNION
            SELECT source_novel_id, votes, is_mutual FROM direct_recs
            WHERE target_novel_id = ?
        """, (seed_id, seed_id))

        scored = []
        for target_id, votes, is_mutual in cur.fetchall():
            # Diminishing-returns logarithmic scaling prevents multi-hundred vote platforms
            # from swamping smaller platforms while preserving vote confidence ranking.
            vote_factor = 1.0 + math.log(1.0 + max(0, votes or 0))
            score = (1.5 if is_mutual else 1.0) * vote_factor
            scored.append((target_id, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:limit]

    def _get_rec_list_candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        cur = self.conn.cursor()
        # Find all lists containing seed_id
        cur.execute("SELECT list_id FROM rec_list_items WHERE novel_id = ?", (seed_id,))
        list_ids = [r[0] for r in cur.fetchall()]
        if not list_ids:
            return []

        # Find items co-occurring on these lists
        cur.execute(f"""
            SELECT novel_id, COUNT(list_id) as co_occur
            FROM rec_list_items
            WHERE list_id IN ({','.join(['?']*len(list_ids))}) AND novel_id != ?
            GROUP BY novel_id
            ORDER BY co_occur DESC
        """, (*list_ids, seed_id))

        scored = [(row[0], float(row[1])) for row in cur.fetchall()]
        return scored[:limit]

    def _get_structural_candidates(self, seed_id: int, limit: int) -> List[Tuple[int, float]]:
        cur = self.conn.cursor()
        cur.execute("SELECT author FROM novels WHERE id = ?", (seed_id,))
        row = cur.fetchone()
        author = row[0] if row else ""

        scored = []
        if author:
            cur.execute("SELECT id FROM novels WHERE author = ? AND id != ?", (author, seed_id))
            for nid in cur.fetchall():
                scored.append((nid[0], 2.0)) # Author match score

        cur.execute("""
            SELECT target_novel_id FROM related_series WHERE source_novel_id = ?
            UNION
            SELECT source_novel_id FROM related_series WHERE target_novel_id = ?
        """, (seed_id, seed_id))
        for rel_id in cur.fetchall():
            scored.append((rel_id[0], 1.5)) # Related series score

        return scored[:limit]
