"""Pick the people and studios worth showing as an AniList title's "author".

AniList staff lists are long: anime carry every episode director, key animator and dub
engineer, and the studio list includes licensors and distributors. Only the original
creator, the credited story/art/illustration roles, the series director and the animation
studios identify the work, so everything else is dropped.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

# Normalised role (lowercase, no "(eps 1-3)" suffix) -> sort priority. Lower sorts first.
CREATOR_ROLES: Dict[str, int] = {
    "original creator": 0,
    "original story": 0,
    "original work": 0,
    "story": 1,
    "story & art": 1,
    "story and art": 1,
    "art": 2,
    "illustration": 2,
    "illustrator": 2,
    "director": 3,
    "series director": 3,
    "chief director": 3,
}

MAX_PEOPLE = 3
MAX_STUDIOS = 2

_PARENTHETICAL = re.compile(r"\s*\(.*?\)\s*")


def _normalise_role(role: str) -> str:
    return _PARENTHETICAL.sub(" ", role or "").strip().lower()


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
