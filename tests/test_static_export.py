import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from build_static_export import CATALOG_FIELDS, bucket_for_id, export_static_dataset
from src.db.schema import init_db


class FakeCandidateGenerator:
    def __init__(self, _conn):
        pass

    def get_candidate_channels(self, seed_id, limit_per_channel):
        if seed_id == 1:
            return {"tag": [(257, 0.8)], "direct_rec": [(257, 1.0)]}
        return {}


class StaticExportTest(unittest.TestCase):
    def test_bucket_is_lowercase_and_zero_padded(self):
        self.assertEqual(bucket_for_id(1), "01")
        self.assertEqual(bucket_for_id(15), "0f")
        self.assertEqual(bucket_for_id(257), "01")

    def test_normalized_export_is_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "test.db"
            conn = init_db(str(database))
            with conn:
                conn.executemany(
                    """INSERT INTO novels
                       (id, slug, title, associated_names, author, language, synopsis,
                        rating, rating_votes, reading_list_count, chapters_orig,
                        chapters_trans, status_trans, year, cover_url)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [
                        (1, "one", "One", '["Uno"]', "A", "Chinese", "First", 4.2, 10, 20, 100, 90, "Completed", 2020, "one.jpg"),
                        (257, "two", "Two", None, "B", "Japanese", "Second", 4.0, 5, 8, 50, 40, "Ongoing", 2021, "two.jpg"),
                    ],
                )
                conn.execute("INSERT INTO genres(id, name) VALUES (1, 'Fantasy')")
                conn.execute("INSERT INTO tags(id, name) VALUES (1, 'Academy')")
                conn.executemany("INSERT INTO novel_genres VALUES (?, 1)", [(1,), (257,)])
                conn.executemany("INSERT INTO novel_tags VALUES (?, 1)", [(1,), (257,)])
                conn.execute("INSERT INTO direct_recs VALUES (1, 257, 1, 3)")
            conn.close()

            with patch("build_static_export.CandidateGenerator", FakeCandidateGenerator):
                manifest = export_static_dataset(root / "out", max_novels=1, db_path=str(database))

            catalog = json.loads((root / "out/catalog.json").read_text())
            self.assertEqual(catalog["fields"], list(CATALOG_FIELDS))
            self.assertEqual(catalog["rows"][0][1], "one")
            self.assertEqual(catalog["rows"][0][-1], [0])
            self.assertEqual(catalog["aliases"], [[1, ["Uno"]]])
            self.assertEqual(catalog["genres"], ["Fantasy"])
            self.assertEqual(catalog["tags"], ["Academy"])
            pool = json.loads((root / "out/recs/01/1.json").read_text())
            self.assertEqual(pool["candidates"][0]["r"], [1, 1, None, None, None])
            self.assertEqual(pool["candidates"][0]["shared_tag_ids"], [0])
            self.assertEqual(pool["candidates"][0]["direct_votes"], 3)
            empty = json.loads((root / "out/recs/01/257.json").read_text())
            self.assertEqual(empty["reason"], "not_precomputed")
            detail = json.loads((root / "out/details/01/1.json").read_text())
            self.assertEqual(detail["novelupdates_url"], "https://www.novelupdates.com/?p=1")
            self.assertEqual(manifest["novel_count"], 2)


if __name__ == "__main__":
    unittest.main()
