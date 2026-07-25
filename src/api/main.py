import os
import json
import sqlite3
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.db.schema import init_db
from src.engine.candidate_gen import CandidateGenerator
from src.engine.filters import HardFilterEngine
from src.engine.rrf_ranker import (
    DEFAULT_CHANNEL_WEIGHTS,
    calculate_rrf_scores,
    apply_hidden_gem_boost,
)
from src.engine.explainer import EvidenceExplainer
from src.scraper.seed_loader import seed_database_from_dataset

app = FastAPI(title="Novel Updates Recommender API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    return init_db()


def novelupdates_url(novel_id: int, slug: Optional[str]) -> str:
    """Use Novel Updates' stable WordPress ID URL.

    Snapshot slugs are derived locally and can differ from the live canonical
    slug. Novel Updates redirects this numeric URL to the current series URL.
    """
    return f"https://www.novelupdates.com/?p={novel_id}"


def parse_associated_names(value: Optional[str]) -> List[str]:
    if not value:
        return []
    try:
        decoded = json.loads(value)
        if isinstance(decoded, list):
            return [str(name).strip() for name in decoded if str(name).strip()]
    except (json.JSONDecodeError, TypeError):
        pass
    return [
        name.strip()
        for name in value.replace("\r", "\n").split("\n")
        if name.strip()
    ]


@app.on_event("startup")
def bootstrap_catalog():
    conn = get_db()
    try:
        count = conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0]
        if count == 0:
            seed_database_from_dataset(conn)
    finally:
        conn.close()


@app.get("/api/health")
def health():
    conn = get_db()
    try:
        novel_count = conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0]
        return {"status": "ok" if novel_count else "empty", "novel_count": novel_count}
    finally:
        conn.close()

class RecommendRequest(BaseModel):
    query: str
    limit: int = 20
    hidden_gem_mode: bool = False
    exclude_harem: bool = False
    exclude_bl: bool = False
    exclude_yuri: bool = False
    language: str = ""
    min_rating: float = 0.0
    min_rating_votes: int = 0
    max_readers: int = 0
    min_year: int = 0
    max_year: int = 0
    include_genres: List[str] = Field(default_factory=list)
    exclude_genres: List[str] = Field(default_factory=list)
    include_tags: List[str] = Field(default_factory=list)
    exclude_tags: List[str] = Field(default_factory=list)
    channel_weights: Dict[str, float] = Field(default_factory=dict)
    hidden_gem_strength: float = 0.3
    min_chapters: int = 0
    require_completed: bool = False

@app.get("/api/search")
def search_novels(q: str = Query(..., min_length=1), limit: int = 10):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, title, slug, author, cover_url, rating, rating_votes
            FROM novels
            WHERE title LIKE ? OR slug LIKE ? OR associated_names LIKE ?
            ORDER BY reading_list_count DESC, rating_votes DESC
            LIMIT ?
        """, (f"%{q}%", f"%{q}%", f"%{q}%", limit))

        results = []
        for row in cur.fetchall():
            results.append({
                "id": row[0],
                "title": row[1],
                "slug": row[2],
                "novelupdates_url": novelupdates_url(row[0], row[2]),
                "author": row[3],
                "cover_url": row[4],
                "rating": row[5],
                "rating_votes": row[6]
            })

        return {"query": q, "results": results}
    finally:
        conn.close()


@app.get("/api/novels/{novel_id}")
def get_novel_detail(novel_id: int):
    conn = get_db()
    try:
        row = conn.execute("""
            SELECT id, title, slug, associated_names, author, language, synopsis,
                   rating, rating_votes, reading_list_count, chapters_orig,
                   chapters_trans, status_trans, year, cover_url
            FROM novels
            WHERE id = ?
        """, (novel_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Novel {novel_id} not found.")

        genres = [
            genre_row[0] for genre_row in conn.execute("""
                SELECT g.name
                FROM genres g
                JOIN novel_genres ng ON ng.genre_id = g.id
                WHERE ng.novel_id = ?
                ORDER BY g.name
            """, (novel_id,))
        ]
        tags = [
            tag_row[0] for tag_row in conn.execute("""
                SELECT t.name
                FROM tags t
                JOIN novel_tags nt ON nt.tag_id = t.id
                WHERE nt.novel_id = ?
                ORDER BY t.name
            """, (novel_id,))
        ]
        counts = conn.execute("""
            SELECT
                (SELECT COUNT(*) FROM direct_recs
                 WHERE source_novel_id = ? OR target_novel_id = ?),
                (SELECT COUNT(*) FROM related_series
                 WHERE source_novel_id = ? OR target_novel_id = ?),
                (SELECT COUNT(*) FROM rec_list_items WHERE novel_id = ?)
        """, (novel_id, novel_id, novel_id, novel_id, novel_id)).fetchone()

        return {
            "id": row["id"],
            "title": row["title"],
            "slug": row["slug"],
            "associated_names": parse_associated_names(row["associated_names"]),
            "author": row["author"],
            "language": row["language"],
            "synopsis": row["synopsis"],
            "rating": row["rating"],
            "rating_votes": row["rating_votes"],
            "reading_list_count": row["reading_list_count"],
            "chapters_orig": row["chapters_orig"],
            "chapters_trans": row["chapters_trans"],
            "status_trans": row["status_trans"],
            "year": row["year"],
            "cover_url": row["cover_url"],
            "genres": genres,
            "tags": tags,
            "novelupdates_url": novelupdates_url(row["id"], row["slug"]),
            "direct_recommendation_count": counts[0],
            "related_series_count": counts[1],
            "recommendation_list_count": counts[2],
        }
    finally:
        conn.close()


@app.get("/api/options")
def recommendation_options():
    conn = get_db()
    try:
        genres = [
            row[0] for row in conn.execute("""
                SELECT name FROM genres
                ORDER BY name
            """)
        ]
        popular_tags = [
            row[0] for row in conn.execute("""
                SELECT t.name
                FROM tags t
                JOIN novel_tags nt ON nt.tag_id = t.id
                GROUP BY t.id
                ORDER BY COUNT(*) DESC, t.name
                LIMIT 100
            """)
        ]
        languages = [
            row[0] for row in conn.execute("""
                SELECT language FROM novels
                WHERE language != ''
                GROUP BY language
                ORDER BY COUNT(*) DESC
            """)
        ]
        return {"genres": genres, "popular_tags": popular_tags, "languages": languages}
    finally:
        conn.close()


@app.post("/api/recommend")
def get_recommendations(req: RecommendRequest):
    conn = get_db()
    try:
        return _get_recommendations(conn, req)
    finally:
        conn.close()


def _get_recommendations(conn: sqlite3.Connection, req: RecommendRequest):
    cur = conn.cursor()

    # Find seed novel
    if req.query.isdigit():
        cur.execute("SELECT id, title, slug, cover_url FROM novels WHERE id = ?", (int(req.query),))
    else:
        cur.execute("SELECT id, title, slug, cover_url FROM novels WHERE title LIKE ? OR slug LIKE ? ORDER BY reading_list_count DESC LIMIT 1", (f"%{req.query}%", f"%{req.query}%"))

    seed_row = cur.fetchone()
    if not seed_row:
        raise HTTPException(status_code=404, detail=f"Novel matching '{req.query}' not found.")

    seed_id = seed_row[0]
    seed_title = seed_row[1]

    # Candidate generation
    cand_gen = CandidateGenerator(conn)
    channels = cand_gen.get_candidate_channels(seed_id, limit_per_channel=150)

    # Filter candidates
    filter_engine = HardFilterEngine(conn)
    exclude_tags = []
    if req.exclude_harem:
        exclude_tags.extend(['harem', 'reverse harem'])
    if req.exclude_bl:
        exclude_tags.extend(['yaoi', 'bl', 'boys love', 'shounen ai'])
    if req.exclude_yuri:
        exclude_tags.extend(['yuri', 'shoujo ai'])
    exclude_tags.extend(req.exclude_tags)

    preferences = {
        'exclude_tags': exclude_tags,
        'include_tags': req.include_tags,
        'include_genres': req.include_genres,
        'exclude_genres': req.exclude_genres,
        'language': req.language,
        'min_rating': req.min_rating,
        'min_rating_votes': req.min_rating_votes,
        'max_readers': req.max_readers,
        'min_year': req.min_year,
        'max_year': req.max_year,
        'require_completed': req.require_completed,
        'min_chapters': req.min_chapters,
        'exclude_novel_ids': [seed_id]
    }

    all_cand_ids = set()
    for ch_cands in channels.values():
        for nid, _ in ch_cands:
            all_cand_ids.add(nid)

    valid_cand_ids = filter_engine.filter_candidates(list(all_cand_ids), preferences)

    # RRF Scoring
    filtered_channels = {}
    for ch_name, cands in channels.items():
        filtered_channels[ch_name] = [(nid, sc) for nid, sc in cands if nid in valid_cand_ids]

    channel_weights = {
        key: max(0.0, min(3.0, value))
        for key, value in req.channel_weights.items()
        if key in {'vector', 'tag', 'direct_rec', 'rec_list', 'structural'}
    }
    rrf_scores = calculate_rrf_scores(
        filtered_channels,
        channel_weights=channel_weights or None,
    )
    effective_weights = channel_weights or DEFAULT_CHANNEL_WEIGHTS
    theoretical_max = sum(
        effective_weights.get(channel_name, 1.0) / 61
        for channel_name, candidates in filtered_channels.items()
        if candidates
    )

    # Apply Hidden Gem Boost if enabled
    final_scores = {}
    for nid, score in rrf_scores.items():
        cur.execute("SELECT reading_list_count FROM novels WHERE id = ?", (nid,))
        r_row = cur.fetchone()
        rlist_cnt = r_row[0] if r_row else 0
        if req.hidden_gem_mode:
            final_scores[nid] = apply_hidden_gem_boost(
                score,
                rlist_cnt,
                gamma=max(0.0, min(1.0, req.hidden_gem_strength)),
            )
        else:
            final_scores[nid] = score

    sorted_recs = sorted(final_scores.items(), key=lambda x: x[1], reverse=True)[:req.limit]

    # Format recommendations with evidence
    explainer = EvidenceExplainer(conn)
    recommendations = []
    for nid, score in sorted_recs:
        ch_ranks = {}
        for ch_name, cands in channels.items():
            for r_idx, (cand_id, _) in enumerate(cands, 1):
                if cand_id == nid:
                    ch_ranks[ch_name] = r_idx
                    break

        exp = explainer.explain_recommendation(seed_id, nid, score, ch_ranks)
        unboosted_score = rrf_scores.get(nid, 0.0)
        exp["match_score_percent"] = round(
            max(0.0, min(100.0, (unboosted_score / theoretical_max) * 100))
            if theoretical_max
            else 0.0
        )
        recommendations.append(exp)

    return {
        "seed_novel": {
            "id": seed_id,
            "title": seed_title,
            "slug": seed_row[2],
            "novelupdates_url": novelupdates_url(seed_id, seed_row[2]),
            "cover_url": seed_row[3]
        },
        "count": len(recommendations),
        "recommendations": recommendations
    }

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("src.api.main:app", host="127.0.0.1", port=8000, reload=True)
