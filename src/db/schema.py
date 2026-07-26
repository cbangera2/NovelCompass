import os
import sqlite3

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "recommender.db")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS novels (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE,
    title TEXT NOT NULL,
    associated_names TEXT,
    author TEXT,
    language TEXT,
    synopsis TEXT,
    rating REAL DEFAULT 0.0,
    rating_votes INTEGER DEFAULT 0,
    rating_votes_5 INTEGER DEFAULT 0,
    rating_votes_4 INTEGER DEFAULT 0,
    rating_votes_3 INTEGER DEFAULT 0,
    rating_votes_2 INTEGER DEFAULT 0,
    rating_votes_1 INTEGER DEFAULT 0,
    reading_list_count INTEGER DEFAULT 0,
    chapters_orig INTEGER DEFAULT 0,
    chapters_trans INTEGER DEFAULT 0,
    status_trans TEXT,
    year INTEGER,
    cover_url TEXT,
    media_type TEXT DEFAULT 'novel',
    source TEXT DEFAULT 'novelupdates',
    external_id TEXT,
    external_url TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category TEXT DEFAULT 'general',
    idf_weight REAL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS novel_tags (
    novel_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (novel_id, tag_id),
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS novel_genres (
    novel_id INTEGER,
    genre_id INTEGER,
    PRIMARY KEY (novel_id, genre_id),
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS direct_recs (
    source_novel_id INTEGER,
    target_novel_id INTEGER,
    is_mutual BOOLEAN DEFAULT 0,
    votes INTEGER DEFAULT 1,
    PRIMARY KEY (source_novel_id, target_novel_id)
);

CREATE TABLE IF NOT EXISTS related_series (
    source_novel_id INTEGER,
    target_novel_id INTEGER,
    relation_type TEXT,
    PRIMARY KEY (source_novel_id, target_novel_id)
);

CREATE TABLE IF NOT EXISTS rec_lists (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    curator TEXT,
    followers INTEGER DEFAULT 0,
    item_count INTEGER DEFAULT 0,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS rec_list_items (
    list_id INTEGER,
    novel_id INTEGER,
    position INTEGER,
    tier TEXT,
    comment TEXT,
    PRIMARY KEY (list_id, novel_id),
    FOREIGN KEY (list_id) REFERENCES rec_lists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    keywords TEXT
);

CREATE TABLE IF NOT EXISTS novel_topics (
    novel_id INTEGER,
    topic_id INTEGER,
    confidence REAL DEFAULT 1.0,
    evidence TEXT,
    PRIMARY KEY (novel_id, topic_id),
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crawl_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    item_id INTEGER,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    phase TEXT DEFAULT 'refresh_existing',
    last_error TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    status TEXT DEFAULT 'running',
    pages_scraped INTEGER DEFAULT 0,
    pages_cached INTEGER DEFAULT 0,
    pages_discovered INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    stop_reason TEXT,
    heartbeat_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_novels_title ON novels(title);
CREATE INDEX IF NOT EXISTS idx_novels_rating ON novels(rating);
CREATE INDEX IF NOT EXISTS idx_novels_author ON novels(author);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_status ON crawl_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_rec_list_items_novel ON rec_list_items(novel_id);
CREATE INDEX IF NOT EXISTS idx_direct_recs_target ON direct_recs(target_novel_id);
CREATE INDEX IF NOT EXISTS idx_related_series_target ON related_series(target_novel_id);
CREATE INDEX IF NOT EXISTS idx_novel_tags_tag_novel ON novel_tags(tag_id, novel_id);

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    base_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS source_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    novel_id INTEGER,
    raw_media_type TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_key, external_id),
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);
"""

def get_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn

def init_db(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    conn = get_connection(db_path)
    with conn:
        conn.executescript(SCHEMA_SQL)
        # Lightweight forward migrations for databases created by older builds.
        novel_cols = {
            row["name"] for row in conn.execute("PRAGMA table_info(novels)")
        }
        for star in range(1, 6):
            col = f"rating_votes_{star}"
            if col not in novel_cols:
                conn.execute(f"ALTER TABLE novels ADD COLUMN {col} INTEGER DEFAULT 0")

        # Multi-source and multi-media migrations
        for name, declaration in (
            ("media_type", "TEXT DEFAULT 'novel'"),
            ("source", "TEXT DEFAULT 'novelupdates'"),
            ("external_id", "TEXT"),
            ("external_url", "TEXT"),
        ):
            if name not in novel_cols:
                conn.execute(f"ALTER TABLE novels ADD COLUMN {name} {declaration}")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_novels_media_type ON novels(media_type)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_novels_source ON novels(source)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_novels_external_id ON novels(source, external_id)")

        existing = {
            row["name"] for row in conn.execute("PRAGMA table_info(scrape_runs)")
        }
        for name, declaration in (
            ("pages_cached", "INTEGER DEFAULT 0"),
            ("pages_discovered", "INTEGER DEFAULT 0"),
            ("stop_reason", "TEXT"),
            ("heartbeat_at", "DATETIME"),
        ):
            if name not in existing:
                conn.execute(
                    f"ALTER TABLE scrape_runs ADD COLUMN {name} {declaration}"
                )
        queue_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(crawl_queue)")
        }
        if "phase" not in queue_columns:
            conn.execute(
                "ALTER TABLE crawl_queue ADD COLUMN phase TEXT "
                "DEFAULT 'refresh_existing'"
            )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_crawl_queue_phase
            ON crawl_queue(status, phase, priority DESC)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS artifact_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                base_url TEXT,
                enabled INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS source_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_key TEXT NOT NULL,
                external_id TEXT NOT NULL,
                novel_id INTEGER,
                raw_media_type TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (source_key, external_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
            )
            """
        )
        # Register default sources
        conn.execute(
            "INSERT OR IGNORE INTO sources (key, display_name, base_url) VALUES ('novelupdates', 'Novel Updates', 'https://www.novelupdates.com')"
        )
        conn.execute(
            "INSERT OR IGNORE INTO sources (key, display_name, base_url) VALUES ('anilist', 'AniList', 'https://anilist.co')"
        )
    return conn

if __name__ == "__main__":
    conn = init_db()
    print(f"Initialized database at {DEFAULT_DB_PATH}")
