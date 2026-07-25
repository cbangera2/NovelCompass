"""Shared recommendation scoring contract.

Keep these values and helpers stable across API and static builds. Increment
``ALGORITHM_VERSION`` whenever candidate generation, ranking, or match-score
normalization changes in a way that can alter recommendation output.
"""

from typing import Dict, Iterable


SCHEMA_VERSION = 1
ALGORITHM_VERSION = 1
RRF_K = 60


def calculate_match_percent(
    score: float,
    active_channels: Iterable[str],
    channel_weights: Dict[str, float],
    *,
    k: int = RRF_K,
) -> int:
    """Normalize an RRF score against a rank-one result in every active channel.

    Hidden-gem boosts intentionally do not affect this value. The result is
    clamped so API and static clients always expose a stable 0–100 contract.
    """
    theoretical_max = sum(
        max(0.0, channel_weights.get(channel_name, 1.0)) / (k + 1)
        for channel_name in active_channels
    )
    if theoretical_max <= 0:
        return 0
    return round(max(0.0, min(100.0, (score / theoretical_max) * 100)))
