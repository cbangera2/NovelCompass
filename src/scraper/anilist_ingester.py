"""AniList Manga Ingester: parses and persists AniList GraphQL media items into SQLite DB."""

from __future__ import annotations

import re
import html
import sqlite3
from typing import Any, Dict, List, Optional
from src.db.repository import Repository
from src.scraper.anilist_client import AniListClient
from src.engine.normalization import normalize_anilist_rating

ANILIST_ID_OFFSET = 2_000_000
ANILIST_MANGA_ID_OFFSET = 2_000_000
ANILIST_ANIME_ID_OFFSET = 3_000_000

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")

def clean_description(desc: Optional[str]) -> str:
    if not desc:
        return ""
    # Strip HTML tags & brs
    text = html.unescape(desc)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()

def map_anilist_media(media: Dict[str, Any]) -> Dict[str, Any]:
    anilist_id = media["id"]
    media_raw_type = (media.get("type") or "MANGA").upper()
    
    if media_raw_type == "ANIME":
        offset = ANILIST_ANIME_ID_OFFSET
        ext_url = f"https://anilist.co/anime/{anilist_id}"
        prefix = "anilist-anime"
    else:
        offset = ANILIST_MANGA_ID_OFFSET
        ext_url = f"https://anilist.co/manga/{anilist_id}"
        prefix = "anilist"

    db_id = offset + anilist_id

    titles = media.get("title") or {}
    english = titles.get("english")
    romaji = titles.get("romaji")
    native = titles.get("native")
    user_preferred = titles.get("userPreferred")

    # Prefer English for display so franchise search matches NovelUpdates titles;
    # romaji / native / userPreferred stay in associated_names for alias search.
    primary_title = english or user_preferred or romaji or f"AniList Media {anilist_id}"
    slug = f"{prefix}-{anilist_id}-{slugify(primary_title)[:50]}"

    associated_names = []
    for name in [english, romaji, native, user_preferred]:
        if name and name not in associated_names:
            associated_names.append(name)
    for syn in media.get("synonyms") or []:
        if syn and syn not in associated_names:
            associated_names.append(syn)

    # Authors / Artists / Studios
    authors = []
    staff_edges = (media.get("staff") or {}).get("edges") or []
    for edge in staff_edges:
        role = (edge.get("role") or "").lower()
        if any(keyword in role for keyword in ["story", "art", "author", "original creator", "writer", "mangaka", "director", "producer"]):
            node = edge.get("node") or {}
            name = (node.get("name") or {}).get("full")
            if name and name not in authors:
                authors.append(name)

    studios = (media.get("studios") or {}).get("nodes") or []
    for studio in studios:
        sname = studio.get("name")
        if sname and sname not in authors:
            authors.append(sname)

    author_str = ", ".join(authors) if authors else "Unknown"

    # Format / Country / Type -> media_type
    # AniList stores light novels under type=MANGA with format=NOVEL; keep them
    # distinct from comic manga so multi-source franchise search can surface LN +
    # manga + anime as separate catalog rows.
    raw_format = (media.get("format") or "").lower()
    country = (media.get("countryOfOrigin") or "").upper()
    if media_raw_type == "ANIME" or raw_format in ["tv", "tv_short", "movie", "special", "ova", "ona", "anime"]:
        media_type = "anime"
    elif raw_format == "novel":
        media_type = "light_novel"
    elif raw_format == "manhwa" or country == "KR":
        media_type = "manhwa"
    elif raw_format == "manhua" or country == "CN":
        media_type = "manhua"
    else:
        media_type = "manga"

    # Score (0-100 quantile mapped -> 1.0-5.0)
    score_100 = media.get("averageScore") or media.get("meanScore") or 0
    rating = normalize_anilist_rating(score_100)
    popularity = media.get("popularity") or 0
    favourites = media.get("favourites") or 0

    status_raw = (media.get("status") or "UNKNOWN").upper()
    status_map = {
        "FINISHED": "Completed",
        "RELEASING": "Ongoing",
        "NOT_YET_RELEASED": "Upcoming",
        "CANCELLED": "Cancelled",
        "HIATUS": "Hiatus",
    }
    status_trans = status_map.get(status_raw, status_raw.capitalize())

    start_date = media.get("startDate") or {}
    year = start_date.get("year") or media.get("seasonYear")

    cover_img = (media.get("coverImage") or {}).get("large") or (media.get("coverImage") or {}).get("medium")

    genres = media.get("genres") or []
    tags = [tag.get("name") for tag in (media.get("tags") or []) if tag.get("name")]

    episodes_or_chapters = media.get("episodes") or media.get("chapters") or 0

    # Popularity Normalization: AniList user counts (~250k top) are ~10x higher than
    # NovelUpdates readership (~30k top). Scaling by 0.1x aligns global sorting.
    scaled_readers = max(1, round(popularity * 0.10)) if popularity else (favourites or 0)
    scaled_votes = favourites if favourites > 0 else (max(1, round(popularity * 0.04)) if popularity else 0)

    return {
        "id": db_id,
        "anilist_id": anilist_id,
        "external_id": str(anilist_id),
        "external_url": ext_url,
        "slug": slug,
        "title": primary_title,
        "associated_names": associated_names,
        "author": author_str,
        "language": "Japanese" if country == "JP" else ("Korean" if country == "KR" else ("Chinese" if country == "CN" else "English")),
        "synopsis": clean_description(media.get("description")),
        "rating": rating,
        "rating_votes": scaled_votes,
        "reading_list_count": scaled_readers,
        "chapters_orig": episodes_or_chapters,
        "chapters_trans": episodes_or_chapters,
        "status_trans": status_trans,
        "year": year,
        "cover_url": cover_img,
        "genres": genres,
        "tags": tags,
        "media_type": media_type,
        "source": "anilist",
        "raw_recommendations": (media.get("recommendations") or {}).get("nodes") or [],
        "raw_relations": (media.get("relations") or {}).get("edges") or [],
    }

class AniListIngester:
    def __init__(self, conn: sqlite3.Connection, client: Optional[AniListClient] = None):
        self.conn = conn
        self.repo = Repository(conn)
        self.client = client or AniListClient()

    def ingest_media_nodes(self, media_nodes: List[Dict[str, Any]]) -> List[int]:
        ingested_ids = []
        for raw in media_nodes:
            if not raw or not raw.get("id"):
                continue
            item = map_anilist_media(raw)
            db_id = self.repo.upsert_manga(item)
            ingested_ids.append(db_id)

            raw_type = (raw.get("type") or "MANGA").upper()
            offset = ANILIST_ANIME_ID_OFFSET if raw_type == "ANIME" else ANILIST_MANGA_ID_OFFSET

            # Ingest direct recommendations
            direct_recs = []
            for rec_node in item.get("raw_recommendations") or []:
                rec_media = rec_node.get("mediaRecommendation")
                if rec_media and rec_media.get("id"):
                    rec_type = (rec_media.get("type") or raw_type).upper()
                    rec_offset = ANILIST_ANIME_ID_OFFSET if rec_type == "ANIME" else ANILIST_MANGA_ID_OFFSET
                    rec_target_id = rec_offset + rec_media["id"]
                    votes = rec_node.get("rating") or 1
                    direct_recs.append({"id": rec_target_id, "votes": max(1, votes)})
            if direct_recs:
                self.repo.replace_novel_relationships(db_id, direct_recs, [])

            # Ingest relations
            related_series = []
            for rel_edge in item.get("raw_relations") or []:
                rel_node = rel_edge.get("node")
                if rel_node and rel_node.get("id"):
                    rel_type_str = (rel_node.get("type") or raw_type).upper()
                    rel_offset = ANILIST_ANIME_ID_OFFSET if rel_type_str == "ANIME" else ANILIST_MANGA_ID_OFFSET
                    rel_target_id = rel_offset + rel_node["id"]
                    rel_type = (rel_edge.get("relationType") or "related").lower()
                    related_series.append({"id": rel_target_id, "relation_type": rel_type})
            if related_series:
                self.repo.replace_novel_relationships(db_id, [], related_series)

        return ingested_ids

    def sync_popular_manga(self, page: int = 1, per_page: int = 20) -> List[int]:
        data = self.client.fetch_popular_manga(page=page, per_page=per_page)
        media_list = (data.get("data") or {}).get("Page", {}).get("media", [])
        return self.ingest_media_nodes(media_list)

    def sync_popular_anime(self, page: int = 1, per_page: int = 20) -> List[int]:
        data = self.client.fetch_popular_anime(page=page, per_page=per_page)
        media_list = (data.get("data") or {}).get("Page", {}).get("media", [])
        return self.ingest_media_nodes(media_list)

    def sync_manga_by_query(self, search_text: str, page: int = 1, per_page: int = 10) -> List[int]:
        data = self.client.search_manga(search_text, page=page, per_page=per_page)
        media_list = (data.get("data") or {}).get("Page", {}).get("media", [])
        return self.ingest_media_nodes(media_list)

    def sync_anime_by_query(self, search_text: str, page: int = 1, per_page: int = 10) -> List[int]:
        data = self.client.search_anime(search_text, page=page, per_page=per_page)
        media_list = (data.get("data") or {}).get("Page", {}).get("media", [])
        return self.ingest_media_nodes(media_list)
