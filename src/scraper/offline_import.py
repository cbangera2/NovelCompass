"""Safe, offline ingestion of Novel Updates HTML captured by the user.

This module deliberately does not expose or consume request headers, cookies,
or other HAR request metadata. Only successful HTML response bodies from the
Novel Updates HTTPS origin are considered.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass, asdict
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from src.db.repository import Repository
from src.scraper.html_parser import (
    parse_discovery_page,
    parse_series_page,
    parse_viewlist_page,
)


MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_HTML_BYTES = 8 * 1024 * 1024
CHALLENGE_MARKERS = (
    "cf-chl-",
    "cloudflare ray id",
    "just a moment...",
    "checking your browser",
    "verify you are human",
    "attention required!",
)


@dataclass
class ImportSummary:
    accepted: int = 0
    rejected: int = 0
    duplicate: int = 0
    parse_failed: int = 0
    novels_updated: int = 0
    novels_queued: int = 0
    lists_updated: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def is_novelupdates_https(url: str) -> bool:
    parts = urlsplit(url)
    return (
        parts.scheme.lower() == "https"
        and (parts.hostname or "").lower()
        in {"novelupdates.com", "www.novelupdates.com"}
    )


def looks_like_challenge(html: str) -> bool:
    sample = html[:250_000].lower()
    return any(marker in sample for marker in CHALLENGE_MARKERS)


def classify_page(url: str, html: str) -> str | None:
    path = urlsplit(url).path.rstrip("/")
    if path.startswith("/series/") or re.search(r"[?&]p=\d+", url):
        return "novel"
    if path.startswith("/viewlist/"):
        return "rec_list"
    if path.startswith("/user/"):
        return "profile"
    if (
        path.startswith("/latest-series")
        or path.startswith("/series-ranking")
        or path.startswith("/series-finder")
    ):
        return "discovery"
    # Saved pages sometimes lose their original URL; recognizable markup is a
    # safe fallback, but ambiguous documents are rejected.
    if 'id="mypostid"' in html or "seriestitlenu" in html:
        return "novel"
    if "search_main_box_nu" in html and ("uclp_" in html or "lid_" in html):
        return "rec_list"
    return None


def _profile_series(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    urls = []
    seen = set()
    for link in soup.select('a[href*="/series/"]'):
        absolute = urljoin(
            "https://www.novelupdates.com/", link.get("href", "")
        )
        match = re.search(r"/series/([^/]+)/?", urlsplit(absolute).path)
        if match and match.group(1) not in seen:
            seen.add(match.group(1))
            urls.append(absolute)
    return urls


def _process_html(repo: Repository, url: str, html: str, summary: ImportSummary) -> None:
    kind = classify_page(url, html)
    if kind is None:
        raise ValueError("unsupported or unrecognized Novel Updates page")
    if looks_like_challenge(html):
        raise ValueError("anti-bot challenge page")

    if kind == "novel":
        data = parse_series_page(html, url=url)
        novel_id = repo.upsert_novel(data)
        repo.replace_novel_relationships(
            novel_id, data.get("direct_recs", []), data.get("related_series", [])
        )
        summary.novels_updated += 1
    elif kind == "rec_list":
        match = re.search(r"/viewlist/(\d+)", urlsplit(url).path)
        data = parse_viewlist_page(html, int(match.group(1)) if match else None)
        if not data.get("id") or not data.get("title"):
            raise ValueError("recommendation list is missing its ID or title")
        repo.upsert_rec_list(data)
        for item in data.get("items", []):
            if item.get("slug"):
                repo.add_discovered_novel(
                    f"https://www.novelupdates.com/series/{item['slug']}/",
                    item.get("novel_id"),
                    priority=60,
                )
                summary.novels_queued += 1
        summary.lists_updated += 1
    elif kind == "discovery":
        data = parse_discovery_page(html, url)
        if not data["series"]:
            raise ValueError("discovery page contains no series")
        for item in data["series"]:
            repo.add_discovered_novel(item["url"], item.get("id"), priority=60)
            summary.novels_queued += 1
    else:
        urls = _profile_series(html)
        if not urls:
            raise ValueError("profile page contains no series links")
        for item_url in urls:
            repo.add_discovered_novel(item_url, None, priority=65)
            summary.novels_queued += 1


def import_html(repo: Repository, body: bytes, source_url: str) -> dict:
    summary = ImportSummary()
    if not is_novelupdates_https(source_url):
        summary.rejected = 1
        return summary.to_dict()
    if len(body) > MAX_HTML_BYTES:
        summary.rejected = 1
        return summary.to_dict()
    try:
        html = body.decode("utf-8", errors="replace")
        if looks_like_challenge(html):
            summary.rejected = 1
            return summary.to_dict()
        _process_html(repo, source_url, html, summary)
        summary.accepted = 1
    except (ValueError, KeyError, TypeError):
        summary.parse_failed = 1
    return summary.to_dict()


def import_har(repo: Repository, body: bytes) -> dict:
    summary = ImportSummary()
    try:
        document = json.loads(body)
        entries = document["log"]["entries"]
        if not isinstance(entries, list):
            raise TypeError
    except (json.JSONDecodeError, KeyError, TypeError):
        summary.parse_failed = 1
        return summary.to_dict()

    seen: set[str] = set()
    for entry in entries:
        try:
            url = entry["request"]["url"]
            response = entry["response"]
            content = response["content"]
            mime = str(content.get("mimeType", "")).lower()
            text = content.get("text")
            if (
                response.get("status") != 200
                or not is_novelupdates_https(url)
                or "html" not in mime
                or not isinstance(text, str)
            ):
                summary.rejected += 1
                continue
            if url in seen:
                summary.duplicate += 1
                continue
            seen.add(url)
            if content.get("encoding") == "base64":
                decoded = base64.b64decode(text, validate=True)
            else:
                decoded = text.encode("utf-8")
            if len(decoded) > MAX_HTML_BYTES:
                summary.rejected += 1
                continue
            html = decoded.decode("utf-8", errors="replace")
            if looks_like_challenge(html):
                summary.rejected += 1
                continue
            _process_html(repo, url, html, summary)
            summary.accepted += 1
        except (ValueError, KeyError, TypeError, binascii.Error):
            summary.parse_failed += 1
    return summary.to_dict()
