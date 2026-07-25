import sqlite3
import re
from typing import Dict, Any, List

class EvidenceExplainer:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def explain_recommendation(
        self,
        seed_id: int,
        target_id: int,
        rrf_score: float,
        channel_ranks: Dict[str, int]
    ) -> Dict[str, Any]:
        cur = self.conn.cursor()

        # Target novel metadata
        cur.execute("""
            SELECT title, rating, rating_votes, reading_list_count, status_trans,
                   chapters_trans, author, cover_url, slug, language
            FROM novels WHERE id = ?
        """, (target_id,))
        t_row = cur.fetchone()
        if not t_row:
            return {}

        (
            title, rating, rating_votes, rlist_count, status_trans,
            chapters_trans, author, cover_url, slug, language
        ) = t_row

        # Shared tags
        cur.execute("""
            SELECT t.name FROM tags t
            JOIN novel_tags nt1 ON t.id = nt1.tag_id AND nt1.novel_id = ?
            JOIN novel_tags nt2 ON t.id = nt2.tag_id AND nt2.novel_id = ?
        """, (seed_id, target_id))
        shared_tags = [r[0] for r in cur.fetchall()]

        # Direct rec link
        cur.execute("""
            SELECT votes, is_mutual FROM direct_recs
            WHERE (source_novel_id = ? AND target_novel_id = ?)
               OR (source_novel_id = ? AND target_novel_id = ?)
        """, (seed_id, target_id, target_id, seed_id))
        rec_row = cur.fetchone()
        direct_rec_info = None
        if rec_row:
            direct_rec_info = {
                'is_mutual': bool(rec_row[1]),
                'votes': rec_row[0]
            }

        # Co-occurring rec lists
        cur.execute("""
            SELECT rl.id, rl.title, rli.comment
            FROM rec_lists rl
            JOIN rec_list_items rli1 ON rl.id = rli1.list_id AND rli1.novel_id = ?
            JOIN rec_list_items rli2 ON rl.id = rli2.list_id AND rli2.novel_id = ?
            JOIN rec_list_items rli ON rl.id = rli.list_id AND rli.novel_id = ?
        """, (seed_id, target_id, target_id))
        co_lists = []
        for l_id, l_title, comment in cur.fetchall():
            co_lists.append({
                'list_id': l_id,
                'title': (
                    None
                    if not l_title or re.fullmatch(
                        rf"Novel Updates List\s+{l_id}", l_title, re.I
                    )
                    else l_title
                ),
                'comment': comment
            })

        evidence_bullets = []
        if 'vector' in channel_ranks:
            evidence_bullets.append(f"Premise similarity rank #{channel_ranks['vector']}")
        if shared_tags:
            evidence_bullets.append(f"Shared key tropes ({len(shared_tags)}): {', '.join(shared_tags[:5])}")
        if direct_rec_info:
            mutual_str = "Mutual" if direct_rec_info['is_mutual'] else "One-way"
            evidence_bullets.append(f"{mutual_str} human recommendation ({direct_rec_info['votes']} votes)")
        if co_lists:
            named = next((item for item in co_lists if item["title"]), None)
            if named:
                evidence_bullets.append(
                    f"Co-occurs on {len(co_lists)} curated list(s) including "
                    f"'{named['title']}'"
                )
            else:
                evidence_bullets.append(
                    f"Co-occurs on {len(co_lists)} curated list(s); "
                    "list titles are unavailable in this snapshot"
                )
            if co_lists[0]['comment']:
                evidence_bullets.append(f"Curator comment: \"{co_lists[0]['comment'][:120]}\"")

        return {
            'target_id': target_id,
            'title': title,
            'novelupdates_url': f"https://www.novelupdates.com/?p={target_id}",
            'author': author,
            'cover_url': cover_url,
            'slug': slug,
            'language': language,
            'rating': rating,
            'rating_votes': rating_votes,
            'reading_list_count': rlist_count,
            'status_trans': status_trans,
            'chapters_trans': chapters_trans,
            'rrf_score': round(rrf_score, 4),
            'channel_ranks': channel_ranks,
            'shared_tags': shared_tags,
            'curated_lists': [
                {"id": item["list_id"], "title": item["title"]}
                for item in co_lists
            ],
            'evidence_bullets': evidence_bullets
        }
