import sys
import argparse
import sqlite3
from typing import Dict, Any

from src.db.schema import init_db
from src.db.repository import Repository
from src.engine.candidate_gen import CandidateGenerator
from src.engine.filters import HardFilterEngine
from src.engine.rrf_ranker import calculate_rrf_scores, calculate_bayesian_rating, apply_hidden_gem_boost
from src.engine.explainer import EvidenceExplainer

def find_novel_by_title_or_id(conn: sqlite3.Connection, query: str) -> Dict[str, Any]:
    cur = conn.cursor()
    if query.isdigit():
        cur.execute("SELECT id, title, slug FROM novels WHERE id = ?", (int(query),))
    else:
        cur.execute("SELECT id, title, slug FROM novels WHERE title LIKE ? OR slug LIKE ?", (f"%{query}%", f"%{query}%"))

    row = cur.fetchone()
    if row:
        return {'id': row[0], 'title': row[1], 'slug': row[2]}
    return None

def recommend(
    seed_query: str,
    limit: int = 20,
    hidden_gem_mode: bool = False,
    exclude_harem: bool = False,
    exclude_bl: bool = False
):
    conn = init_db()
    seed_novel = find_novel_by_title_or_id(conn, seed_query)
    if not seed_novel:
        print(f"Error: Could not find novel matching '{seed_query}' in database.")
        sys.exit(1)

    seed_id = seed_novel['id']
    print(f"\n=======================================================")
    print(f" Recommendations for: {seed_novel['title']} (ID: {seed_id})")
    print(f"=======================================================\n")

    # Candidate generation
    cand_gen = CandidateGenerator(conn)
    channels = cand_gen.get_candidate_channels(seed_id, limit_per_channel=150)

    # Filter candidates
    filter_engine = HardFilterEngine(conn)
    exclude_tags = []
    if exclude_harem:
        exclude_tags.extend(['harem', 'reverse harem'])
    if exclude_bl:
        exclude_tags.extend(['yaoi', 'bl', 'boys love', 'shounen ai'])

    preferences = {
        'exclude_tags': exclude_tags,
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

    rrf_scores = calculate_rrf_scores(filtered_channels)

    # Apply Hidden Gem Boost if enabled
    final_scores = {}
    cur = conn.cursor()
    for nid, score in rrf_scores.items():
        cur.execute("SELECT reading_list_count FROM novels WHERE id = ?", (nid,))
        r_row = cur.fetchone()
        rlist_cnt = r_row[0] if r_row else 0
        if hidden_gem_mode:
            final_scores[nid] = apply_hidden_gem_boost(score, rlist_cnt)
        else:
            final_scores[nid] = score

    # Sort top recommendations
    sorted_recs = sorted(final_scores.items(), key=lambda x: x[1], reverse=True)[:limit]

    # Explain recommendations
    explainer = EvidenceExplainer(conn)
    for idx, (target_id, score) in enumerate(sorted_recs, 1):
        # Build channel ranks map for target
        ch_ranks = {}
        for ch_name, cands in channels.items():
            for r_idx, (nid, _) in enumerate(cands, 1):
                if nid == target_id:
                    ch_ranks[ch_name] = r_idx
                    break

        exp = explainer.explain_recommendation(seed_id, target_id, score, ch_ranks)
        print(f"{idx:2d}. {exp.get('title')} (Rating: {exp.get('rating')} | Lists: {exp.get('reading_list_count')})")
        print(f"    RRF Score: {exp.get('rrf_score')}")
        for bullet in exp.get('evidence_bullets', []):
            print(f"    - {bullet}")
        print()

def main():
    parser = argparse.ArgumentParser(description="Novel Updates Recommendation CLI Engine")
    parser.add_argument("query", type=str, help="Seed novel title or ID")
    parser.add_argument("--limit", type=int, default=20, help="Number of recommendations to return")
    parser.add_argument("--hidden-gem", action="store_true", help="Enable hidden gem boost")
    parser.add_argument("--exclude-harem", action="store_true", help="Exclude harem titles")
    parser.add_argument("--exclude-bl", action="store_true", help="Exclude BL/Yaoi titles")

    args = parser.parse_args()
    recommend(
        seed_query=args.query,
        limit=args.limit,
        hidden_gem_mode=args.hidden_gem,
        exclude_harem=args.exclude_harem,
        exclude_bl=args.exclude_bl
    )

if __name__ == '__main__':
    main()
