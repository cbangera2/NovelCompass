import sqlite3
from typing import Dict, Any, List, Set

class HardFilterEngine:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def get_novel_filter_traits(self, novel_id: int) -> Dict[str, Any]:
        cur = self.conn.cursor()

        # Tags
        cur.execute("""
            SELECT LOWER(t.name) FROM tags t
            JOIN novel_tags nt ON t.id = nt.tag_id
            WHERE nt.novel_id = ?
        """, (novel_id,))
        tags = {row[0] for row in cur.fetchall()}

        # Genres
        cur.execute("""
            SELECT LOWER(g.name) FROM genres g
            JOIN novel_genres ng ON g.id = ng.genre_id
            WHERE ng.novel_id = ?
        """, (novel_id,))
        genres = {row[0] for row in cur.fetchall()}

        # Novel info
        cur.execute(
            """SELECT status_trans, chapters_trans, language, rating,
                      rating_votes, reading_list_count, year
               FROM novels WHERE id = ?""",
            (novel_id,),
        )
        row = cur.fetchone()
        status_trans = row[0] if row else ""
        chapters_trans = row[1] if row else 0
        language = row[2] if row else ""
        rating = row[3] if row else 0.0
        rating_votes = row[4] if row else 0
        reading_list_count = row[5] if row else 0
        year = row[6] if row else 0

        return {
            'tags': tags,
            'genres': genres,
            'status_trans': status_trans or "",
            'chapters_trans': chapters_trans or 0,
            'language': language or "",
            'rating': rating or 0.0,
            'rating_votes': rating_votes or 0,
            'reading_list_count': reading_list_count or 0,
            'year': year or 0,
        }

    def filter_candidates(self, candidate_ids: List[int], preferences: Dict[str, Any]) -> List[int]:
        """
        Applies Hard Boolean Exclusion Filters.
        preferences format:
        {
            'exclude_tags': {'harem', 'yaoi', 'yuri', 'bl', 'gore', 'netorare'},
            'require_completed': False,
            'min_chapters': 0,
            'exclude_novel_ids': {123, 456}
        }
        """
        exclude_tags = {t.lower() for t in preferences.get('exclude_tags', [])}
        include_tags = {t.lower() for t in preferences.get('include_tags', [])}
        include_genres = {g.lower() for g in preferences.get('include_genres', [])}
        exclude_genres = {g.lower() for g in preferences.get('exclude_genres', [])}
        required_language = preferences.get('language', '').strip().lower()
        min_rating = float(preferences.get('min_rating', 0) or 0)
        min_rating_votes = int(preferences.get('min_rating_votes', 0) or 0)
        max_readers = int(preferences.get('max_readers', 0) or 0)
        min_year = int(preferences.get('min_year', 0) or 0)
        max_year = int(preferences.get('max_year', 0) or 0)
        require_completed = preferences.get('require_completed', False)
        min_chapters = preferences.get('min_chapters', 0)
        exclude_ids = set(preferences.get('exclude_novel_ids', []))

        valid_candidates = []

        for nid in candidate_ids:
            if nid in exclude_ids:
                continue

            traits = self.get_novel_filter_traits(nid)
            all_tags_genres = traits['tags'].union(traits['genres'])

            # 1. Exclusion check
            if exclude_tags.intersection(all_tags_genres):
                continue
            if include_tags and not include_tags.issubset(traits['tags']):
                continue
            if include_genres and not include_genres.issubset(traits['genres']):
                continue
            if exclude_genres.intersection(traits['genres']):
                continue

            # 2. Language and quality checks
            if required_language and traits['language'].lower() != required_language:
                continue
            if traits['rating'] < min_rating:
                continue
            if traits['rating_votes'] < min_rating_votes:
                continue
            if max_readers and traits['reading_list_count'] > max_readers:
                continue
            if min_year and traits['year'] < min_year:
                continue
            if max_year and traits['year'] > max_year:
                continue

            # 3. Completion check
            if require_completed and "complete" not in traits['status_trans'].lower():
                continue

            # 4. Minimum chapter check
            if traits['chapters_trans'] < min_chapters:
                continue

            valid_candidates.append(nid)

        return valid_candidates
