import os
import threading
import json
import hashlib
import re
import sqlite3
import random
import secrets
from typing import List, Dict, Any, Optional, Tuple
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.db.schema import init_db
from src.engine.candidate_gen import CandidateGenerator, _SHARED_LOCK as _engine_lock_obj
from src.scraper.list_import import import_list_pages
from src.engine.filters import HardFilterEngine
from src.engine.rrf_ranker import (
    DEFAULT_CHANNEL_WEIGHTS,
    calculate_rrf_scores,
    apply_hidden_gem_boost,
)
from src.engine.explainer import EvidenceExplainer
from src.engine.ranking_contract import (
    ALGORITHM_VERSION,
    SCHEMA_VERSION,
    calculate_match_percent,
)
from src.scraper.seed_loader import seed_database_from_dataset
from src.api.scraper_dashboard import router as scraper_dashboard_router

app = FastAPI(title="Novel Updates Recommender API", version="1.0.0")
app.include_router(scraper_dashboard_router)

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


def anilist_url(external_id: Optional[str], media_type: Optional[str] = None, novel_id: int = 0) -> str:
    """Build the canonical AniList URL for a media entry."""
    kind = "anime" if (media_type == "anime" or novel_id >= 3_000_000) else "manga"
    return f"https://anilist.co/{kind}/{external_id}"


def media_type_sql_filter(
    media_type: str,
    column: str = "COALESCE(media_type, 'novel')",
) -> tuple[Optional[str], list[Any]]:
    """Parse comma-separated media_type filters into a SQL clause.

    Matches browse/search multi-select behavior used by the web UI, which sends
    values like ``novel,manga,anime`` when multiple catalog media chips are active.
    """
    if not media_type or media_type == "all":
        return None, []
    requested = [t.strip().lower() for t in media_type.split(",") if t.strip()]
    if not requested or "all" in requested:
        return None, []

    conditions: list[str] = []
    params: list[Any] = []
    for t in requested:
        if t == "manga":
            conditions.append(f"{column} IN ('manga', 'manhwa', 'manhua', 'comic')")
        elif t == "novel":
            conditions.append(f"{column} IN ('novel', 'light_novel', 'web_novel')")
        elif t == "anime":
            conditions.append(f"{column} = 'anime'")
        else:
            conditions.append(f"{column} = ?")
            params.append(t)
    if not conditions:
        return None, []
    return f"({' OR '.join(conditions)})", params


def normalize_search_query(query: str) -> str:
    """Lowercase and strip punctuation so ``Too Many Losing Heroines!`` matches aliases."""
    text = (query or "").casefold()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def search_token_clause(column_exprs: list[str], tokens: list[str]) -> tuple[str, list[Any]]:
    """Require every token to appear in at least one of the provided text columns."""
    if not tokens:
        return "1=0", []
    params: list[Any] = []
    token_groups: list[str] = []
    for token in tokens:
        needle = f"%{token}%"
        ors = " OR ".join(f"{expr} LIKE ?" for expr in column_exprs)
        token_groups.append(f"({ors})")
        params.extend([needle] * len(column_exprs))
    return " AND ".join(token_groups), params


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


def get_dataset_version(conn: sqlite3.Connection) -> str:
    """Return a stable content version, with an explicit build override.

    Static builds can set ``NOVEL_DATASET_VERSION`` so their manifest and the
    API advertise the same snapshot identifier. The fallback fingerprint is
    deterministic for the current catalog and relationship-table dimensions.
    """
    override = os.getenv("NOVEL_DATASET_VERSION", "").strip()
    if override:
        return override

    novel_stats = conn.execute(
        "SELECT COUNT(*), COALESCE(MAX(updated_at), ''), COALESCE(MAX(id), 0) FROM novels"
    ).fetchone()
    dimensions = [str(value) for value in novel_stats]
    for table in (
        "tags",
        "novel_tags",
        "genres",
        "novel_genres",
        "direct_recs",
        "related_series",
        "rec_lists",
        "rec_list_items",
    ):
        dimensions.append(str(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]))
    digest = hashlib.sha256("|".join(dimensions).encode("utf-8")).hexdigest()[:12]
    return f"db-{digest}"


@app.on_event("startup")
def bootstrap_catalog():
    conn = get_db()
    try:
        count = conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0]
        if count == 0:
            seed_database_from_dataset(conn)
    finally:
        conn.close()
    threading.Thread(target=_warm_engine, daemon=True).start()


def _warm_engine():
    """Build the shared embeddings and EASE model in the background so the first
    recommendation request doesn't pay for them."""
    conn = get_db()
    try:
        gen = CandidateGenerator(conn)
        gen._get_vector_data()
        gen._get_idf_dict()
        gen._get_novel_tags_map()
        seed = conn.execute("SELECT novel_id FROM rec_list_items LIMIT 1").fetchone()
        if seed:
            gen.get_candidate_channels(seed[0], limit_per_channel=1)
    except Exception as exc:  # warming is best effort
        print(f"[warm] engine warm-up failed: {exc}")
    finally:
        conn.close()


@app.get("/api/health")
def health():
    conn = get_db()
    try:
        novel_count = conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0]
        return {
            "status": "ok" if novel_count else "empty",
            "schema_version": SCHEMA_VERSION,
            "algorithm_version": ALGORITHM_VERSION,
            "dataset_version": get_dataset_version(conn),
            "novel_count": novel_count,
        }
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
    media_type: str = "all"
    source: str = "all"
    # Client library / feedback exclusions (matched catalog IDs only).
    exclude_novel_ids: List[int] = Field(default_factory=list, max_length=5000)


class ForYouSeed(BaseModel):
    id: int
    weight: float = 1.0
    title: str = ""


class TasteTagWeight(BaseModel):
    name: str
    weight: float = 1.0


class ForYouRecommendRequest(BaseModel):
    """Multi-seed For You ranking for live API mode (static clients merge pools instead)."""
    seeds: List[ForYouSeed] = Field(default_factory=list, max_length=20)
    limit: int = 40
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
    media_type: str = "all"
    source: str = "all"
    exclude_novel_ids: List[int] = Field(default_factory=list, max_length=5000)
    liked_tags: List[TasteTagWeight] = Field(default_factory=list, max_length=40)
    avoid_tags: List[TasteTagWeight] = Field(default_factory=list, max_length=40)


class SlugResolveRequest(BaseModel):
    slugs: List[str] = Field(default_factory=list, max_length=1000)


class IdResolveRequest(BaseModel):
    ids: List[int] = Field(default_factory=list, max_length=2000)


def novel_search_result(row: sqlite3.Row) -> Dict[str, Any]:
    row_dict = dict(row) if isinstance(row, sqlite3.Row) else {}
    nid = row[0]
    slug = row[2] if len(row) > 2 else ""
    media_type = row_dict.get("media_type") or (
        "anime" if nid >= 3_000_000 else "manga" if nid >= 2_000_000 else "novel"
    )
    source = row_dict.get("source") or ("anilist" if nid >= 2_000_000 else "novelupdates")
    external_id = row_dict.get("external_id") or str(nid)
    if row_dict.get("external_url"):
        external_url = row_dict["external_url"]
    elif source == "anilist" and external_id:
        external_url = anilist_url(external_id, media_type, nid)
    else:
        external_url = novelupdates_url(nid, slug)
    return {
        "id": nid,
        "title": row[1],
        "slug": slug,
        "novelupdates_url": external_url,
        "external_url": external_url,
        "author": row[3],
        "cover_url": row[4],
        "rating": row[5],
        "rating_votes": row[6],
        "associated_names": parse_associated_names(row[7]) if len(row) > 7 else [],
        "media_type": media_type,
        "source": source,
        "external_id": external_id,
    }


@app.post("/api/resolve-slugs")
def resolve_novel_slugs(request: SlugResolveRequest):
    """Resolve imported profile entries by their canonical catalog key.

    Profile imports already contain Novel Updates slugs, so title search is
    both slower and less reliable. The client may still use title/alias search
    for the small set of slugs that have genuinely changed.
    """
    requested = list(dict.fromkeys(
        slug.strip().lower() for slug in request.slugs if slug.strip()
    ))
    if not requested:
        return {"results": []}

    conn = get_db()
    try:
        results = []
        for offset in range(0, len(requested), 500):
            chunk = requested[offset:offset + 500]
            placeholders = ",".join("?" for _ in chunk)
            rows = conn.execute(
                f"""
                SELECT id, title, slug, author, cover_url, rating, rating_votes,
                       associated_names, COALESCE(media_type, 'novel') as media_type,
                       COALESCE(source, 'novelupdates') as source, external_id, external_url
                FROM novels
                WHERE lower(slug) IN ({placeholders})
                """,
                chunk,
            ).fetchall()
            results.extend(novel_search_result(row) for row in rows)
        return {"results": results}
    finally:
        conn.close()


@app.post("/api/resolve-ids")
def resolve_novel_ids(request: IdResolveRequest):
    """Batch-confirm catalog membership by numeric novel id (AniList offset IDs)."""
    requested = list(dict.fromkeys(int(value) for value in request.ids if isinstance(value, int) or str(value).isdigit()))
    if not requested:
        return {"results": []}

    conn = get_db()
    try:
        results = []
        for offset in range(0, len(requested), 500):
            chunk = requested[offset:offset + 500]
            placeholders = ",".join("?" for _ in chunk)
            rows = conn.execute(
                f"""
                SELECT id, title, slug, author, cover_url, rating, rating_votes,
                       associated_names, COALESCE(media_type, 'novel') as media_type,
                       COALESCE(source, 'novelupdates') as source, external_id, external_url
                FROM novels
                WHERE id IN ({placeholders})
                """,
                chunk,
            ).fetchall()
            results.extend(novel_search_result(row) for row in rows)
        return {"results": results}
    finally:
        conn.close()


@app.get("/api/search")
def search_novels(
    q: str = Query(..., min_length=1),
    limit: int = 10,
    media_type: str = "all",
    source: str = "all",
):
    conn = get_db()
    try:
        cur = conn.cursor()
        where: list[str] = []
        params: list[Any] = []

        # Prefer token match after stripping punctuation so "Too Many Losing Heroines!"
        # also hits "Makeine: Too Many Losing Heroines" / romaji aliases without bangs.
        normalized = normalize_search_query(q)
        tokens = [tok for tok in normalized.split() if tok]
        if tokens:
            token_sql, token_params = search_token_clause(
                ["title", "slug", "associated_names", "author"],
                tokens,
            )
            where.append(f"({token_sql})")
            params.extend(token_params)
        else:
            needle = f"%{q.strip()}%"
            where.append("(title LIKE ? OR slug LIKE ? OR associated_names LIKE ?)")
            params.extend([needle, needle, needle])

        type_clause, type_params = media_type_sql_filter(media_type)
        if type_clause:
            where.append(type_clause)
            params.extend(type_params)
        if source and source != "all":
            where.append("COALESCE(source, 'novelupdates') = ?")
            params.append(source)

        params.append(limit)
        cur.execute(f"""
            SELECT id, title, slug, author, cover_url, rating, rating_votes,
                   associated_names, COALESCE(media_type, 'novel') as media_type,
                   COALESCE(source, 'novelupdates') as source, external_id, external_url
            FROM novels
            WHERE {" AND ".join(where)}
            ORDER BY reading_list_count DESC, rating_votes DESC
            LIMIT ?
        """, params)

        results = [novel_search_result(row) for row in cur.fetchall()]

        return {"query": q, "results": results}
    finally:
        conn.close()


@app.get("/api/browse")
def browse_novels(
    query: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
    sort: str = Query("popular", pattern="^(popular|rating|votes|title|newest)$"),
    language: str = "",
    author: str = "",
    genre: str = "",
    tag: str = "",
    min_rating: float = Query(0, ge=0, le=5),
    max_rating: float = Query(0, ge=0, le=5),
    min_votes: int = Query(0, ge=0),
    min_year: int = Query(0, ge=0),
    max_year: int = Query(0, ge=0),
    status: str = "",
    min_chapters: int = Query(0, ge=0),
    max_chapters: int = Query(0, ge=0),
    min_readers: int = Query(0, ge=0),
    max_readers: int = Query(0, ge=0),
    include_genres: str = "",
    exclude_genres: str = "",
    include_tags: str = "",
    exclude_tags: str = "",
    exclude_ids: str = "",
    direction: str = Query("desc", pattern="^(asc|desc)$"),
    media_type: str = "",
    source: str = "",
):
    """Browse the complete SQLite catalog with stable, honest metadata sorts."""
    max_rating = max_rating if isinstance(max_rating, (int, float)) else 0
    min_year = min_year if isinstance(min_year, int) else 0
    max_year = max_year if isinstance(max_year, int) else 0
    status = status if isinstance(status, str) else ""
    min_chapters = min_chapters if isinstance(min_chapters, int) else 0
    max_chapters = max_chapters if isinstance(max_chapters, int) else 0
    min_readers = min_readers if isinstance(min_readers, int) else 0
    max_readers = max_readers if isinstance(max_readers, int) else 0
    include_genres = include_genres if isinstance(include_genres, str) else ""
    exclude_genres = exclude_genres if isinstance(exclude_genres, str) else ""
    include_tags = include_tags if isinstance(include_tags, str) else ""
    exclude_tags = exclude_tags if isinstance(exclude_tags, str) else ""
    exclude_ids = exclude_ids if isinstance(exclude_ids, str) else ""
    direction = direction if direction in ("asc", "desc") else "desc"
    conn = get_db()
    try:
        joins = []
        where = ["n.rating >= ?", "n.rating_votes >= ?"]
        params: list[Any] = [min_rating, min_votes]
        if max_rating:
            where.append("n.rating <= ?")
            params.append(max_rating)
        if min_year:
            where.append("n.year >= ?")
            params.append(min_year)
        if max_year:
            where.append("n.year <= ?")
            params.append(max_year)
        if status:
            where.append("LOWER(COALESCE(n.status_trans, '')) LIKE LOWER(?)")
            params.append(f"%{status}%")
        if min_chapters:
            where.append("n.chapters_trans >= ?")
            params.append(min_chapters)
        if max_chapters:
            where.append("n.chapters_trans <= ?")
            params.append(max_chapters)
        if min_readers:
            where.append("n.reading_list_count >= ?")
            params.append(min_readers)
        if max_readers:
            where.append("n.reading_list_count <= ?")
            params.append(max_readers)
        excluded_ids = [int(value) for value in exclude_ids.split(",") if value.strip().isdigit()]
        if excluded_ids:
            placeholders = ",".join("?" for _ in excluded_ids)
            where.append(f"n.id NOT IN ({placeholders})")
            params.extend(excluded_ids)
        if query.strip():
            needle = f"%{query.strip()}%"
            where.append(
                "(n.title LIKE ? OR n.author LIKE ? OR n.associated_names LIKE ?)"
            )
            params.extend([needle, needle, needle])
        if language:
            where.append("LOWER(n.language) = LOWER(?)")
            params.append(language)
        type_clause, type_params = media_type_sql_filter(
            media_type, column="COALESCE(n.media_type, 'novel')"
        )
        if type_clause:
            where.append(type_clause)
            params.extend(type_params)
        if source and source != "all":
            where.append("COALESCE(n.source, 'novelupdates') = LOWER(?)")
            params.append(source)
        if author:
            where.append("LOWER(n.author) = LOWER(?)")
            params.append(author)
        if genre:
            joins.append(
                "JOIN novel_genres bg ON bg.novel_id=n.id "
                "JOIN genres g ON g.id=bg.genre_id"
            )
            where.append("LOWER(g.name) = LOWER(?)")
            params.append(genre)
        if tag:
            joins.append(
                "JOIN novel_tags bt ON bt.novel_id=n.id "
                "JOIN tags t ON t.id=bt.tag_id"
            )
            where.append("LOWER(t.name) = LOWER(?)")
            params.append(tag)
        for facet, values, excluded in (
            ("genre", include_genres, False), ("genre", exclude_genres, True),
            ("tag", include_tags, False), ("tag", exclude_tags, True),
        ):
            names = [value.strip() for value in values.split(",") if value.strip()]
            for name in names:
                table, link, foreign = (
                    ("genres", "novel_genres", "genre_id")
                    if facet == "genre" else ("tags", "novel_tags", "tag_id")
                )
                where.append(
                    f"{'NOT ' if excluded else ''}EXISTS ("
                    f"SELECT 1 FROM {link} bf JOIN {table} bv ON bv.id=bf.{foreign} "
                    "WHERE bf.novel_id=n.id AND LOWER(bv.name)=LOWER(?))"
                )
                params.append(name)
        primary = {
            "popular": "n.reading_list_count",
            "rating": "n.rating",
            "votes": "n.rating_votes",
            "title": "n.title COLLATE NOCASE",
            "newest": "COALESCE(n.year, 0)",
        }[sort]
        order = f"{primary} {direction.upper()}"
        if sort != "title":
            order += f", n.rating_votes {direction.upper()}"
        from_sql = f"FROM novels n {' '.join(joins)} WHERE {' AND '.join(where)}"
        total = conn.execute(f"SELECT COUNT(DISTINCT n.id) {from_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT DISTINCT n.id, n.title, n.slug, n.author, n.cover_url,
                   n.rating, n.rating_votes, n.reading_list_count,
                   n.language, n.year, n.status_trans, n.chapters_trans,
                   COALESCE(n.media_type, 'novel') as media_type,
                   COALESCE(n.source, 'novelupdates') as source,
                   n.external_id, n.external_url
            {from_sql}
            ORDER BY {order}, n.id ASC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, (page - 1) * page_size],
        ).fetchall()
        ids = [row["id"] for row in rows]
        genre_map: dict[int, list[str]] = {novel_id: [] for novel_id in ids}
        if ids:
            placeholders = ",".join("?" for _ in ids)
            for row in conn.execute(
                f"""
                SELECT ng.novel_id, g.name FROM novel_genres ng
                JOIN genres g ON g.id=ng.genre_id
                WHERE ng.novel_id IN ({placeholders})
                ORDER BY g.name
                """,
                ids,
            ):
                genre_map[row["novel_id"]].append(row["name"])
        items = [
            {
                "id": row["id"],
                "title": row["title"],
                "slug": row["slug"] or "",
                "novelupdates_url": row["external_url"] or (f"https://anilist.co/manga/{row['external_id']}" if row["source"] == "anilist" and row["external_id"] else novelupdates_url(row["id"], row["slug"])),
                "external_url": row["external_url"] or (f"https://anilist.co/manga/{row['external_id']}" if row["source"] == "anilist" and row["external_id"] else novelupdates_url(row["id"], row["slug"])),
                "author": row["author"] or "",
                "cover_url": row["cover_url"],
                "rating": row["rating"] or 0,
                "rating_votes": row["rating_votes"] or 0,
                "reading_list_count": row["reading_list_count"] or 0,
                "language": row["language"] or "",
                "year": row["year"],
                "status_trans": row["status_trans"] or "",
                "chapters_trans": row["chapters_trans"] or 0,
                "genres": genre_map[row["id"]],
                "media_type": row["media_type"] or ("manga" if row["id"] >= 2000000 else "novel"),
                "source": row["source"] or ("anilist" if row["id"] >= 2000000 else "novelupdates"),
                "external_id": row["external_id"] or str(row["id"]),
            }
            for row in rows
        ]
        return {
            "items": items,
            "page": page,
            "page_size": page_size,
            "total": total,
            "has_more": page * page_size < total,
            "capabilities": {
                "genres": True,
                "tags": True,
                "total_is_exact": True,
            },
        }
    finally:
        conn.close()


@app.get("/api/browse/random")
def random_browse_novel(
    query: str = "",
    sort: str = Query("popular", pattern="^(popular|rating|votes|title|newest)$"),
    language: str = "",
    author: str = "",
    genre: str = "",
    tag: str = "",
    min_rating: float = Query(0, ge=0, le=5),
    max_rating: float = Query(0, ge=0, le=5),
    min_votes: int = Query(0, ge=0),
    min_year: int = Query(0, ge=0),
    max_year: int = Query(0, ge=0),
    status: str = "",
    min_chapters: int = Query(0, ge=0),
    max_chapters: int = Query(0, ge=0),
    min_readers: int = Query(0, ge=0),
    max_readers: int = Query(0, ge=0),
    include_genres: str = "",
    exclude_genres: str = "",
    include_tags: str = "",
    exclude_tags: str = "",
    exclude_ids: str = "",
    direction: str = Query("desc", pattern="^(asc|desc)$"),
    seed: Optional[int] = None,
):
    """Select uniformly from eligible rows without returning the full catalog."""
    def value_or(value, fallback):
        return value if isinstance(value, type(fallback)) else fallback

    filters = dict(
        query=query, sort=sort, language=language, author=author, genre=genre,
        tag=tag, min_rating=min_rating,
        max_rating=value_or(max_rating, 0.0), min_votes=min_votes,
        min_year=value_or(min_year, 0), max_year=value_or(max_year, 0),
        status=value_or(status, ""),
        min_chapters=value_or(min_chapters, 0), max_chapters=value_or(max_chapters, 0),
        min_readers=value_or(min_readers, 0), max_readers=value_or(max_readers, 0),
        include_genres=value_or(include_genres, ""), exclude_genres=value_or(exclude_genres, ""),
        include_tags=value_or(include_tags, ""), exclude_tags=value_or(exclude_tags, ""),
        exclude_ids=value_or(exclude_ids, ""), direction=value_or(direction, "desc")
    )
    first = browse_novels(page=1, page_size=1, **filters)
    if first["total"] == 0:
        raise HTTPException(status_code=404, detail="No novels match the active filters.")
    offset = (
        random.Random(seed).randrange(first["total"])
        if seed is not None
        else secrets.randbelow(first["total"])
    )
    selected = browse_novels(page=offset + 1, page_size=1, **filters)
    return {"novel": selected["items"][0], "eligible_count": first["total"]}


@app.get("/api/novels/{novel_id}")
def get_novel_detail(novel_id: int):
    conn = get_db()
    try:
        row = conn.execute("""
            SELECT id, title, slug, associated_names, author, language, synopsis,
                   rating, rating_votes, rating_votes_5, rating_votes_4, rating_votes_3,
                   rating_votes_2, rating_votes_1, reading_list_count, chapters_orig,
                   chapters_trans, status_trans, year, cover_url,
                   COALESCE(media_type, 'novel') as media_type,
                   COALESCE(source, 'novelupdates') as source,
                   external_id, external_url
            FROM novels
            WHERE id = ?
        """, (novel_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Item {novel_id} not found.")

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

        ext_url = row["external_url"] or (f"https://anilist.co/manga/{row['external_id']}" if row["source"] == "anilist" and row["external_id"] else novelupdates_url(row["id"], row["slug"]))

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
            "rating_votes_5": row["rating_votes_5"],
            "rating_votes_4": row["rating_votes_4"],
            "rating_votes_3": row["rating_votes_3"],
            "rating_votes_2": row["rating_votes_2"],
            "rating_votes_1": row["rating_votes_1"],
            "rating_dist": {
                "5": row["rating_votes_5"],
                "4": row["rating_votes_4"],
                "3": row["rating_votes_3"],
                "2": row["rating_votes_2"],
                "1": row["rating_votes_1"],
            },
            "reading_list_count": row["reading_list_count"],
            "chapters_orig": row["chapters_orig"],
            "chapters_trans": row["chapters_trans"],
            "status_trans": row["status_trans"],
            "year": row["year"],
            "cover_url": row["cover_url"],
            "genres": genres,
            "tags": tags,
            "novelupdates_url": ext_url,
            "external_url": ext_url,
            "media_type": row["media_type"] or ("manga" if row["id"] >= 2000000 else "novel"),
            "source": row["source"] or ("anilist" if row["id"] >= 2000000 else "novelupdates"),
            "external_id": row["external_id"] or str(row["id"]),
            "direct_recommendation_count": counts[0],
            "related_series_count": counts[1],
            "recommendation_list_count": counts[2],
        }
    finally:
        conn.close()


_INVERSE_RELATION = {
    "sequel": "prequel", "prequel": "sequel", "parent": "spin_off",
    "spin_off": "parent", "side_story": "parent",
}


@app.get("/api/novels/{novel_id}/series")
def get_novel_series(novel_id: int):
    """Sequels, prequels, spin-offs and adaptations linked to this title."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT r.relation_type, r.target_novel_id AS other, 0 AS inbound
               FROM related_series r WHERE r.source_novel_id = ?
               UNION ALL
               SELECT r.relation_type, r.source_novel_id, 1
               FROM related_series r WHERE r.target_novel_id = ?""",
            (novel_id, novel_id),
        ).fetchall()
        picked: Dict[int, str] = {}
        for relation, other, inbound in sorted(rows, key=lambda r: r[2]):
            if other in picked:
                continue  # an explicit outgoing edge wins over an inverted incoming one
            picked[other] = _INVERSE_RELATION.get(relation, relation) if inbound else relation
        if not picked:
            return {"items": []}
        marks = ",".join("?" * len(picked))
        cards = conn.execute(
            f"""SELECT id, title, slug, author, cover_url, rating, rating_votes,
                       associated_names, COALESCE(media_type, 'novel') AS media_type,
                       COALESCE(source, 'novelupdates') AS source, external_id, external_url,
                       year, reading_list_count
                FROM novels WHERE id IN ({marks})""",
            list(picked),
        ).fetchall()
        items = []
        for card in cards:
            item = novel_search_result(card)
            item["relation"] = picked[card["id"]]
            item["year"] = card["year"]
            item["reading_list_count"] = card["reading_list_count"]
            items.append(item)
        items.sort(key=lambda item: (item["relation"], -(item["reading_list_count"] or 0)))
        return {"items": items[:60]}
    finally:
        conn.close()


@app.get("/api/novels/{novel_id}/lists")
def get_novel_lists(novel_id: int):
    """Curated Novel Updates lists that include this title."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT l.id, l.title, l.curator, l.followers, l.item_count, l.description
               FROM rec_list_items i JOIN rec_lists l ON l.id = i.list_id
               WHERE i.novel_id = ?
               ORDER BY l.followers DESC, l.item_count DESC LIMIT 40""",
            (novel_id,),
        ).fetchall()
        return {"lists": [
            {"id": r[0], "title": r[1], "curator": r[2], "followers": r[3] or 0,
             "item_count": r[4] or 0, "description": (r[5] or "")[:240]}
            for r in rows
        ]}
    finally:
        conn.close()


@app.get("/api/novels/{novel_id}/insights")
def get_novel_insights(novel_id: int):
    """Return descriptive catalog statistics with explicit populations."""
    conn = get_db()
    try:
        novel = conn.execute(
            """SELECT id, rating, rating_votes, reading_list_count, language, year
               FROM novels WHERE id = ?""",
            (novel_id,),
        ).fetchone()
        if not novel:
            raise HTTPException(status_code=404, detail=f"Novel {novel_id} not found.")
        total = conn.execute("SELECT COUNT(*) FROM novels").fetchone()[0]
        metric_columns = {
            "rating": "rating",
            "rating_votes": "rating_votes",
            "readers": "reading_list_count",
        }
        metrics = []
        for key, column in metric_columns.items():
            value = novel[column] or 0
            below = conn.execute(
                f"SELECT COUNT(*) FROM novels WHERE COALESCE({column}, 0) <= ?",
                (value,),
            ).fetchone()[0]
            above = conn.execute(
                f"SELECT COUNT(*) FROM novels WHERE COALESCE({column}, 0) > ?",
                (value,),
            ).fetchone()[0]
            metrics.append({
                "key": key, "value": value,
                "percentile": round(100 * below / total, 1) if total else 0,
                "rank": above + 1, "population": total,
            })

        primary_genre_row = conn.execute(
            """SELECT MIN(g.name) FROM novel_genres ng
               JOIN genres g ON g.id=ng.genre_id WHERE ng.novel_id=?""",
            (novel_id,),
        ).fetchone()
        primary_genre = primary_genre_row[0] if primary_genre_row else None
        cohorts = []
        cohort_specs = [
            ("primary_genre", primary_genre, """
                EXISTS (SELECT 1 FROM novel_genres x
                        JOIN genres gx ON gx.id=x.genre_id
                        WHERE x.novel_id=n.id AND gx.name=?)"""),
            ("language", novel["language"], "n.language = ?"),
            ("year", str(novel["year"]) if novel["year"] else None, "n.year = ?"),
        ]
        for dimension, value, clause in cohort_specs:
            if not value:
                continue
            parameter = novel["year"] if dimension == "year" else value
            population = conn.execute(
                f"SELECT COUNT(*) FROM novels n WHERE {clause}", (parameter,)
            ).fetchone()[0]
            above = conn.execute(
                f"""SELECT COUNT(*) FROM novels n WHERE {clause}
                    AND COALESCE(n.reading_list_count,0) > ?""",
                (parameter, novel["reading_list_count"] or 0),
            ).fetchone()[0]
            cohorts.append({
                "dimension": dimension, "value": str(value),
                "population": population, "readership_rank": above + 1,
            })

        peers = []
        if primary_genre:
            for row in conn.execute(
                """
                SELECT n.id, n.title, n.slug, n.author, n.cover_url, n.rating,
                       n.rating_votes, n.reading_list_count, n.language, n.year,
                       (SELECT COUNT(*) FROM novel_genres a
                        JOIN novel_genres b ON b.genre_id=a.genre_id
                        WHERE a.novel_id=? AND b.novel_id=n.id) shared_genres,
                       (SELECT COUNT(*) FROM novel_tags a
                        JOIN novel_tags b ON b.tag_id=a.tag_id
                        WHERE a.novel_id=? AND b.novel_id=n.id) shared_tags
                FROM novels n
                WHERE n.id != ? AND n.language = ?
                  AND EXISTS (
                    SELECT 1 FROM novel_genres ng JOIN genres g ON g.id=ng.genre_id
                    WHERE ng.novel_id=n.id AND g.name=?
                  )
                ORDER BY shared_tags DESC, shared_genres DESC,
                         n.reading_list_count DESC, n.id
                LIMIT 10
                """,
                (novel_id, novel_id, novel_id, novel["language"], primary_genre),
            ):
                peers.append({
                    "id": row["id"], "title": row["title"], "slug": row["slug"] or "",
                    "novelupdates_url": novelupdates_url(row["id"], row["slug"]),
                    "author": row["author"] or "", "cover_url": row["cover_url"],
                    "rating": row["rating"] or 0, "rating_votes": row["rating_votes"] or 0,
                    "reading_list_count": row["reading_list_count"] or 0,
                    "language": row["language"] or "", "year": row["year"],
                    "shared_genre_count": row["shared_genres"],
                    "shared_tag_count": row["shared_tags"],
                })
        return {
            "novel_id": novel_id, "catalog_size": total, "metrics": metrics,
            "cohorts": cohorts, "peers": peers,
            "cohort_definition": (
                "Peers share the alphabetically first catalog genre and exact "
                "language; they are ordered by shared tags, shared genres, then readers."
            ),
            "capabilities": {"relationships": False, "tags": True},
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
        media_types = [
            row[0] for row in conn.execute("""
                SELECT COALESCE(media_type, 'novel') FROM novels
                GROUP BY COALESCE(media_type, 'novel')
                ORDER BY COUNT(*) DESC
            """)
        ]
        sources = [
            row[0] for row in conn.execute("""
                SELECT COALESCE(source, 'novelupdates') FROM novels
                GROUP BY COALESCE(source, 'novelupdates')
                ORDER BY COUNT(*) DESC
            """)
        ]
        return {
            "genres": genres,
            "popular_tags": popular_tags,
            "languages": languages,
            "media_types": media_types,
            "sources": sources,
        }
    finally:
        conn.close()


@app.post("/api/recommend")
def get_recommendations(req: RecommendRequest):
    conn = get_db()
    try:
        return _get_recommendations(conn, req)
    finally:
        conn.close()


class ForYouRowRequest(BaseModel):
    """One Netflix-style row: seeded by a single list, or blended across several."""
    list_ids: List[int] = Field(min_length=1, max_length=40)
    blend: bool = False  # True = "Top picks" row mixing all list_ids
    seeds_per_list: int = Field(default=12, ge=1, le=20)
    limit: int = Field(default=20, ge=1, le=150)  # 150 backs the "See all" grid
    media_type: str = "novel"
    hide_known: bool = False  # drop titles that appear on any of list_ids
    exclude_novel_ids: List[int] = Field(default_factory=list, max_length=5000)  # e.g. the user's library
    list_titles: Dict[int, str] = Field(default_factory=dict)  # display names that override stale DB titles
    channel_weights: Dict[str, float] = Field(default_factory=dict)


def _list_members(conn: sqlite3.Connection, list_id: int) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """SELECT i.novel_id, n.title, i.position FROM rec_list_items i
           JOIN novels n ON n.id = i.novel_id
           WHERE i.list_id = ? ORDER BY i.position""",
        (list_id,),
    ).fetchall()
    return [{"id": r[0], "title": r[1], "position": r[2]} for r in rows]


class ListPageFile(BaseModel):
    name: str = ""
    html: str = Field(max_length=8 * 1024 * 1024)


class ListImportRequest(BaseModel):
    files: List[ListPageFile] = Field(min_length=1, max_length=60)


@app.post("/api/import/lists")
def import_lists(req: ListImportRequest):
    """Import saved Novel Updates list pages; refreshes the EASE model afterwards."""
    conn = get_db()
    try:
        result = import_list_pages(conn, [(f.name, f.html) for f in req.files])
    finally:
        conn.close()
    if result["lists"]:
        threading.Thread(target=_refresh_ease, daemon=True).start()
    return result


def _refresh_ease():
    """Drop the cached EASE model (it was fit on the old memberships) and rebuild it."""
    conn = get_db()
    try:
        gen = CandidateGenerator(conn)
        with _engine_lock_obj:
            gen._ease = None
        seed = conn.execute("SELECT novel_id FROM rec_list_items LIMIT 1").fetchone()
        if seed:
            gen.get_candidate_channels(seed[0], limit_per_channel=1)
    except Exception as exc:
        print(f"[ease] refresh failed: {exc}")
    finally:
        conn.close()


@app.get("/api/for-you/lists")
def for_you_lists(min_items: int = Query(10, ge=1)):
    """Recommendation lists with enough imported members to seed a row."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT l.id, l.title, l.curator, COUNT(n.id) AS items
               FROM rec_lists l
               JOIN rec_list_items i ON i.list_id = l.id
               JOIN novels n ON n.id = i.novel_id
               GROUP BY l.id HAVING items >= ?
               ORDER BY (l.curator IS NOT NULL AND l.curator != '') DESC, l.followers DESC, items DESC LIMIT 200""",
            (min_items,),
        ).fetchall()
        return {"lists": [{"id": r[0], "title": r[1], "curator": r[2], "items": r[3]} for r in rows]}
    finally:
        conn.close()


@app.post("/api/for-you/row")
def for_you_row(req: ForYouRowRequest):
    conn = get_db()
    try:
        lists = {
            r[0]: r[1]
            for r in conn.execute(
                f"SELECT id, title FROM rec_lists WHERE id IN ({','.join('?' * len(req.list_ids))})",
                req.list_ids,
            )
        }
        lists.update({lid: name for lid, name in req.list_titles.items() if lid in lists and name.strip()})
        members = {lid: _list_members(conn, lid) for lid in req.list_ids if lid in lists}
        members = {lid: m for lid, m in members.items() if m}
        if not members:
            raise HTTPException(status_code=404, detail="None of those lists have imported members.")

        # Seeds: a list's highest-ranked members. Rank 1 counts most; weight decays down the list.
        def seed_weight(rank: int, size: int) -> float:
            return round(1.5 - 1.0 * (rank - 1) / max(size, 1), 3)

        seeds: List[ForYouSeed] = []
        if req.blend:
            per_list = max(1, min(req.seeds_per_list, 20 // len(members)))
            for lid, m in members.items():
                top = m[:per_list]
                seeds.extend(ForYouSeed(id=x["id"], title=x["title"], weight=seed_weight(i, len(top))) for i, x in enumerate(top, 1))
            seeds = seeds[:20]
            title, subtitle = "Top picks for you", "Blended from your favorite lists"
            own_exclude: set = set()
        else:
            lid = next(iter(members))
            top = members[lid][: req.seeds_per_list]
            seeds = [ForYouSeed(id=x["id"], title=x["title"], weight=seed_weight(i, len(top))) for i, x in enumerate(top, 1)]
            title, subtitle = f"Because you love {lists[lid]}", f"Seeded by the top {len(seeds)} titles on this list"
            own_exclude = {x["id"] for x in members[lid]}

        known_ids = {x["id"] for m in members.values() for x in m}
        exclude = set(own_exclude) | set(req.exclude_novel_ids) | (known_ids if req.hide_known else set())
        exclude -= {s.id for s in seeds}  # seeds are always excluded by the engine itself
        fy = ForYouRecommendRequest(
            seeds=seeds,
            limit=req.limit,
            media_type=req.media_type,
            channel_weights=req.channel_weights,
            exclude_novel_ids=sorted(exclude)[:5000],
        )
        result = _get_for_you_recommendations(conn, fy)

        by_novel: Dict[int, List[str]] = {}
        for lid, m in members.items():
            for x in m:
                by_novel.setdefault(x["id"], []).append(lists[lid])
        top_score = max((r.get("rrf_score") or 0 for r in result["recommendations"]), default=0) or 1.0
        for rec in result["recommendations"]:
            rec["on_lists"] = by_novel.get(rec["target_id"], [])
            # Multi-seed scores are sums, so the single-seed percent saturates; report strength relative to the row's best.
            rec["match_score_percent"] = round(100 * (rec.get("rrf_score") or 0) / top_score)
        return {
            "title": title,
            "subtitle": subtitle,
            "seeds": [{"id": s.id, "title": s.title} for s in seeds],
            "count": len(result["recommendations"]),
            "recommendations": result["recommendations"],
        }
    finally:
        conn.close()


@app.post("/api/recommend/for-you")
def get_for_you_recommendations(req: ForYouRecommendRequest):
    """Multi-seed RRF fusion for profile For You (live mode only)."""
    conn = get_db()
    try:
        return _get_for_you_recommendations(conn, req)
    finally:
        conn.close()


def _recommend_preferences(req: Any, extra_exclude: List[int]) -> Dict[str, Any]:
    exclude_tags = []
    if getattr(req, "exclude_harem", False):
        exclude_tags.extend(["harem", "reverse harem"])
    if getattr(req, "exclude_bl", False):
        exclude_tags.extend(["yaoi", "bl", "boys love", "shounen ai"])
    if getattr(req, "exclude_yuri", False):
        exclude_tags.extend(["yuri", "shoujo ai"])
    exclude_tags.extend(getattr(req, "exclude_tags", None) or [])
    exclude_ids = {
        int(nid)
        for nid in (getattr(req, "exclude_novel_ids", None) or [])
        if str(nid).lstrip("-").isdigit()
    }
    exclude_ids.update(int(nid) for nid in extra_exclude)
    return {
        "exclude_tags": exclude_tags,
        "include_tags": getattr(req, "include_tags", None) or [],
        "include_genres": getattr(req, "include_genres", None) or [],
        "exclude_genres": getattr(req, "exclude_genres", None) or [],
        "language": getattr(req, "language", "") or "",
        "min_rating": getattr(req, "min_rating", 0) or 0,
        "min_rating_votes": getattr(req, "min_rating_votes", 0) or 0,
        "max_readers": getattr(req, "max_readers", 0) or 0,
        "min_year": getattr(req, "min_year", 0) or 0,
        "max_year": getattr(req, "max_year", 0) or 0,
        "require_completed": getattr(req, "require_completed", False),
        "min_chapters": getattr(req, "min_chapters", 0) or 0,
        "media_type": getattr(req, "media_type", "all") or "all",
        "source": getattr(req, "source", "all") or "all",
        "exclude_novel_ids": list(exclude_ids),
    }


def _channel_weights(req: Any) -> Dict[str, float]:
    raw = getattr(req, "channel_weights", None) or {}
    return {
        key: max(0.0, min(3.0, float(value)))
        for key, value in raw.items()
        if key in {"vector", "tag", "direct_rec", "rec_list", "structural", "ease"}
    }


def _affinity_multiplier(shared_tags: List[str], liked: Dict[str, float], avoided: Dict[str, float]) -> tuple[float, List[str], List[str]]:
    like_score = 0.0
    avoid_score = 0.0
    hit_like: List[str] = []
    hit_avoid: List[str] = []
    for tag in shared_tags or []:
        key = tag.lower()
        if key in liked:
            like_score += liked[key]
            hit_like.append(tag)
        if key in avoided:
            avoid_score += avoided[key]
            hit_avoid.append(tag)
    raw = 1.0 + min(0.35, like_score * 0.012) - min(0.4, avoid_score * 0.016)
    return max(0.55, min(1.45, raw)), hit_like[:4], hit_avoid[:4]


def _get_for_you_recommendations(conn: sqlite3.Connection, req: ForYouRecommendRequest):
    if not req.seeds:
        raise HTTPException(status_code=400, detail="For You requires at least one seed id.")

    cur = conn.cursor()
    cand_gen = CandidateGenerator(conn)
    filter_engine = HardFilterEngine(conn)
    preferences = _recommend_preferences(req, [seed.id for seed in req.seeds])
    channel_weights = _channel_weights(req)
    effective_weights = channel_weights or DEFAULT_CHANNEL_WEIGHTS

    liked = {t.name.lower(): float(t.weight) for t in req.liked_tags if t.name}
    avoided = {t.name.lower(): float(t.weight) for t in req.avoid_tags if t.name}

    seeds_used = []
    seeds_missing = []
    # nid -> accumulated score and contributing seeds
    scores: Dict[int, float] = {}
    seed_hits: Dict[int, List[Dict[str, Any]]] = {}
    best_seed_for: Dict[int, tuple[int, float]] = {}
    channel_ranks_by_seed: Dict[int, Dict[str, List[Tuple[int, float]]]] = {}

    for seed in req.seeds:
        seed_id = int(seed.id)
        row = cur.execute(
            "SELECT id, title, slug, cover_url FROM novels WHERE id = ?",
            (seed_id,),
        ).fetchone()
        if not row:
            seeds_missing.append(seed_id)
            continue
        weight = max(0.1, min(10.0, float(seed.weight or 1.0)))
        seeds_used.append({
            "id": seed_id,
            "title": seed.title or row[1],
            "weight": weight,
        })
        channels = cand_gen.get_candidate_channels(seed_id, limit_per_channel=150)
        all_ids = {nid for cands in channels.values() for nid, _ in cands}
        valid = set(filter_engine.filter_candidates(list(all_ids), preferences))
        filtered = {
            name: [(nid, sc) for nid, sc in cands if nid in valid]
            for name, cands in channels.items()
        }
        channel_ranks_by_seed[seed_id] = filtered
        rrf = calculate_rrf_scores(filtered, channel_weights=channel_weights or None)
        for nid, score in rrf.items():
            if nid == seed_id:
                continue
            contribution = score * weight
            scores[nid] = scores.get(nid, 0.0) + contribution
            seed_hits.setdefault(nid, []).append({
                "id": seed_id,
                "title": seed.title or row[1],
                "weight": weight,
                "contribution": contribution,
            })
            prev = best_seed_for.get(nid)
            if prev is None or contribution > prev[1]:
                best_seed_for[nid] = (seed_id, contribution)

    if not seeds_used:
        raise HTTPException(status_code=404, detail="None of the For You seeds exist in this catalog.")

    # Soft taste affinity using union of tags with any contributing seed (approx via best seed shared tags later).
    # First pass: hidden gem + clamp; affinity applied after shared-tag lookup in explain loop.

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    # Pre-trim before expensive explain
    ranked = ranked[: max(req.limit * 3, req.limit)]

    explainer = EvidenceExplainer(conn)
    recommendations = []
    for nid, base_score in ranked:
        primary_seed, _ = best_seed_for.get(nid, (seeds_used[0]["id"], 0.0))
        ch_ranks: Dict[str, int] = {}
        for ch_name, cands in channel_ranks_by_seed.get(primary_seed, {}).items():
            for r_idx, (cand_id, _) in enumerate(cands, 1):
                if cand_id == nid:
                    ch_ranks[ch_name] = r_idx
                    break
        exp = explainer.explain_recommendation(primary_seed, nid, base_score, ch_ranks)
        if not exp:
            continue
        shared = exp.get("shared_tags") or []
        mult, hit_like, hit_avoid = _affinity_multiplier(shared, liked, avoided)
        score = base_score * mult
        if req.hidden_gem_mode:
            score = apply_hidden_gem_boost(
                score,
                exp.get("reading_list_count") or 0,
                gamma=max(0.0, min(1.0, req.hidden_gem_strength)),
            )
        exp["rrf_score"] = score
        bullets = list(exp.get("evidence_bullets") or [])
        hits = seed_hits.get(nid) or []
        if len(hits) > 1:
            titles = ", ".join(h["title"] for h in sorted(hits, key=lambda h: -h["contribution"])[:3])
            bullets.insert(0, f"Appeared under {len(hits)} of your seeds (e.g. {titles})")
        elif hits:
            bullets.insert(0, f"From your seed: {hits[0]['title']}")
        if mult != 1.0:
            if hit_like:
                bullets.insert(1, f"Taste boost ×{mult:.2f} via liked tropes: {', '.join(hit_like)}")
            if hit_avoid:
                bullets.insert(1, f"Taste penalty ×{mult:.2f} via avoided tropes: {', '.join(hit_avoid)}")
        exp["evidence_bullets"] = bullets[:7]
        exp["_sort_score"] = score
        exp["_unboosted"] = base_score * mult
        recommendations.append(exp)

    recommendations.sort(key=lambda item: item.get("_sort_score", 0), reverse=True)
    recommendations = recommendations[: req.limit]
    active_channels = list(effective_weights.keys())
    for exp in recommendations:
        exp["match_score_percent"] = calculate_match_percent(
            float(exp.pop("_unboosted", exp.get("rrf_score") or 0)),
            active_channels,
            effective_weights,
        )
        exp.pop("_sort_score", None)

    top = seeds_used[0]
    return {
        "seed_novel": {
            "id": 0,
            "title": "For You (multi-seed)",
            "slug": "for-you",
            "novelupdates_url": "",
            "cover_url": None,
        },
        "count": len(recommendations),
        "recommendations": recommendations,
        "seeds_used": seeds_used,
        "seeds_missing": seeds_missing,
        "primary_seed_id": top["id"],
        "mode": "api-multi-seed",
    }


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
    preferences = _recommend_preferences(req, [seed_id])

    all_cand_ids = set()
    for ch_cands in channels.values():
        for nid, _ in ch_cands:
            all_cand_ids.add(nid)

    valid_cand_ids = filter_engine.filter_candidates(list(all_cand_ids), preferences)

    # RRF Scoring
    filtered_channels = {}
    for ch_name, cands in channels.items():
        filtered_channels[ch_name] = [(nid, sc) for nid, sc in cands if nid in valid_cand_ids]

    channel_weights = _channel_weights(req)
    rrf_scores = calculate_rrf_scores(
        filtered_channels,
        channel_weights=channel_weights or None,
    )
    effective_weights = channel_weights or DEFAULT_CHANNEL_WEIGHTS
    active_channels = [
        channel_name
        for channel_name, candidates in filtered_channels.items()
        if candidates
    ]

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
        exp["match_score_percent"] = calculate_match_percent(
            unboosted_score,
            active_channels,
            effective_weights,
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
