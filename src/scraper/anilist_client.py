"""AniList GraphQL API client with response caching and rate control."""

from __future__ import annotations

import os
import json
import time
import urllib.request
import urllib.parse
import urllib.error
import hashlib
from pathlib import Path
from typing import Any, Dict, Optional

ANILIST_API_URL = "https://graphql.anilist.co"
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "anilist"

MEDIA_QUERY = """
query ($page: Int = 1, $perPage: Int = 20, $search: String, $id: Int, $type: MediaType = MANGA, $sort: [MediaSort] = [POPULARITY_DESC]) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      lastPage
      hasNextPage
    }
    media(id: $id, search: $search, type: $type, sort: $sort) {
      id
      idMal
      title {
        romaji
        english
        native
        userPreferred
      }
      type
      format
      status
      description(asHtml: false)
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      countryOfOrigin
      isLicensed
      source
      hashtag
      synonyms
      genres
      tags {
        id
        name
        category
        rank
        isGeneralSpoiler
        isMediaSpoiler
      }
      averageScore
      meanScore
      popularity
      favourites
      chapters
      volumes
      episodes
      duration
      seasonYear
      coverImage {
        extraLarge
        large
        medium
        color
      }
      bannerImage
      staff {
        edges {
          role
          node {
            id
            name {
              full
              native
            }
          }
        }
      }
      studios {
        nodes {
          id
          name
        }
      }
      recommendations(perPage: 10, sort: [RATING_DESC]) {
        nodes {
          rating
          userRating
          mediaRecommendation {
            id
            title {
              romaji
              english
            }
            format
            type
          }
        }
      }
      relations {
        edges {
          relationType
          node {
            id
            title {
              romaji
              english
            }
            format
            type
          }
        }
      }
    }
  }
}
"""

MANGA_QUERY = MEDIA_QUERY

class AniListClient:
    def __init__(self, cache_dir: Path | str = CACHE_DIR, request_delay: float = 0.5):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.request_delay = request_delay
        self.last_request_time = 0.0

    def _get_cache_key(self, query: str, variables: Dict[str, Any]) -> str:
        payload = json.dumps({"query": query.strip(), "variables": variables}, sort_keys=True)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def query(self, query_str: str, variables: Dict[str, Any], use_cache: bool = True) -> Dict[str, Any]:
        cache_key = self._get_cache_key(query_str, variables)
        cache_path = self.cache_dir / f"{cache_key}.json"

        if use_cache and cache_path.exists():
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

        elapsed = time.time() - self.last_request_time
        if elapsed < self.request_delay:
            time.sleep(self.request_delay - elapsed)

        req_body = json.dumps({"query": query_str, "variables": variables}).encode("utf-8")
        req = urllib.request.Request(
            ANILIST_API_URL,
            data=req_body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "NovelCompass/1.0 (https://github.com/cbangera2/NovelCompass)",
            },
        )

        try:
            self.last_request_time = time.time()
            with urllib.request.urlopen(req, timeout=30.0) as response:
                content = response.read().decode("utf-8", errors="replace")
                data = json.loads(content)
                if use_cache and "data" in data:
                    with open(cache_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                return data
        except urllib.error.HTTPError as e:
            err_text = e.read().decode("utf-8", errors="replace")
            print(f"[AniListClient HTTPError {e.code}] {err_text[:200]}")
            return {"error": f"HTTP {e.code}", "detail": err_text}
        except Exception as e:
            print(f"[AniListClient Error] {e}")
            return {"error": str(e)}

    def fetch_popular_manga(self, page: int = 1, per_page: int = 20) -> Dict[str, Any]:
        return self.query(MEDIA_QUERY, {"page": page, "perPage": per_page, "type": "MANGA", "sort": ["POPULARITY_DESC"]})

    def search_manga(self, search_text: str, page: int = 1, per_page: int = 20) -> Dict[str, Any]:
        return self.query(MEDIA_QUERY, {"page": page, "perPage": per_page, "search": search_text, "type": "MANGA"})

    def fetch_manga_by_id(self, anilist_id: int) -> Dict[str, Any]:
        return self.query(MEDIA_QUERY, {"id": anilist_id, "page": 1, "perPage": 1, "type": "MANGA"})

    def fetch_popular_anime(self, page: int = 1, per_page: int = 20) -> Dict[str, Any]:
        return self.query(MEDIA_QUERY, {"page": page, "perPage": per_page, "type": "ANIME", "sort": ["POPULARITY_DESC"]})

    def search_anime(self, search_text: str, page: int = 1, per_page: int = 20) -> Dict[str, Any]:
        return self.query(MEDIA_QUERY, {"page": page, "perPage": per_page, "search": search_text, "type": "ANIME"})

    def fetch_anime_by_id(self, anilist_id: int) -> Dict[str, Any]:
        return self.query(MEDIA_QUERY, {"id": anilist_id, "page": 1, "perPage": 1, "type": "ANIME"})
