import pytest

from data import build_songs as b

HTML = """
<table><tr><th>Year</th><th>Venue</th></tr><tr><td>2023</td><td>Liverpool</td></tr></table>
<table>
<tr><th>Country</th><th>Broadcaster</th><th>Artist</th><th>Song</th><th>Language</th></tr>
<tr><td>Sweden[a]</td><td>SVT</td><td>Loreen</td><td>"Tattoo"</td><td>English</td></tr>
<tr><td>Armenia</td><td>AMPTV</td><td>Sevak Khanagyan[b]</td><td>"Qami" (Քամի)</td><td>Armenian</td></tr>
<tr><td>Czechia</td><td>ČT</td><td>Vesna</td><td>"My Sister's Crown"</td><td>English</td></tr>
</table>
"""


def test_parse_participants_reads_the_participants_table():
    songs = b.parse_participants(HTML, 2023)
    assert [s["id"] for s in songs] == ["2023-SE", "2023-AM", "2023-CZ"]
    assert songs[0] == {
        "id": "2023-SE", "year": 2023, "country": "Sweden", "cc": "SE",
        "artist": "Loreen", "title": "Tattoo",
    }


def test_parse_participants_cleans_footnotes_and_translations():
    songs = b.parse_participants(HTML, 2023)
    assert songs[1]["artist"] == "Sevak Khanagyan"
    assert songs[1]["title"] == "Qami"
    assert songs[2]["title"] == "My Sister's Crown"


def test_parse_participants_rejects_unknown_country():
    with pytest.raises(ValueError, match="Atlantis"):
        b.parse_participants(HTML.replace("Sweden[a]", "Atlantis"), 2023)


def test_parse_participants_without_table_fails_loudly():
    with pytest.raises(ValueError, match="2023"):
        b.parse_participants("<table><tr><th>X</th></tr><tr><td>1</td></tr></table>", 2023)


RESULTS = [
    {"artistName": "Loreen", "trackName": "Tattoo (Acoustic)", "previewUrl": "acoustic"},
    {"artistName": "Rauw Alejandro", "trackName": "Tattoo", "previewUrl": "wrong-artist"},
    {"artistName": "Loreen", "trackName": "Tattoo", "previewUrl": "right"},
]


def test_normalize_strips_accents_and_punctuation():
    assert b.normalize("Käärijä – Cha Cha Cha!") == "kaarija cha cha cha"


def test_pick_preview_prefers_exact_title_and_matching_artist():
    assert b.pick_preview(RESULTS, "Loreen", "Tattoo") == "right"


def test_pick_preview_rejects_acoustic_versions_and_other_artists():
    assert b.pick_preview(RESULTS[:2], "Loreen", "Tattoo") is None


def test_pick_preview_rejects_remix():
    results = [{"artistName": "Loreen & Topic", "trackName": "Tattoo (Topic Remix)", "previewUrl": "remix"}]
    assert b.pick_preview(results, "Loreen", "Tattoo") is None


def test_pick_preview_accepts_eurovision_version():
    results = [{"artistName": "Eugent Bushpepa", "trackName": "Mall (Eurovision Version)", "previewUrl": "ev"}]
    assert b.pick_preview(results, "Eugent Bushpepa", "Mall") == "ev"


def test_pick_preview_matches_featuring_artists_loosely():
    results = [{"artistName": "Ilinca & Alex Florea", "trackName": "Yodel It!", "previewUrl": "y"}]
    assert b.pick_preview(results, "Ilinca featuring Alex Florea", "Yodel It!") == "y"


def test_pick_preview_handles_short_artist_names():
    results = [{"artistName": "Go_A", "trackName": "Shum", "previewUrl": "s"}]
    assert b.pick_preview(results, "Go_A", "Shum") == "s"


def test_pick_preview_needs_preview_url():
    results = [{"artistName": "Loreen", "trackName": "Tattoo"}]
    assert b.pick_preview(results, "Loreen", "Tattoo") is None


def test_find_preview_falls_back_to_title_only_search():
    calls = []

    def fake_search(term):
        calls.append(term)
        return [] if term == "Loreen Tattoo" else RESULTS

    assert b.find_preview("Loreen", "Tattoo", search=fake_search) == "right"
    assert calls == ["Loreen Tattoo", "Tattoo"]


def test_youtube_link():
    song = {"year": 2023, "country": "Sweden", "artist": "Loreen", "title": "Tattoo"}
    assert b.youtube_link(song) == (
        "https://www.youtube.com/results?search_query=Eurovision+2023+Sweden+Loreen+Tattoo"
    )


def test_apply_overrides_sets_fields_and_empty_means_none():
    songs = [{"id": "2023-SE", "title": "Tatto", "preview": "x"}]
    rows = [
        {"id": "2023-SE", "veld": "title", "waarde": "Tattoo"},
        {"id": "2023-SE", "veld": "preview", "waarde": ""},
    ]
    assert b.apply_overrides(songs, rows) == [{"id": "2023-SE", "title": "Tattoo", "preview": None}]


def test_apply_overrides_rejects_unknown_id():
    with pytest.raises(ValueError, match="2099-XX"):
        b.apply_overrides([], [{"id": "2099-XX", "veld": "title", "waarde": "x"}])


def test_pick_preview_rejects_dub_and_other_language_versions():
    for name in ["Because of You (Captain E's Gluten-Free Dub)", "SNAP (Italian)", "Özünlə Apar [OKtava Version]"]:
        title = b.base_title(name)
        results = [{"artistName": "X Artist", "trackName": name, "previewUrl": "bad"}]
        assert b.pick_preview(results, "X Artist", title) is None, name


def test_artist_matching_ignores_stopwords():
    results = [{"artistName": "The Rasmus", "trackName": "Jezebel", "previewUrl": "ok"},
               {"artistName": "The Other Band", "trackName": "Jezebel", "previewUrl": "bad"}]
    assert b.pick_preview(results[1:], "The Rasmus", "Jezebel") is None
    assert b.pick_preview(results, "The Rasmus", "Jezebel") == "ok"


def test_title_only_fallback_needs_the_full_main_artist():
    def fake_search(term):
        if term == "Carpe Diem":
            return [{"artistName": "Jolly Joker", "trackName": "Carpe Diem", "previewUrl": "wrong"}]
        return []

    assert b.find_preview("Joker Out", "Carpe Diem", search=fake_search) is None


def test_title_only_fallback_still_finds_featuring_artists():
    def fake_search(term):
        if term == "Yodel It!":
            return [{"artistName": "Ilinca & Alex Florea", "trackName": "Yodel It!", "previewUrl": "y"}]
        return []

    assert b.find_preview("Ilinca featuring Alex Florea", "Yodel It!", search=fake_search) == "y"


def test_pick_preview_accepts_country_feat_and_original_suffixes():
    cases = [
        ("Benny Cristo", "Omaga", "Omaga (Eurovision 2021 - Czech Republic)"),
        ("Cláudia Pascoal", "O jardim", "O Jardim (feat. Isaura)"),
        ("Samanta Tīna", "The Moon Is Rising", "The Moon Is Rising (Original)"),
    ]
    for artist, title, track in cases:
        results = [{"artistName": artist, "trackName": track, "previewUrl": "ok"}]
        assert b.pick_preview(results, artist, title) == "ok", track


def test_title_only_fallback_accepts_stage_names():
    def fake_search(term):
        if term == "Proud":
            return [{"artistName": "Tamara", "trackName": "Proud", "previewUrl": "ok"}]
        return []

    assert b.find_preview("Tamara Todevska", "Proud", search=fake_search) == "ok"


def test_artist_made_only_of_stopwords_does_not_match_everyone():
    def fake_search(term):
        if term == "Sister":
            return [{"artistName": "Lenny Kravitz", "trackName": "Sister", "previewUrl": "wrong"}]
        return []

    assert b.find_preview("Sisters", "Sister", search=fake_search) is None


def test_feat_part_does_not_excuse_other_versions():
    track = "Özünlə Apar (feat. İlkin Dövlətov) [OKtava Version]"
    results = [{"artistName": "Fahree", "trackName": track, "previewUrl": "bad"}]
    assert b.pick_preview(results, "Fahree feat. Ilkin Dovlatov", "Özünlə apar") is None
