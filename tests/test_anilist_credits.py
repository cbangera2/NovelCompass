from src.scraper.anilist_credits import extract_creators


def staff(*pairs):
    return {"edges": [{"role": role, "node": {"name": {"full": name}}} for role, name in pairs]}


def studios(*pairs):
    return {"nodes": [{"name": name, "isAnimationStudio": is_animation} for name, is_animation in pairs]}


def test_anime_keeps_creator_director_and_animation_studio_only():
    media = {
        "staff": staff(
            ("ADR Director", "Mary Elizabeth McGlynn"),
            ("Key Animation", "Yutaka Nakamura"),
            ("Episode Director (eps 4, 9)", "Tensai Okamura"),
            ("Assistant Producer", "Someone Else"),
            ("Background Art", "Backdrop Artist"),
            ("Director", "Shinichirou Watanabe"),
            ("Original Creator", "Hajime Yatate"),
        ),
        "studios": studios(("Sunrise", True), ("Bandai Visual", False), ("Funimation", False)),
    }
    assert extract_creators(media) == ["Hajime Yatate", "Shinichirou Watanabe", "Sunrise"]


def test_manga_credits_keep_anilist_order():
    media = {"staff": staff(("Art", "Artist"), ("Story", "Writer"), ("Translator", "Skip Me"))}
    assert extract_creators(media) == ["Artist", "Writer"]


def test_role_suffixes_are_ignored_and_names_deduplicated():
    media = {"staff": staff(("Story & Art (ch 1-20)", "Same Person"), ("Original Creator", "Same Person"))}
    assert extract_creators(media) == ["Same Person"]


def test_dub_and_localisation_directors_are_ignored():
    media = {
        "staff": staff(
            ("Director (English; Netflix)", "Dub Director"),
            ("Director (Brazilian Portuguese; 3ª dub)", "Another Dub Director"),
            ("Director", "Hideaki Anno"),
            ("Episode Director (ep 9)", "Seiji Mizushima"),
        )
    }
    assert extract_creators(media) == ["Hideaki Anno"]


def test_people_and_studios_are_capped():
    media = {
        "staff": staff(*[("Director", f"Director {i}") for i in range(6)]),
        "studios": studios(*[(f"Studio {i}", True) for i in range(4)]),
    }
    assert extract_creators(media) == ["Director 0", "Director 1", "Director 2", "Studio 0", "Studio 1"]


def test_studios_without_the_animation_flag_are_kept():
    assert extract_creators({"studios": {"nodes": [{"name": "Madhouse"}]}}) == ["Madhouse"]


def test_empty_media_has_no_creators():
    assert extract_creators({}) == []
