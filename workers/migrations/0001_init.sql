-- NovelCompass D1 schema.
-- Ported from src/db/schema.py. D1 is SQLite, so this is nearly verbatim.
-- The crawl_queue / scrape_runs / artifact_metadata tables are omitted:
-- the scraper runs on a VM, not on the edge. Only serving tables live in D1.
-- vector_neighbors is new: precomputed top-K embedding neighbors per novel,
-- populated by the refresh pipeline (scripts/export_vector_neighbors.py).

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
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    PRIMARY KEY (novel_id, tag_id)
);

CREATE TABLE IF NOT EXISTS genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS novel_genres (
    novel_id INTEGER,
    genre_id INTEGER,
    PRIMARY KEY (novel_id, genre_id)
);

CREATE TABLE IF NOT EXISTS direct_recs (
    source_novel_id INTEGER,
    target_novel_id INTEGER,
    is_mutual INTEGER DEFAULT 0,
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
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS rec_list_items (
    list_id INTEGER,
    novel_id INTEGER,
    position INTEGER,
    tier TEXT,
    comment TEXT,
    PRIMARY KEY (list_id, novel_id)
);

CREATE TABLE IF NOT EXISTS vector_neighbors (
    source_novel_id INTEGER NOT NULL,
    target_novel_id INTEGER NOT NULL,
    score REAL NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (source_novel_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_vector_neighbors_source ON vector_neighbors(source_novel_id);

CREATE INDEX IF NOT EXISTS idx_novels_title ON novels(title);
CREATE INDEX IF NOT EXISTS idx_novels_rating ON novels(rating);
CREATE INDEX IF NOT EXISTS idx_novels_author ON novels(author);
CREATE INDEX IF NOT EXISTS idx_novels_media_type ON novels(media_type);
CREATE INDEX IF NOT EXISTS idx_novels_source ON novels(source);
CREATE INDEX IF NOT EXISTS idx_rec_list_items_novel ON rec_list_items(novel_id);
CREATE INDEX IF NOT EXISTS idx_direct_recs_target ON direct_recs(target_novel_id);
CREATE INDEX IF NOT EXISTS idx_related_series_target ON related_series(target_novel_id);
CREATE INDEX IF NOT EXISTS idx_novel_tags_tag_novel ON novel_tags(tag_id, novel_id);
