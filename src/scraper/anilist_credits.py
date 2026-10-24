"""Pick the people and studios worth showing as an AniList title's "author".

AniList staff lists are long: anime carry every episode director, key animator and dub
engineer, and the studio list includes licensors and distributors. Only the original
creator, the credited story/art/illustration roles, the series director and the animation
studios identify the work, so everything else is dropped.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

# Normalised role (lowercase, no "(eps 1-3)" suffix) -> sort tier. Creators come before directors;
# AniList's own order is kept within a tier.
CREATOR_ROLES: Dict[str, int] = {
    "original creator": 0,
    "original story": 0,
    "original work": 0,
    "story": 0,
    "story & art": 0,
    "story and art": 0,
    "art": 0,
    "illustration": 0,
    "illustrator": 0,
    "director": 1,
    "series director": 1,
    "chief director": 1,
}

MAX_PEOPLE = 3
MAX_STUDIOS = 2

# "(eps 1-3)" or "(ch 12)" only say where in the work a credit applies. Other notes such as
# "(English; Netflix)" mark dub and localisation credits, which are not the work's creators.
_COVERAGE_NOTE = re.compile(r"\s*\((?:eps?|chs?|chapters?|vols?|op|ed)\b[^)]*\)\s*", re.IGNORECASE)


def _normalise_role(role: str) -> str:
    return _COVERAGE_NOTE.sub(" ", role or "").strip().lower()


def extract_creators(media: Dict[str, Any]) -> List[str]:
    """Creators first (in role order), then animation studios. Deduplicated and capped."""
    ranked: List[tuple[int, int, str]] = []
    for index, edge in enumerate((media.get("staff") or {}).get("edges") or []):
        priority = CREATOR_ROLES.get(_normalise_role(edge.get("role") or ""))
        if priority is None:
            continue
        name = ((edge.get("node") or {}).get("name") or {}).get("full")
        if name:
            ranked.append((priority, index, name))

    people: List[str] = []
    for _, _, name in sorted(ranked):
        if name not in people:
            people.append(name)
    people = people[:MAX_PEOPLE]

    studios: List[str] = []
    for studio in (media.get("studios") or {}).get("nodes") or []:
        # Licensors and distributors come back with isAnimationStudio=false. Older payloads
        # without the flag keep their studios.
        if studio.get("isAnimationStudio") is False:
            continue
        name = studio.get("name")
        if name and name not in people and name not in studios:
            studios.append(name)

    return people + studios[:MAX_STUDIOS]
