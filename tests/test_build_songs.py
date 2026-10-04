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
