"""Maakt app/songs.json: alle Eurovisie-inzendingen met een link naar een fragment.

Gebruik (vanuit de map ranker/):
    .venv/Scripts/python data/build_songs.py
"""
import csv
import hashlib
import io
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote_plus

import pandas as pd
import requests

YEARS = [2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026]
ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "cache"
OVERRIDES = ROOT / "data" / "overrides.csv"
OUTPUT = ROOT / "app" / "songs.json"
HEADERS = {"User-Agent": "esc-ranker/0.1 (persoonlijk project)"}
# Woorden die na de titel mogen staan ("Mall (Eurovision Version)"); al het andere
# (acoustic, remix, dub, een andere taal...) wijst op een andere versie dan het origineel.
ALLOWED_SUFFIX = {"eurovision", "esc", "song", "contest", "version", "edit", "radio", "single",
                  "official", "original", "from", "entry"}
# Woorden die niets zeggen over welke artiest het is.
ARTIST_STOPWORDS = {"the", "and", "feat", "featuring", "ft", "with", "band", "brothers", "sisters",
                    "orchestra", "duo", "x"}

COUNTRY_CODES = {
    "Albania": "AL", "Armenia": "AM", "Australia": "AU", "Austria": "AT",
    "Azerbaijan": "AZ", "Belarus": "BY", "Belgium": "BE", "Bulgaria": "BG",
    "Croatia": "HR", "Cyprus": "CY", "Czech Republic": "CZ", "Czechia": "CZ",
    "Denmark": "DK", "Estonia": "EE", "Finland": "FI", "France": "FR",
    "Georgia": "GE", "Germany": "DE", "Greece": "GR", "Hungary": "HU",
    "Iceland": "IS", "Ireland": "IE", "Israel": "IL", "Italy": "IT",
    "Latvia": "LV", "Lithuania": "LT", "Luxembourg": "LU", "Macedonia": "MK",
    "North Macedonia": "MK", "Malta": "MT", "Moldova": "MD", "Montenegro": "ME",
    "Netherlands": "NL", "Norway": "NO", "Poland": "PL", "Portugal": "PT",
    "Romania": "RO", "Russia": "RU", "San Marino": "SM", "Serbia": "RS",
    "Slovenia": "SI", "Spain": "ES", "Sweden": "SE", "Switzerland": "CH",
    "Ukraine": "UA", "United Kingdom": "GB",
}


def strip_footnotes(text):
    """Haal voetnoten als [a] of [12] weg."""
    return re.sub(r"\[[^\]]*\]", "", str(text)).strip()


def clean_title(raw):
    """'"Qami" (Քամի)[c]' -> 'Qami': alleen het deel tussen aanhalingstekens."""
    text = strip_footnotes(raw)
    match = re.search(r'"([^"]+)"', text)
    return (match.group(1) if match else text).strip()


def parse_participants(html, year):
    """Lees de deelnemerstabel (Country/Broadcaster/Artist/Song) van een Wikipedia-pagina."""
    for table in pd.read_html(io.StringIO(html)):
        if {"Country", "Broadcaster", "Artist", "Song"} <= set(map(str, table.columns)):
            break
    else:
        raise ValueError(f"Geen deelnemerstabel gevonden voor {year}")

    songs = []
    for _, row in table.iterrows():
        country = strip_footnotes(row["Country"])
        if country not in COUNTRY_CODES:
            raise ValueError(f"Onbekend land in {year}: {country!r} (voeg toe aan COUNTRY_CODES)")
        cc = COUNTRY_CODES[country]
        songs.append({
            "id": f"{year}-{cc}",
            "year": year,
            "country": country,
            "cc": cc,
            "artist": strip_footnotes(row["Artist"]),
            "title": clean_title(row["Song"]),
        })
    return songs


def normalize(text):
    """Kleine letters, zonder accenten en leestekens: 'Käärijä!' -> 'kaarija'."""
    text = unicodedata.normalize("NFKD", str(text).lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def base_title(name):
    """'Tattoo (Acoustic)' -> 'Tattoo'."""
    return re.split(r"\s[\(\[\-]", name)[0]


def artist_words(name):
    """Betekenisvolle woorden van een artiestnaam (zonder stopwoorden; liefst 3+ tekens)."""
    words = [w for w in normalize(name).split() if w not in ARTIST_STOPWORDS] or normalize(name).split()
    return {w for w in words if len(w) >= 3} or set(words)


def artist_matches(wiki_artist, itunes_artist, strict=False):
    """Los: minstens één woord gelijk. Streng: de ene naam zit helemaal in de andere
    ('Tamara' in 'Tamara Todevska' mag; 'Jolly Joker' tegen 'Joker Out' niet)."""
    wiki, itunes = artist_words(wiki_artist), artist_words(itunes_artist)
    if strict:
        return bool(wiki & itunes) and (wiki <= itunes or itunes <= wiki)
    return bool(wiki & itunes)


COUNTRY_WORDS = {w for country in COUNTRY_CODES for w in normalize(country).split()}


def suffix_allowed(name, artist):
    """Mag wat na de titel staat? Alleen woorden uit ALLOWED_SUFFIX, jaartallen, landnamen,
    de artiest zelf, of '(feat. ...)' met een gastartiest."""
    rest = name[len(base_title(name)):]
    # Een gastartiest tussen haakjes is prima; de rest moet daarna nog steeds kloppen.
    rest = re.sub(r"[(\[]\s*(?:feat|featuring|ft|with)\b[^)\]]*[)\]]", "", rest, flags=re.IGNORECASE)
    suffix = normalize(rest).split()
    artist = set(normalize(artist).split())
    return all(w in ALLOWED_SUFFIX or w.isdigit() or w in artist or w in COUNTRY_WORDS for w in suffix)


def pick_preview(results, artist, title, strict=False):
    """Kies het beste fragment uit iTunes-resultaten, of None als niets goed genoeg is."""
    want = normalize(title)
    exact, loose = [], []
    for result in results:
        url = result.get("previewUrl")
        name = result.get("trackName", "")
        if not url or not artist_matches(artist, result.get("artistName", ""), strict):
            continue
        if normalize(name) == want:
            exact.append(url)
        elif normalize(base_title(name)) == want and suffix_allowed(name, artist):
            loose.append(url)
    return (exact + loose or [None])[0]


def cached_get(url, params, cache_name, pause=0.0):
    """GET met een bestandscache, zodat opnieuw draaien snel gaat."""
    path = CACHE_DIR / cache_name
    if path.exists():
        return path.read_text(encoding="utf-8")
    for _ in range(3):
        time.sleep(pause)
        response = requests.get(url, params=params, headers=HEADERS, timeout=30)
        if response.status_code not in (403, 429):
            break
        print("  te veel aanvragen, even een minuut wachten...", flush=True)
        time.sleep(60)
    response.raise_for_status()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(response.text, encoding="utf-8")
    return response.text


def search_itunes(term):
    key = hashlib.md5(term.encode("utf-8")).hexdigest()
    params = {"term": term, "entity": "song", "limit": 10, "country": "NL"}
    # iTunes staat ongeveer 20 aanvragen per minuut toe, dus 3 s pauze.
    text = cached_get("https://itunes.apple.com/search", params, f"itunes-{key}.json", pause=3)
    return json.loads(text)["results"]


def find_preview(artist, title, search=search_itunes):
    """Zoek eerst op artiest + titel, daarna alleen op titel (dan moet de artiest strenger kloppen)."""
    for term, strict in ((f"{artist} {title}", False), (title, True)):
        url = pick_preview(search(term), artist, title, strict)
        if url:
            return url
    return None


def youtube_link(song):
    query = f"Eurovision {song['year']} {song['country']} {song['artist']} {song['title']}"
    return "https://www.youtube.com/results?search_query=" + quote_plus(query)


def apply_overrides(songs, rows):
    """Elke rij zet één veld van één nummer; een lege waarde wordt None."""
    by_id = {song["id"]: song for song in songs}
    for row in rows:
        if row["id"] not in by_id:
            raise ValueError(f"Override voor onbekend id: {row['id']}")
        by_id[row["id"]][row["veld"]] = row["waarde"] or None
    return songs


def read_overrides():
    if not OVERRIDES.exists():
        return []
    with OVERRIDES.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def build():
    sys.stdout.reconfigure(encoding="utf-8")
    songs = []
    for year in YEARS:
        html = cached_get(
            "https://en.wikipedia.org/w/index.php",
            {"title": f"Eurovision_Song_Contest_{year}", "action": "render"},
            f"wiki-{year}.html",
        )
        songs.extend(parse_participants(html, year))
    ids = [song["id"] for song in songs]
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        raise ValueError(f"Dubbele id's: {sorted(duplicates)}")

    for n, song in enumerate(songs, 1):
        song["preview"] = find_preview(song["artist"], song["title"])
        song["youtube"] = youtube_link(song)
        print(f"{n}/{len(songs)} {song['id']}: {'ok' if song['preview'] else 'GEEN FRAGMENT'}", flush=True)

    apply_overrides(songs, read_overrides())
    OUTPUT.write_text(json.dumps(songs, ensure_ascii=False, indent=1), encoding="utf-8")

    missing = [s for s in songs if not s["preview"]]
    print(f"\n{len(songs)} nummers geschreven naar {OUTPUT}")
    print(f"{len(missing)} zonder fragment:")
    for song in missing:
        print(f"  {song['id']}  {song['artist']} - {song['title']}")


if __name__ == "__main__":
    build()
