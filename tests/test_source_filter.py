from src.api.main import source_sql_filter


def test_all_or_empty_source_is_unfiltered():
    assert source_sql_filter("all") == (None, [])
    assert source_sql_filter("") == (None, [])
    assert source_sql_filter("novelupdates,all") == (None, [])


def test_single_source_matches_as_before():
    assert source_sql_filter("anilist") == ("COALESCE(source, 'novelupdates') IN (?)", ["anilist"])


def test_comma_separated_sources_become_an_in_clause():
    clause, params = source_sql_filter(" NovelUpdates , anilist ", "COALESCE(n.source, 'novelupdates')")
    assert clause == "COALESCE(n.source, 'novelupdates') IN (?, ?)"
    assert params == ["novelupdates", "anilist"]
