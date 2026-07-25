import re
import sqlite3
from typing import Dict, List, Tuple

TOPIC_PATTERNS = {
    "female_yandere": [
        r'\bfemale yandere\b', r'\byandere heroine\b', r'\byandere girl\b', r'\obsessive heroine\b'
    ],
    "male_yandere": [
        r'\bmale yandere\b', r'\byandere hero\b', r'\byandere male\b'
    ],
    "yandere_general": [
        r'\byandere\b', r'\bobsessive love\b'
    ],
    "tragedy_suffering": [
        r'\btragedy\b', r'\bsuffering\b', r'\bself-sacrifice\b', r'\bdepression\b', r'\bangst\b'
    ],
    "regret_misunderstanding": [
        r'\bregret\b', r'\bmisunderstanding\b', r'\bmisunderstandings\b', r'\brepentance\b'
    ],
    "smart_mc": [
        r'\bsmart (mc|protagonist|male|hero)\b', r'\bcunning (mc|protagonist)\b', r'\bintelligent (mc|protagonist)\b'
    ],
    "unwilling_mc": [
        r'\bunwilling (mc|protagonist|male)\b', r'\breluctant (mc|protagonist)\b', r'\bforced (relationship|romance)\b'
    ],
    "hidden_gem": [
        r'\bhidden gem\b', r'\bunderrated\b', r'\bunder-rated\b', r'\bunpopular gem\b'
    ],
    "no_harem": [
        r'\bno harem\b', r'\bnon-harem\b', r'\bsingle female lead\b', r'\bmonogamy\b'
    ]
}

def extract_topics_from_text(text: str) -> List[Tuple[str, float]]:
    if not text:
        return []
    text_lower = text.lower()
    found_topics = []

    for topic_name, patterns in TOPIC_PATTERNS.items():
        for pat in patterns:
            if re.search(pat, text_lower):
                found_topics.append((topic_name, 1.0))
                break

    return found_topics

def process_rec_list_topics(conn: sqlite3.Connection):
    """
    Parses all recommendation lists and item comments in DB to populate topics and novel_topics tables.
    """
    cur = conn.cursor()

    # 1. Ensure default topics exist in DB
    for topic_name in TOPIC_PATTERNS.keys():
        cur.execute("INSERT OR IGNORE INTO topics (name) VALUES (?)", (topic_name,))

    # 2. Process list descriptions
    cur.execute("SELECT id, title, description FROM rec_lists")
    lists = cur.fetchall()

    for list_id, title, desc in lists:
        combined_text = f"{title} {desc or ''}"
        topics = extract_topics_from_text(combined_text)

        # Get item IDs for this list
        cur.execute("SELECT novel_id, comment FROM rec_list_items WHERE list_id = ?", (list_id,))
        items = cur.fetchall()

        for novel_id, comment in items:
            # Combine list topics with item comment topics
            item_topics = dict(topics)
            if comment:
                for t_name, score in extract_topics_from_text(comment):
                    item_topics[t_name] = max(item_topics.get(t_name, 0.0), score)

            for t_name, confidence in item_topics.items():
                cur.execute("SELECT id FROM topics WHERE name = ?", (t_name,))
                t_id = cur.fetchone()[0]
                cur.execute("""
                    INSERT INTO novel_topics (novel_id, topic_id, confidence, evidence)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(novel_id, topic_id) DO UPDATE SET
                        confidence = MAX(novel_topics.confidence, excluded.confidence)
                """, (novel_id, t_id, confidence, f"rec_list_{list_id}"))

    conn.commit()
    print("Processed recommendation list topics successfully.")
