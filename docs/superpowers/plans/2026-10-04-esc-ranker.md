# ESC Ranker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een PWA voor Android waarmee je één persoonlijke ranglijst maakt van alle ~309 Eurovisie-inzendingen (2018, 2019, 2021–2026), met audiofragmenten en vier hulpmethodes (schifting, duel, groepje van 8, invoegen).

**Architecture:** Een Python-script haalt de deelnemers van Wikipedia en de fragment-links van iTunes, en schrijft `app/songs.json`. De app is gewone HTML/CSS/JS (ES-modules, geen framework). Alle keuzes gaan als records in een log in `localStorage`. Na elke actie berekent `ranking.js` de scores opnieuw met Bradley-Terry. De pure logica (`ranking.js`, `store.js`, `build_songs.py`) is getest; de schermen worden met de hand in de browser getest.

**Tech Stack:** Python 3.10 (requests, pandas, lxml, pytest, pillow), Node 24 (alleen `node --test`), vanilla JavaScript, GitHub Pages + GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-04-esc-ranker-design.md`

## Global Constraints

- Werkmap voor alle commando's: `C:\Documenten\ESC\ranker` (in Bash: `/c/Documenten/ESC/ranker`).
- Jaren: `[2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026]`; 2020 doet niet mee.
- Song-id: `"<jaar>-<ISO-landcode>"`, bijvoorbeeld `"2023-SE"`.
- `localStorage`-sleutel: `esc-ranker-v1`, met inhoud `{version:1, log:[…], lastExport}`.
- Ankers: top +150, oké 0, meh −150 (Elo-schaal). Getoonde score = `1500 + 400·log10(sterkte)`.
- Constanten: `ZEKER_SE=100`, `HALF_SE=150`, `R_START=0.30`, `R_END=0.15`, `R_END_AT=0.8`, `R_RANGE=40`, `R_WIDE_UNTIL=0.5`, `NEAR=10`, `SAME_YEAR=0.25`, `RECENT=20`, `GROUP_SIZE=8`, `GROUP_SPREAD_EARLY=4`, `GROUP_SPREAD_LATE=2`, `GROUP_LATE_FROM=0.5`, `GROUP_WT=0.5`, `MOVE_WT=3`.
- Teksten in de app zijn Nederlands. Code-commentaar is Nederlands, kort.
- Geen frameworks en geen npm-pakketten. Externe Python-pakketten alleen die uit `requirements.txt`.
- Python schrijft en leest bestanden altijd met `encoding="utf-8"` (Windows-console is cp1252).
- Python draait via de venv: `.venv/Scripts/python` (Bash) of `.venv\Scripts\python` (PowerShell).
- Elke commit eindigt met de regel `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Te weinig ingedeelde nummers** (0, 1 of 7) bij Duel of Groepje: de app toont een nette melding in plaats van te crashen. Tests: `pickDuel`/`pickGroup` geven `null` (Task 5).
2. **De allereerste invoeging bij een lege lijst**: het nummer wordt ingedeeld als "oké" in plaats van verloren te gaan. Test: `finishInsert` zonder antwoorden (Task 4).
3. **`songs.json` verandert** (een id verdwijnt) terwijl het log de oude id nog bevat: die records worden genegeerd, de app crasht niet. Test: `filterKnown` (Task 3).
4. **Kapotte opslag of een verkeerd importbestand**: nooit stil overschrijven, wel een duidelijke foutmelding. Tests in Task 6.
5. **iTunes geeft een cover, remix of akoestische versie, of een andere artiest**: dan liever geen fragment. Tests in Task 2.

---

### Task 1: Python-project en Wikipedia-parser

**Files:**
- Create: `requirements.txt`
- Create: `data/build_songs.py`
- Create: `tests/test_build_songs.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `COUNTRY_CODES: dict[str, str]`, `strip_footnotes(text) -> str`, `clean_title(raw) -> str`, `parse_participants(html: str, year: int) -> list[dict]`. Elk dict heeft precies de sleutels `id, year, country, cc, artist, title`.

- [ ] **Step 1: Maak de Python-omgeving**

`requirements.txt`:
```
requests>=2.31
pandas>=2.0
lxml>=5.0
pytest>=8.0
pillow>=10.1
```

Voeg aan `.gitignore` toe (de bestaande regels blijven staan):
```
node_modules/
```

Run (Bash):
```bash
cd /c/Documenten/ESC/ranker && python -m venv .venv && .venv/Scripts/python -m pip install -q -r requirements.txt && .venv/Scripts/python -m pytest --version
```
Expected: `pytest 8.x.x`

- [ ] **Step 2: Schrijf de falende tests**

`tests/test_build_songs.py`:
```python
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
```

- [ ] **Step 3: Draai de tests en zie ze falen**

Run: `.venv/Scripts/python -m pytest tests/test_build_songs.py -v`
Expected: FAIL met `ModuleNotFoundError` of `ImportError` (build_songs bestaat nog niet).

- [ ] **Step 4: Schrijf de parser**

`data/build_songs.py`:
```python
"""Maakt app/songs.json: alle Eurovisie-inzendingen met een link naar een fragment.

Gebruik (vanuit de map ranker/):
    .venv/Scripts/python data/build_songs.py
"""
import io
import re

import pandas as pd

YEARS = [2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026]

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
```

- [ ] **Step 5: Draai de tests**

Run: `.venv/Scripts/python -m pytest tests/test_build_songs.py -v`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add requirements.txt .gitignore data/build_songs.py tests/test_build_songs.py
git commit -m "Wikipedia-parser voor Eurovisie-deelnemers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: iTunes-fragmenten, overrides en songs.json maken

**Files:**
- Modify: `data/build_songs.py`
- Create: `data/overrides.csv`
- Create: `app/songs.json` (gegenereerd)
- Test: `tests/test_build_songs.py`

**Interfaces:**
- Consumes: `parse_participants`, `YEARS` uit Task 1.
- Produces: `normalize(text) -> str`, `pick_preview(results: list[dict], artist, title) -> str | None`, `find_preview(artist, title, search=search_itunes) -> str | None`, `youtube_link(song: dict) -> str`, `apply_overrides(songs, rows) -> list[dict]`, `build()`. Het eindproduct `app/songs.json` is een lijst dicts met de sleutels `id, year, country, cc, artist, title, preview, youtube`.

- [ ] **Step 1: Schrijf de falende tests** (voeg toe onderaan `tests/test_build_songs.py`)

```python
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
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `.venv/Scripts/python -m pytest tests/test_build_songs.py -v`
Expected: de nieuwe tests FAIL met `AttributeError: module 'data.build_songs' has no attribute 'normalize'`.

- [ ] **Step 3: Schrijf de implementatie**

Vervang in `data/build_songs.py` het importblok door:
```python
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
```

Voeg direct onder `YEARS = [...]` toe:
```python
ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "cache"
OVERRIDES = ROOT / "data" / "overrides.csv"
OUTPUT = ROOT / "app" / "songs.json"
HEADERS = {"User-Agent": "esc-ranker/0.1 (persoonlijk project)"}
# Woorden in een tracknaam die wijzen op een andere versie dan het origineel.
BAD_WORDS = {"acoustic", "remix", "instrumental", "karaoke", "live", "unplugged", "cover", "orchestral", "piano"}
```

Voeg onderaan het bestand toe:
```python
def normalize(text):
    """Kleine letters, zonder accenten en leestekens: 'Käärijä!' -> 'kaarija'."""
    text = unicodedata.normalize("NFKD", str(text).lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def base_title(name):
    """'Tattoo (Acoustic)' -> 'Tattoo'."""
    return re.split(r"\s[\(\[\-]", name)[0]


def artist_matches(wiki_artist, itunes_artist):
    """Minstens één woord van de artiestnaam komt overeen (woorden van 3+ tekens als die er zijn)."""
    words = normalize(wiki_artist).split()
    wanted = {w for w in words if len(w) >= 3} or set(words)
    return bool(wanted & set(normalize(itunes_artist).split()))


def pick_preview(results, artist, title):
    """Kies het beste fragment uit iTunes-resultaten, of None als niets goed genoeg is."""
    want = normalize(title)
    exact, loose = [], []
    for result in results:
        url = result.get("previewUrl")
        name = result.get("trackName", "")
        if not url or not artist_matches(artist, result.get("artistName", "")):
            continue
        if normalize(name) == want:
            exact.append(url)
        elif normalize(base_title(name)) == want and not BAD_WORDS & set(normalize(name).split()):
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
    """Zoek eerst op artiest + titel, daarna alleen op titel."""
    for term in (f"{artist} {title}", title):
        url = pick_preview(search(term), artist, title)
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
```

`data/overrides.csv` (alleen de kopregel):
```
id,veld,waarde
```

- [ ] **Step 4: Draai de tests**

Run: `.venv/Scripts/python -m pytest tests/test_build_songs.py -v`
Expected: 16 passed

- [ ] **Step 5: Maak songs.json echt aan**

Dit duurt 15–30 minuten door de pauzes voor iTunes. Draai het op de achtergrond (`run_in_background`) en ga ondertussen verder met Task 3 t/m 6:
```bash
cd /c/Documenten/ESC/ranker && mkdir -p app && .venv/Scripts/python data/build_songs.py
```
Expected aan het eind: `309 nummers geschreven naar ...app\songs.json`, gevolgd door de lijst zonder fragment.

Controleer daarna:
```bash
.venv/Scripts/python -c "import json; s=json.load(open('app/songs.json',encoding='utf-8')); print(len(s), sum(1 for x in s if x['preview']), s[0])"
```
Expected: `309 <aantal met fragment> {...}`. Meld het aantal zonder fragment aan de gebruiker. Ontbrekende fragmenten zijn geen fout (dan wordt YouTube de hoofdknop). De gebruiker kan ze later via `overrides.csv` aanvullen.

- [ ] **Step 6: Commit**

```bash
git add data/build_songs.py data/overrides.csv tests/test_build_songs.py app/songs.json
git commit -m "Fragmenten via iTunes, overrides en songs.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Bradley-Terry-model (`ranking.js` deel 1)

**Files:**
- Create: `package.json`
- Create: `app/ranking.js`
- Create: `tests/ranking.test.js`

**Interfaces:**
- Produces (exports uit `app/ranking.js`):
  - `CONFIG` (object met de constanten uit Global Constraints)
  - `TIERS = {top:150, oke:0, meh:-150}`
  - `fit(log) -> Map<id, {score, se, n}>`: alleen ingedeelde nummers
  - `rankList(fitted) -> Array<{id, score, se, n, rank, lo, hi}>`, gesorteerd van best naar slechtst; `rank`, `lo` en `hi` beginnen bij 1
  - `certainty(ranked, total = ranked.length) -> number` (0..1)
  - `dot(se) -> 'vol' | 'half' | 'leeg'`
  - `filterKnown(log, known) -> log`, waarbij `known` een object met `.has(id)` is (Set of Map)
- Log-records: `{a, type:'tier', id, tier}` en `{a, type:'cmp', w, l, wt}`.

- [ ] **Step 1: Schrijf de falende tests**

`package.json`:
```json
{
  "name": "esc-ranker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
```

`tests/ranking.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../app/ranking.js';

const cmp = (w, l, a = 1, wt = 1) => ({ a, type: 'cmp', w, l, wt });
const tier = (id, t, a = 1) => ({ a, type: 'tier', id, tier: t });
const near = (x, y, eps = 0.01) => assert.ok(Math.abs(x - y) < eps, `${x} ≉ ${y}`);

test('fit: leeg log geeft lege uitkomst', () => {
  assert.equal(R.fit([]).size, 0);
});

test('fit: alleen schifting geeft precies de ankerscore', () => {
  const f = R.fit([tier('A', 'top', 1), tier('B', 'meh', 2), tier('C', 'oke', 3)]);
  near(f.get('A').score, 1650);
  near(f.get('B').score, 1350);
  near(f.get('C').score, 1500);
});

test('fit: één duel tussen twee oké-nummers (vooraf uitgerekend)', () => {
  const f = R.fit([cmp('A', 'B')]);
  near(f.get('A').score, 1591.73, 0.05);
  near(f.get('B').score, 1408.27, 0.05);
});

test('fit: volgorde van het log maakt niet uit', () => {
  const log = [tier('A', 'top', 1), cmp('A', 'B', 2), cmp('B', 'C', 3), cmp('C', 'A', 4), cmp('A', 'C', 5), cmp('D', 'B', 6, 0.5)];
  const f1 = R.fit(log);
  const f2 = R.fit([...log].reverse());
  for (const id of 'ABCD') near(f1.get(id).score, f2.get(id).score);
});

test('fit: meer vergelijkingen geven kleinere onzekerheid', () => {
  const one = R.fit([cmp('A', 'B')]).get('A').se;
  const many = R.fit([1, 2, 3, 4, 5, 6].flatMap((a) => [cmp('A', 'B', a), cmp('B', 'A', a)])).get('A').se;
  assert.ok(many < one, `${many} < ${one}`);
});

test('fit: n telt gewogen vergelijkingen, geen schifting', () => {
  const f = R.fit([tier('A', 'top', 1), cmp('A', 'B', 2), cmp('A', 'C', 3, 0.5)]);
  assert.equal(f.get('A').n, 1.5);
});

test('rankList: sorteert op score en geeft rangbereik', () => {
  const list = R.rankList(R.fit([tier('A', 'top', 1), tier('B', 'meh', 2), tier('C', 'oke', 3)]));
  assert.deepEqual(list.map((s) => s.id), ['A', 'C', 'B']);
  assert.deepEqual(list.map((s) => s.rank), [1, 2, 3]);
  // Alleen de prior: SE ≈ 246 punten, dus de bereiken overlappen.
  assert.equal(list[0].lo, 1);
  assert.equal(list[0].hi, 2);
  assert.equal(list[1].lo, 1);
  assert.equal(list[1].hi, 3);
});

test('certainty en dot', () => {
  const ranked = [{ se: 50 }, { se: 120 }, { se: 200 }];
  near(R.certainty(ranked, 6), 1 / 6);
  near(R.certainty(ranked), 1 / 3);
  assert.equal(R.certainty([], 0), 0);
  assert.deepEqual(ranked.map((s) => R.dot(s.se)), ['vol', 'half', 'leeg']);
});

test('filterKnown: laat records met onbekende nummers weg', () => {
  const known = new Set(['A', 'B']);
  const log = [cmp('A', 'B'), cmp('A', 'X'), tier('X', 'top'), tier('B', 'meh')];
  assert.deepEqual(R.filterKnown(log, known), [cmp('A', 'B'), tier('B', 'meh')]);
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test "tests/*.test.js"`
Expected: FAIL met `Cannot find module ... app/ranking.js`.

- [ ] **Step 3: Schrijf de implementatie**

`app/ranking.js`:
```js
// ranking.js — rekenmodel (Bradley-Terry op het keuzelog) en paarselectie.
// Geen DOM-code hier, zodat alles met `node --test` te testen is.

export const CONFIG = {
  ZEKER_SE: 100,          // Elo-punten; daaronder telt een nummer als "zeker"
  HALF_SE: 150,           // daaronder: halve stip
  R_START: 0.30,          // kans op willekeurige tegenstander bij 0% zekerheid
  R_END: 0.15,            // ... bij R_END_AT zekerheid of meer
  R_END_AT: 0.8,
  R_RANGE: 40,            // willekeurig binnen ±40 plaatsen ...
  R_WIDE_UNTIL: 0.5,      // ... maar uit de hele lijst zolang zekerheid < 50%
  NEAR: 10,               // aantal "buren" in score
  SAME_YEAR: 0.25,        // kans dat een buur uit hetzelfde jaar komt
  RECENT: 20,             // geen paar dat in de laatste 20 vergelijkingen zat
  GROUP_SIZE: 8,
  GROUP_SPREAD_EARLY: 4,  // verspreide nummers in een groepje bij zekerheid < GROUP_LATE_FROM
  GROUP_SPREAD_LATE: 2,
  GROUP_LATE_FROM: 0.5,
  GROUP_WT: 0.5,          // gewicht van elk paar uit een groepje
  MOVE_WT: 3,             // gewicht van handmatig verplaatsen
};

export const TIERS = { top: 150, oke: 0, meh: -150 };

const ELO = 400 / Math.log(10);              // omrekening natuurlijke log -> Elo-punten
const toStrength = (elo) => Math.pow(10, elo / 400);

// Schat per ingedeeld nummer een score met Bradley-Terry (MM-algoritme, Hunter 2004).
// Elk nummer speelt 2 virtuele gelijke spellen tegen het anker van zijn tier (prior).
export function fit(log) {
  const tier = new Map();
  const games = new Map();  // id -> Map(tegenstander -> totaal gewicht)
  const wins = new Map();   // id -> gewogen aantal winsten
  const opp = (id) => {
    if (!games.has(id)) games.set(id, new Map());
    return games.get(id);
  };
  const add = (map, key, v) => map.set(key, (map.get(key) || 0) + v);

  for (const r of log) {
    if (r.type === 'tier') {
      tier.set(r.id, r.tier);
      opp(r.id);
    } else if (r.type === 'cmp') {
      add(opp(r.w), r.l, r.wt);
      add(opp(r.l), r.w, r.wt);
      add(wins, r.w, r.wt);
    }
  }

  const ids = [...games.keys()];
  const anchor = new Map(ids.map((id) => [id, toStrength(TIERS[tier.get(id) || 'oke'])]));
  const s = new Map(ids.map((id) => [id, 1]));

  for (let round = 0; round < 500; round++) {
    let maxChange = 0;
    for (const id of ids) {
      const g = s.get(id);
      let denom = 2 / (g + anchor.get(id));
      for (const [o, w] of games.get(id)) denom += w / (g + s.get(o));
      const next = ((wins.get(id) || 0) + 1) / denom;  // +1 = twee halve winsten uit de prior
      maxChange = Math.max(maxChange, Math.abs(Math.log(next / g)));
      s.set(id, next);
    }
    if (maxChange < 1e-7) break;
  }

  const result = new Map();
  for (const id of ids) {
    const g = s.get(id);
    const a = anchor.get(id);
    let info = (2 * g * a) / (g + a) ** 2;
    let n = 0;
    for (const [o, w] of games.get(id)) {
      const go = s.get(o);
      info += (w * g * go) / (g + go) ** 2;
      n += w;
    }
    result.set(id, { score: 1500 + 400 * Math.log10(g), se: ELO / Math.sqrt(info), n });
  }
  return result;
}

// Lijst van best naar slechtst, met rang en een rangbereik (score ± 1 SE).
export function rankList(fitted) {
  const list = [...fitted]
    .map(([id, f]) => ({ id, ...f }))
    .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
  const scores = list.map((s) => s.score);
  list.forEach((s, i) => {
    s.rank = i + 1;
    s.lo = scores.filter((x) => x > s.score + s.se).length + 1;
    s.hi = scores.filter((x) => x >= s.score - s.se).length;
  });
  return list;
}

export function certainty(ranked, total = ranked.length) {
  if (!total) return 0;
  return ranked.filter((s) => s.se < CONFIG.ZEKER_SE).length / total;
}

export function dot(se) {
  if (se < CONFIG.ZEKER_SE) return 'vol';
  if (se < CONFIG.HALF_SE) return 'half';
  return 'leeg';
}

// Records over nummers die niet (meer) in songs.json staan, tellen niet mee.
export function filterKnown(log, known) {
  return log.filter((r) => (r.type === 'tier' ? known.has(r.id) : known.has(r.w) && known.has(r.l)));
}
```

- [ ] **Step 4: Draai de tests**

Run: `node --test "tests/*.test.js"`
Expected: 9 tests, all pass

- [ ] **Step 5: Commit**

```bash
git add package.json app/ranking.js tests/ranking.test.js
git commit -m "Bradley-Terry-model op het keuzelog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Log-hulpfuncties en invoegen (`ranking.js` deel 2)

**Files:**
- Modify: `app/ranking.js` (toevoegen onderaan)
- Test: `tests/ranking.test.js`

**Interfaces:**
- Consumes: `CONFIG` uit Task 3.
- Produces:
  - `nextAction(log) -> int`
  - `undo(log) -> log` (zonder de records van de laatste actie)
  - `tierRecord(id, tier, a) -> [record]`
  - `duelRecords(winner, loser, a) -> [record]`
  - `groupRecords(order: id[], a) -> record[]` (28 bij 8 nummers)
  - `moveRecords(id, upperId | null, lowerId | null, a) -> record[]`
  - `insertStart(ranked) -> {lo, hi}`
  - `insertProbe(state) -> index | null`
  - `insertAnswer(state, better: boolean) -> state`
  - `finishInsert(id, answers: {otherId, better}[], a) -> record[]`
  - `pairKey(x, y) -> string`
  - `recentPairs(log, n = CONFIG.RECENT) -> Set<string>`

- [ ] **Step 1: Schrijf de falende tests** (voeg toe aan `tests/ranking.test.js`)

```js
test('nextAction en undo werken per actie', () => {
  assert.equal(R.nextAction([]), 1);
  const log = [tier('A', 'top', 1), cmp('A', 'B', 2, 0.5), cmp('A', 'C', 2, 0.5)];
  assert.equal(R.nextAction(log), 3);
  assert.deepEqual(R.undo(log), [tier('A', 'top', 1)]);
  assert.deepEqual(R.undo([]), []);
});

test('tierRecord en duelRecords', () => {
  assert.deepEqual(R.tierRecord('A', 'meh', 4), [tier('A', 'meh', 4)]);
  assert.deepEqual(R.duelRecords('A', 'B', 5), [cmp('A', 'B', 5)]);
});

test('groupRecords: alle paren volgens de volgorde, met half gewicht', () => {
  const order = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const recs = R.groupRecords(order, 7);
  assert.equal(recs.length, 28);
  assert.ok(recs.every((r) => r.a === 7 && r.wt === 0.5 && order.indexOf(r.w) < order.indexOf(r.l)));
});

test('moveRecords: zwaar gewicht tegen de nieuwe buren', () => {
  assert.deepEqual(R.moveRecords('X', 'U', 'L', 3), [cmp('X', 'L', 3, 3), cmp('U', 'X', 3, 3)]);
  assert.deepEqual(R.moveRecords('X', null, 'L', 3), [cmp('X', 'L', 3, 3)]);
  assert.deepEqual(R.moveRecords('X', 'U', null, 3), [cmp('U', 'X', 3, 3)]);
});

test('invoegen: binair zoeken vindt elke plek in hooguit 4 vragen bij 10 nummers', () => {
  const ranked = Array.from({ length: 10 }, (_, i) => ({ id: `S${i}` }));
  for (let target = 0; target <= 10; target++) {
    let state = R.insertStart(ranked);
    let questions = 0;
    for (let m = R.insertProbe(state); m !== null; m = R.insertProbe(state)) {
      state = R.insertAnswer(state, m >= target);  // beter dan alles vanaf plek `target`
      questions++;
    }
    assert.equal(state.lo, target);
    assert.ok(questions <= 4);
  }
});

test('finishInsert: antwoorden worden vergelijkingen', () => {
  const recs = R.finishInsert('N', [{ otherId: 'A', better: false }, { otherId: 'B', better: true }], 9);
  assert.deepEqual(recs, [cmp('A', 'N', 9), cmp('N', 'B', 9)]);
});

test('finishInsert: lege lijst geeft schifting oké, zodat het nummer ingedeeld is', () => {
  assert.equal(R.insertProbe(R.insertStart([])), null);
  assert.deepEqual(R.finishInsert('N', [], 1), [tier('N', 'oke', 1)]);
});

test('recentPairs: laatste vergelijkingen, richting maakt niet uit', () => {
  const log = [cmp('A', 'B', 1), tier('C', 'top', 2), cmp('D', 'C', 3)];
  const recent = R.recentPairs(log, 20);
  assert.ok(recent.has(R.pairKey('B', 'A')));
  assert.ok(recent.has(R.pairKey('C', 'D')));
  assert.equal(recent.size, 2);
  assert.equal(R.recentPairs(log, 1).size, 1);
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test "tests/*.test.js"`
Expected: de nieuwe tests FAIL met `R.nextAction is not a function` en vergelijkbaar.

- [ ] **Step 3: Schrijf de implementatie** (onderaan `app/ranking.js`)

```js
// ---------- het log ----------

export function nextAction(log) {
  return log.reduce((max, r) => Math.max(max, r.a), 0) + 1;
}

// Haal alle records van de laatste actie weg (een groepje gaat dus in één keer terug).
export function undo(log) {
  if (!log.length) return log;
  const last = log[log.length - 1].a;
  return log.filter((r) => r.a !== last);
}

const cmpRecord = (w, l, a, wt = 1) => ({ a, type: 'cmp', w, l, wt });

export function tierRecord(id, tier, a) {
  return [{ a, type: 'tier', id, tier }];
}

export function duelRecords(winner, loser, a) {
  return [cmpRecord(winner, loser, a)];
}

export function groupRecords(order, a) {
  const recs = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) recs.push(cmpRecord(order[i], order[j], a, CONFIG.GROUP_WT));
  }
  return recs;
}

// Handmatig verplaatst: wint van de nieuwe onderbuur, verliest van de nieuwe bovenbuur.
export function moveRecords(id, upperId, lowerId, a) {
  const recs = [];
  if (lowerId) recs.push(cmpRecord(id, lowerId, a, CONFIG.MOVE_WT));
  if (upperId) recs.push(cmpRecord(upperId, id, a, CONFIG.MOVE_WT));
  return recs;
}

// ---------- invoegen (binair zoeken) ----------
// De plek van het nieuwe nummer ligt tussen lo en hi (indexen in `ranked`, 0 = bovenaan).

export function insertStart(ranked) {
  return { lo: 0, hi: ranked.length };
}

export function insertProbe(state) {
  return state.lo < state.hi ? Math.floor((state.lo + state.hi) / 2) : null;
}

export function insertAnswer(state, better) {
  const mid = insertProbe(state);
  return better ? { lo: state.lo, hi: mid } : { lo: mid + 1, hi: state.hi };
}

export function finishInsert(id, answers, a) {
  if (!answers.length) return tierRecord(id, 'oke', a);
  return answers.map((x) => (x.better ? cmpRecord(id, x.otherId, a) : cmpRecord(x.otherId, id, a)));
}

// ---------- recente paren ----------

export const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);

export function recentPairs(log, n = CONFIG.RECENT) {
  const keys = new Set();
  for (let i = log.length - 1; i >= 0 && keys.size < n; i--) {
    const r = log[i];
    if (r.type === 'cmp') keys.add(pairKey(r.w, r.l));
  }
  return keys;
}
```

- [ ] **Step 4: Draai de tests**

Run: `node --test "tests/*.test.js"`
Expected: 17 tests, all pass

- [ ] **Step 5: Commit**

```bash
git add app/ranking.js tests/ranking.test.js
git commit -m "Log-hulpfuncties, ongedaan maken en invoegen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Paarselectie en groepjes (`ranking.js` deel 3)

**Files:**
- Modify: `app/ranking.js` (toevoegen onderaan)
- Test: `tests/ranking.test.js`

**Interfaces:**
- Consumes: `CONFIG`, `pairKey` uit Task 3 en 4.
- Produces:
  - `makeRng(seed = Date.now()) -> () => number` (0..1)
  - `shuffle(arr, rng) -> nieuwe array`
  - `randomShare(cert) -> number`
  - `pickDuel(ranked, recent: Set, cert, rng) -> [idLinks, idRechts] | null`
  - `pickGroup(ranked, cert, rng) -> id[8] | null`
- Het jaar van een nummer haalt de code uit de eerste 4 tekens van de id.

- [ ] **Step 1: Schrijf de falende tests** (voeg toe aan `tests/ranking.test.js`)

```js
// 100 nummers met gelijke onzekerheid, score aflopend; allemaal uit 2018.
const fakeRanked = (n = 100, year = () => 2018) =>
  Array.from({ length: n }, (_, i) => ({ id: `${year(i)}-${String(i).padStart(3, '0')}`, score: 2000 - i * 10, se: 200, rank: i + 1 }));
const rankOf = (ranked) => new Map(ranked.map((s, i) => [s.id, i]));

test('makeRng is herhaalbaar en shuffle houdt alle elementen', () => {
  const a = R.makeRng(42), b = R.makeRng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.deepEqual(R.shuffle([1, 2, 3, 4, 5], R.makeRng(1)).sort(), [1, 2, 3, 4, 5]);
});

test('randomShare loopt van 0.30 naar 0.15', () => {
  near(R.randomShare(0), 0.30, 1e-9);
  near(R.randomShare(0.4), 0.225, 1e-9);
  near(R.randomShare(0.8), 0.15, 1e-9);
  near(R.randomShare(1), 0.15, 1e-9);
});

test('pickDuel: null bij minder dan 2 nummers', () => {
  assert.equal(R.pickDuel([], new Set(), 0, R.makeRng(1)), null);
  assert.equal(R.pickDuel(fakeRanked(1), new Set(), 0, R.makeRng(1)), null);
});

test('pickDuel: twee verschillende bestaande nummers', () => {
  const ranked = fakeRanked();
  const rng = R.makeRng(7);
  for (let i = 0; i < 200; i++) {
    const [x, y] = R.pickDuel(ranked, new Set(), 0, rng);
    assert.notEqual(x, y);
    assert.ok(ranked.some((s) => s.id === x) && ranked.some((s) => s.id === y));
  }
});

test('pickDuel: bij 0% zekerheid ongeveer 30% verre tegenstanders', () => {
  const ranked = fakeRanked();
  const pos = rankOf(ranked);
  const rng = R.makeRng(3);
  let far = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const [x, y] = R.pickDuel(ranked, new Set(), 0, rng);
    if (Math.abs(pos.get(x) - pos.get(y)) > 10) far++;
  }
  assert.ok(far / N > 0.18 && far / N < 0.33, `aandeel ver: ${far / N}`);
});

test('pickDuel: bij hoge zekerheid nooit verder dan 40 plaatsen en minder vaak ver', () => {
  const ranked = fakeRanked();
  const pos = rankOf(ranked);
  const rng = R.makeRng(5);
  let far = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const [x, y] = R.pickDuel(ranked, new Set(), 1, rng);
    const d = Math.abs(pos.get(x) - pos.get(y));
    assert.ok(d <= 40, `afstand ${d}`);
    if (d > 10) far++;
  }
  assert.ok(far / N < 0.2, `aandeel ver: ${far / N}`);
});

test('pickDuel: vermijdt recente paren als er alternatieven zijn', () => {
  const ranked = fakeRanked(30);
  const ids = ranked.map((s) => s.id);
  const recent = new Set([R.pairKey(ids[0], ids[1]), R.pairKey(ids[0], ids[2]), R.pairKey(ids[1], ids[2])]);
  const rng = R.makeRng(11);
  for (let i = 0; i < 500; i++) {
    const [x, y] = R.pickDuel(ranked, recent, 0, rng);
    assert.ok(!recent.has(R.pairKey(x, y)));
  }
});

test('pickDuel: valt terug op een recent paar als het niet anders kan', () => {
  const ranked = fakeRanked(2);
  const recent = new Set([R.pairKey(ranked[0].id, ranked[1].id)]);
  assert.equal(R.pickDuel(ranked, recent, 0, R.makeRng(1)).length, 2);
});

const longestRun = (positions) => {
  const sorted = [...positions].sort((x, y) => x - y);
  let best = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
};

test('pickGroup: null bij minder dan 8 nummers', () => {
  assert.equal(R.pickGroup(fakeRanked(7), 0, R.makeRng(1)), null);
});

test('pickGroup: vroeg 4 dichtbij + 4 verspreid over de hele lijst', () => {
  const ranked = fakeRanked();
  const pos = rankOf(ranked);
  const rng = R.makeRng(2);
  for (let i = 0; i < 100; i++) {
    const ids = R.pickGroup(ranked, 0, rng);
    assert.equal(new Set(ids).size, 8);
    const p = ids.map((id) => pos.get(id));
    assert.ok(longestRun(p) >= 4);
    assert.ok(Math.max(...p) - Math.min(...p) > 50);
  }
});

test('pickGroup: later 6 dichtbij', () => {
  const ranked = fakeRanked();
  const pos = rankOf(ranked);
  const rng = R.makeRng(4);
  for (let i = 0; i < 100; i++) {
    const ids = R.pickGroup(ranked, 0.9, rng);
    assert.equal(new Set(ids).size, 8);
    assert.ok(longestRun(ids.map((id) => pos.get(id))) >= 6);
  }
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test "tests/*.test.js"`
Expected: de nieuwe tests FAIL met `R.makeRng is not a function` en vergelijkbaar.

- [ ] **Step 3: Schrijf de implementatie** (onderaan `app/ranking.js`)

```js
// ---------- toeval ----------

// Kleine voorspelbare random-generator (mulberry32), zodat tests herhaalbaar zijn.
export function makeRng(seed = Date.now()) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const yearOf = (id) => id.slice(0, 4);

// Een van de 10 nummers waar het model het minst zeker over is.
function uncertainPick(ranked, rng) {
  return pick([...ranked].sort((x, y) => y.se - x.se).slice(0, CONFIG.NEAR), rng);
}

// Kans op een willekeurige tegenstander: van R_START naar R_END naarmate de lijst zekerder wordt.
export function randomShare(cert) {
  const t = Math.min(cert / CONFIG.R_END_AT, 1);
  return CONFIG.R_START + (CONFIG.R_END - CONFIG.R_START) * t;
}

// ---------- duel ----------

export function pickDuel(ranked, recent, cert, rng) {
  if (ranked.length < 2) return null;
  const first = uncertainPick(ranked, rng);
  const i = ranked.indexOf(first);

  let pool;
  if (rng() < randomShare(cert)) {
    pool = cert < CONFIG.R_WIDE_UNTIL
      ? ranked
      : ranked.slice(Math.max(0, i - CONFIG.R_RANGE), i + CONFIG.R_RANGE + 1);
  } else {
    let candidates = ranked;
    if (rng() < CONFIG.SAME_YEAR) {
      const same = ranked.filter((s) => yearOf(s.id) === yearOf(first.id));
      if (same.length > 1) candidates = same;
    }
    // NEAR + 1, omdat `first` zelf ook in deze lijst staat.
    pool = [...candidates]
      .sort((x, y) => Math.abs(x.score - first.score) - Math.abs(y.score - first.score))
      .slice(0, CONFIG.NEAR + 1);
  }

  let options = pool.filter((s) => s.id !== first.id && !recent.has(pairKey(first.id, s.id)));
  if (!options.length) options = ranked.filter((s) => s.id !== first.id);
  const second = pick(options, rng);
  return rng() < 0.5 ? [first.id, second.id] : [second.id, first.id];
}

// ---------- groepje ----------

export function pickGroup(ranked, cert, rng) {
  const size = CONFIG.GROUP_SIZE;
  if (ranked.length < size) return null;
  const spread = cert < CONFIG.GROUP_LATE_FROM ? CONFIG.GROUP_SPREAD_EARLY : CONFIG.GROUP_SPREAD_LATE;
  const nearCount = size - spread;

  const center = ranked.indexOf(uncertainPick(ranked, rng));
  const start = Math.min(Math.max(0, center - Math.floor(nearCount / 2)), ranked.length - nearCount);
  const near = ranked.slice(start, start + nearCount);

  // Eén willekeurig nummer uit elk gelijk stuk van de rest van de lijst.
  const rest = ranked.filter((s) => !near.includes(s));
  const chunk = rest.length / spread;
  const far = [];
  for (let k = 0; k < spread; k++) far.push(rest[Math.floor(k * chunk + rng() * chunk)]);

  return shuffle([...near, ...far].map((s) => s.id), rng);
}
```

- [ ] **Step 4: Draai de tests**

Run: `node --test "tests/*.test.js"`
Expected: 28 tests, all pass

- [ ] **Step 5: Commit**

```bash
git add app/ranking.js tests/ranking.test.js
git commit -m "Paarselectie met tussenweg-willekeur en groepjes van 8

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Opslag, export en import (`store.js`)

**Files:**
- Create: `app/store.js`
- Create: `tests/store.test.js`

**Interfaces:**
- Consumes: `TIERS` uit `ranking.js`.
- Produces:
  - `KEY = 'esc-ranker-v1'`
  - `emptyState() -> {version:1, log:[], lastExport:null}`
  - `load(storage = localStorage) -> state`
  - `save(state, storage = localStorage)`
  - `parseState(text) -> state`: gooit een `Error` met een Nederlandse melding
  - `exportText(state) -> string`
  - `daysSince(iso | null, now = new Date()) -> int | null`

- [ ] **Step 1: Schrijf de falende tests**

`tests/store.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/store.js';

const fakeStorage = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const goodState = () => ({
  version: 1,
  log: [{ a: 1, type: 'tier', id: '2023-SE', tier: 'top' }, { a: 2, type: 'cmp', w: '2023-SE', l: '2023-FI', wt: 1 }],
  lastExport: null,
});

test('load: lege opslag geeft een lege staat', () => {
  assert.deepEqual(S.load(fakeStorage()), S.emptyState());
});

test('save en load geven hetzelfde terug', () => {
  const st = fakeStorage();
  S.save(goodState(), st);
  assert.deepEqual(S.load(st), goodState());
});

test('load: kapotte opslag wordt apart bewaard, niet stil weggegooid', () => {
  const st = fakeStorage();
  st.setItem(S.KEY, '{kapot');
  assert.deepEqual(S.load(st), S.emptyState());
  assert.equal(st.getItem(`${S.KEY}-kapot`), '{kapot');
});

test('parseState: weigert een ander soort bestand', () => {
  assert.throws(() => S.parseState('{"foo":1}'), /Geen geldig/);
  assert.throws(() => S.parseState('geen json'), /Geen geldig/);
});

test('parseState: weigert ongeldige regels', () => {
  const bad = { version: 1, log: [{ a: 1, type: 'cmp', w: 'X', l: 'X', wt: 1 }] };
  assert.throws(() => S.parseState(JSON.stringify(bad)), /Ongeldige regel/);
  const badTier = { version: 1, log: [{ a: 1, type: 'tier', id: 'X', tier: 'super' }] };
  assert.throws(() => S.parseState(JSON.stringify(badTier)), /Ongeldige regel/);
});

test('exportText en parseState zijn elkaars omgekeerde', () => {
  const state = { ...goodState(), lastExport: '2026-10-04T10:00:00.000Z' };
  assert.deepEqual(S.parseState(S.exportText(state)), state);
});

test('daysSince', () => {
  assert.equal(S.daysSince(null), null);
  assert.equal(S.daysSince('2026-10-01T12:00:00Z', new Date('2026-10-04T13:00:00Z')), 3);
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test "tests/*.test.js"`
Expected: FAIL met `Cannot find module ... app/store.js`.

- [ ] **Step 3: Schrijf de implementatie**

`app/store.js`:
```js
// store.js — het keuzelog bewaren in localStorage, plus export en import.
import { TIERS } from './ranking.js';

export const KEY = 'esc-ranker-v1';

export function emptyState() {
  return { version: 1, log: [], lastExport: null };
}

export function load(storage = localStorage) {
  const raw = storage.getItem(KEY);
  if (!raw) return emptyState();
  try {
    return parseState(raw);
  } catch {
    // Niet stil overschrijven: bewaar de kapotte versie zodat er nog iets te redden valt.
    storage.setItem(`${KEY}-kapot`, raw);
    return emptyState();
  }
}

export function save(state, storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(state));
}

const validRecord = (r) =>
  Number.isInteger(r?.a) &&
  ((r.type === 'tier' && typeof r.id === 'string' && Object.hasOwn(TIERS, r.tier)) ||
    (r.type === 'cmp' && typeof r.w === 'string' && typeof r.l === 'string' && r.w !== r.l && r.wt > 0));

export function parseState(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Geen geldig ESC-ranker-bestand (geen JSON)');
  }
  if (data?.version !== 1 || !Array.isArray(data.log)) throw new Error('Geen geldig ESC-ranker-bestand');
  const bad = data.log.findIndex((r) => !validRecord(r));
  if (bad >= 0) throw new Error(`Ongeldige regel ${bad + 1} in het bestand`);
  return { version: 1, log: data.log, lastExport: data.lastExport ?? null };
}

export function exportText(state) {
  return JSON.stringify({ version: 1, log: state.log, lastExport: state.lastExport });
}

export function daysSince(iso, now = new Date()) {
  return iso ? Math.floor((now - new Date(iso)) / 86400000) : null;
}
```

- [ ] **Step 4: Draai de tests**

Run: `node --test "tests/*.test.js"`
Expected: 35 tests, all pass

- [ ] **Step 5: Commit**

```bash
git add app/store.js tests/store.test.js
git commit -m "Opslag, export en import van het keuzelog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: App-raamwerk: pagina, stijl, speler, tabs Sorteren/Ranglijst/Meer

Vanaf hier is er geen geautomatiseerde test meer. Je controleert in de ingebouwde browser op mobiel formaat (preset `mobile`). `app/songs.json` uit Task 2 moet bestaan. Is het script nog bezig, wacht dan tot het klaar is.

**Files:**
- Create: `app/index.html`, `app/style.css`, `app/ui.js`, `app/player.js`, `app/app.js`, `app/list.js`
- Create: `.claude/launch.json`

**Interfaces:**
- Consumes: `ranking.js` (Task 3–5), `store.js` (Task 6).
- Produces:
  - `ui.js`: `h(tag, attrs, ...children)`, `flag(cc)`, `guard(fn)`, `frame(ctx, title, onUndo, ...body)`, `songInfo(song)`
  - `player.js`: `hasPreview(song)`, `play(song, keepQueue=false)`, `stop()`, `toggle(song)`, `playSequence(songs)`, `playButton(song)`, `skipButton()`, `ytLink(song)`
  - `app.js`: object `ctx` met `songs`, `byId: Map`, `state`, `model() -> {fitted, ranked, cert}`, `commit(build: (a) => records)`, `undoLast()`, `openSession(name)`, `closeSession()`, `toast(msg)`. Daarnaast `SESSIONS = {}` (Task 8 en 9 vullen dit).
  - `list.js`: `renderList(ctx, view)`. Task 10 breidt dit uit.

- [ ] **Step 1: Startconfiguratie voor de lokale server**

`.claude/launch.json`:
```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "esc-ranker",
      "runtimeExecutable": "python",
      "runtimeArgs": ["-m", "http.server", "8000", "--directory", "app"],
      "port": 8000
    }
  ]
}
```

- [ ] **Step 2: `app/index.html`**

```html
<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#140c2b">
  <title>ESC Ranker</title>
  <link rel="manifest" href="manifest.json">
  <link rel="icon" href="icon-192.png">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main id="view"></main>
  <nav id="tabs">
    <button data-tab="sort">Sorteren</button>
    <button data-tab="list">Ranglijst</button>
    <button data-tab="more">Meer</button>
  </nav>
  <div id="toast" hidden></div>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: `app/style.css`**

```css
:root {
  --bg: #140c2b; --card: #221640; --ring: #3a2b63; --text: #f4f0ff; --muted: #a99cc9;
  --accent: #ff3d8b; --top: #2ec27e; --oke: #f5c211; --meh: #8f7fb8; --warn: #ff9f43;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.4 system-ui, sans-serif; overscroll-behavior: none; }
button { font: inherit; color: inherit; border: none; border-radius: 12px; background: var(--ring); padding: 12px 16px; cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
h1 { font-size: 24px; margin: 8px 0 16px; }
h2 { font-size: 17px; margin: 0; flex: 1; text-align: center; }
h3 { font-size: 15px; color: var(--muted); margin: 24px 0 8px; }
.muted { color: var(--muted); }
.center { text-align: center; }
.empty { text-align: center; margin-top: 30vh; color: var(--muted); }

#view { padding: 16px 16px 96px; max-width: 640px; margin: 0 auto; }
#tabs { position: fixed; bottom: 0; left: 0; right: 0; display: flex; background: var(--card); padding-bottom: env(safe-area-inset-bottom); }
#tabs button { flex: 1; border-radius: 0; background: none; padding: 16px 0; color: var(--muted); }
#tabs button.active { color: var(--accent); font-weight: 600; }
body.in-session #tabs { display: none; }
body.in-session #view { padding-bottom: 16px; }
#toast { position: fixed; left: 16px; right: 16px; bottom: 84px; background: var(--accent); color: #fff; padding: 12px 16px; border-radius: 12px; text-align: center; }

/* Sorteren */
.bar { margin: 12px 0; }
.bar .label { display: flex; justify-content: space-between; font-size: 14px; color: var(--muted); }
.bar .track { height: 10px; background: var(--ring); border-radius: 5px; overflow: hidden; }
.bar .fill { height: 100%; background: var(--accent); }
.menu { display: grid; gap: 12px; margin-top: 20px; }
.menu button { text-align: left; background: var(--card); padding: 18px; display: flex; justify-content: space-between; align-items: center; }
.menu small { display: block; color: var(--muted); font-size: 13px; }
.count { background: var(--accent); color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 14px; }
.warn { background: var(--warn); color: #000; width: 100%; margin-top: 12px; }
.big { display: block; width: 100%; margin: 12px 0; padding: 16px; }
.primary { background: var(--accent); color: #fff; }

/* Sessies */
.session header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.icon { width: 44px; height: 44px; padding: 0; font-size: 20px; background: none; }
.card { background: var(--card); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.card.big { padding: 24px; margin-bottom: 24px; }
.info .meta { color: var(--muted); font-size: 14px; }
.info .artist { font-weight: 600; }
.info .title { font-size: 20px; }
.card.big .info .title { font-size: 28px; }
.controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.yt { color: var(--muted); text-decoration: none; padding: 8px 12px; border-radius: 10px; background: var(--ring); font-size: 14px; }
.yt.primary { background: #ff0033; color: #fff; }
.skip { padding: 8px 12px; font-size: 14px; }
.tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.tier { padding: 22px 0; font-size: 18px; font-weight: 600; color: #000; }
.tier.top { background: var(--top); }
.tier.oke { background: var(--oke); }
.tier.meh { background: var(--meh); }
.duel { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.duel .info .title { font-size: 17px; }
.choose { background: var(--accent); color: #fff; font-weight: 600; margin-top: auto; padding: 14px 4px; font-size: 14px; }
.row { display: flex; gap: 12px; margin-top: 16px; align-items: center; }
.row > button { flex: 1; }

/* Play-knop met voortgangsring */
.play { width: 56px; height: 56px; padding: 0; border-radius: 50%; position: relative; flex: none;
  background: conic-gradient(var(--accent) calc(var(--p, 0) * 360deg), var(--ring) 0); }
.play::after { content: '▶'; position: absolute; inset: 5px; border-radius: 50%; background: var(--card); display: grid; place-items: center; font-size: 18px; }
.play.playing::after { content: '❚❚'; }
.play.none { width: auto; height: auto; border-radius: 8px; background: var(--ring); font-size: 12px; padding: 6px 8px; }
.play.none::after { content: none; }

/* Groepje */
ol.group { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
ol.group li { display: flex; align-items: center; gap: 8px; background: var(--card); border-radius: 12px; padding: 4px 4px 4px 8px; min-height: 56px; }
ol.group li.picked { outline: 2px solid var(--accent); }
ol.group .play { width: 44px; height: 44px; }
.pick { flex: 1; display: grid; grid-template-columns: 1fr auto; text-align: left; background: none; padding: 4px; min-width: 0; }
.pick .line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 15px; }
.pick .sub { grid-column: 1; color: var(--muted); font-size: 12px; }
.pick .badge { grid-row: 1 / 3; grid-column: 2; align-self: center; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; border: 2px dashed var(--ring); }
li.picked .badge { background: var(--accent); border: none; font-weight: 700; }

/* Ranglijst */
.chips { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0 8px; position: sticky; top: 0; background: var(--bg); z-index: 1; }
.chip { padding: 8px 12px; border-radius: 999px; flex: none; }
.chip.active { background: var(--accent); color: #fff; }
ol.ranking { list-style: none; padding: 0; margin: 0; }
ol.ranking li { display: flex; flex-wrap: wrap; align-items: center; border-bottom: 1px solid var(--ring); }
.rowmain { flex: 1; display: flex; align-items: center; gap: 10px; background: none; border-radius: 0; padding: 12px 4px; text-align: left; min-width: 0; }
.rowmain .pos { width: 32px; color: var(--muted); text-align: right; flex: none; }
.rowmain .line { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rowmain .sub { color: var(--muted); font-size: 12px; }
.dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--muted); flex: none; }
.dot.half { background: linear-gradient(90deg, var(--muted) 50%, transparent 50%); }
.dot.vol { background: var(--top); border-color: var(--top); }
.details { width: 100%; padding: 0 8px 12px 46px; }
.details input { width: 72px; padding: 8px; border-radius: 8px; border: none; font: inherit; }
.unplaced { color: var(--muted); font-size: 14px; padding-left: 20px; }
```

- [ ] **Step 4: `app/ui.js`**

```js
// ui.js — kleine hulpfuncties om schermen op te bouwen.

// h('button', {class: 'x', onclick: fn}, 'tekst') -> <button class="x">tekst</button>
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// 'SE' -> 🇸🇪
export const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));

// Voorkomt dubbele tikken: na een tik zijn alle knoppen met guard 300 ms dood.
let busy = false;
export function guard(fn) {
  return (...args) => {
    if (busy) return;
    busy = true;
    setTimeout(() => { busy = false; }, 300);
    fn(...args);
  };
}

// Kader van een sessiescherm: ✕ links, titel, ↶ rechts.
export function frame(ctx, title, onUndo, ...body) {
  return h('div', { class: 'session' },
    h('header', {},
      h('button', { class: 'icon', 'aria-label': 'Sluiten', onclick: () => ctx.closeSession() }, '✕'),
      h('h2', {}, title),
      h('button', { class: 'icon', 'aria-label': 'Ongedaan maken', disabled: !ctx.state.log.length, onclick: guard(onUndo) }, '↶')),
    ...body);
}

export function songInfo(song) {
  return h('div', { class: 'info' },
    h('div', { class: 'meta' }, `${flag(song.cc)} ${song.country} · ${song.year}`),
    h('div', { class: 'artist' }, song.artist),
    h('div', { class: 'title' }, song.title));
}
```

- [ ] **Step 5: `app/player.js`**

```js
// player.js — één audiospeler voor de hele app; er speelt nooit meer dan één fragment.
import { h } from './ui.js';

const audio = new Audio();
const broken = new Set();   // fragmenten die niet laadden
let currentId = null;
let queue = [];             // voor "▶▶ beide"

export const hasPreview = (song) => Boolean(song.preview) && !broken.has(song.id);

export function play(song, keepQueue = false) {
  if (!keepQueue) queue = [];
  if (!hasPreview(song)) return;
  if (currentId !== song.id) {
    audio.src = song.preview;
    currentId = song.id;
  }
  audio.play().catch(() => {});  // Android blokkeert afspelen vóór de eerste tik; dat is prima
}

export function stop() {
  queue = [];
  audio.pause();
}

export function toggle(song) {
  if (currentId === song.id && !audio.paused) stop();
  else play(song);
}

export function playSequence(songs) {
  const [first, ...rest] = songs.filter(hasPreview);
  if (!first) return;
  play(first);
  queue = rest;
}

export function playButton(song) {
  if (!hasPreview(song)) return h('button', { class: 'play none', disabled: true }, 'geen fragment');
  return h('button', { class: 'play', 'data-id': song.id, 'aria-label': 'Afspelen',
    onclick: (e) => { e.stopPropagation(); toggle(song); } });
}

export function skipButton() {
  return h('button', { class: 'skip', onclick: (e) => {
    e.stopPropagation();
    if (currentId) audio.currentTime = Math.min(audio.currentTime + 10, (audio.duration || 30) - 0.5);
  } }, '+10 s');
}

export function ytLink(song) {
  return h('a', { class: hasPreview(song) ? 'yt' : 'yt primary', href: song.youtube, target: '_blank', rel: 'noopener',
    onclick: (e) => { e.stopPropagation(); stop(); } }, '▶ YouTube');
}

// Alle play-knoppen op het scherm bijwerken (icoon en voortgangsring).
function refresh() {
  for (const b of document.querySelectorAll('button.play[data-id]')) {
    const on = b.dataset.id === currentId;
    b.classList.toggle('playing', on && !audio.paused);
    b.style.setProperty('--p', on && audio.duration ? audio.currentTime / audio.duration : 0);
  }
}

for (const ev of ['play', 'pause', 'timeupdate', 'ended']) audio.addEventListener(ev, refresh);
audio.addEventListener('ended', () => { if (queue.length) play(queue.shift(), true); });
audio.addEventListener('error', () => {
  if (!currentId) return;
  broken.add(currentId);
  for (const b of document.querySelectorAll(`button.play[data-id="${currentId}"]`)) b.replaceWith(playButton({ id: currentId }));
  currentId = null;
  if (queue.length) play(queue.shift(), true);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
```

- [ ] **Step 6: `app/list.js` (basisversie; Task 10 voegt verplaatsen toe)**

```js
// list.js — tab Ranglijst: filter op jaar en details per nummer.
import { dot } from './ranking.js';
import { h, flag } from './ui.js';
import { playButton, ytLink } from './player.js';

let year = 'all';
let openId = null;

export function renderList(ctx, view) {
  const { ranked, fitted } = ctx.model();
  const years = [...new Set(ctx.songs.map((s) => s.year))].sort();
  const inYear = (y) => year === 'all' || y === year;
  const visible = ranked.filter((s) => inYear(ctx.byId.get(s.id).year));
  const unplaced = ctx.songs.filter((s) => !fitted.has(s.id) && inYear(s.year));
  const rerender = () => { view.replaceChildren(); renderList(ctx, view); };

  view.append(
    h('div', { class: 'chips' }, ['all', ...years].map((y) =>
      h('button', { class: y === year ? 'chip active' : 'chip', onclick: () => { year = y; openId = null; rerender(); } },
        y === 'all' ? 'Alle' : `'${String(y).slice(2)}`))),
    visible.length ? null : h('p', { class: 'muted' }, 'Nog niets ingedeeld. Begin bij Sorteren.'),
    h('ol', { class: 'ranking' }, visible.map((entry, i) => row(ctx, entry, i, visible, rerender))),
    unplaced.length ? h('h3', {}, `Nog niet ingedeeld (${unplaced.length})`) : null,
    h('ul', { class: 'unplaced' }, unplaced.map((s) => h('li', {}, `${flag(s.cc)} ${s.artist} – ${s.title} (${s.year})`))),
  );
}

function row(ctx, entry, i, visible, rerender) {
  const song = ctx.byId.get(entry.id);
  const isOpen = openId === entry.id;
  const li = h('li', { class: isOpen ? 'open' : '' },
    h('button', { class: 'rowmain', onclick: () => { openId = isOpen ? null : entry.id; rerender(); } },
      h('span', { class: 'pos' }, i + 1),
      h('span', { class: `dot ${dot(entry.se)}` }),
      h('span', { class: 'line' }, `${flag(song.cc)} ${song.artist} – ${song.title}`),
      h('span', { class: 'sub' }, song.year)));
  if (isOpen) li.append(details(ctx, entry, song));
  return li;
}

function details(ctx, entry, song) {
  return h('div', { class: 'details' },
    h('div', { class: 'controls' }, playButton(song), ytLink(song)),
    h('p', { class: 'muted' },
      `Totaal #${entry.rank} (waarschijnlijk tussen #${entry.lo} en #${entry.hi}) · ${Math.round(entry.n)} vergelijkingen`));
}
```

- [ ] **Step 7: `app/app.js`**

```js
// app.js — opstart, gedeelde staat, tabs Sorteren en Meer, en navigatie.
import { fit, rankList, certainty, filterKnown, undo, nextAction, dot } from './ranking.js';
import { load, save, exportText, parseState, daysSince } from './store.js';
import { h } from './ui.js';
import { stop } from './player.js';
import { renderList } from './list.js';

// Sessieschermen; Task 8 en 9 vullen dit.
const SESSIONS = {};

const view = document.getElementById('view');
const toastEl = document.getElementById('toast');
let persisted = false;

const ctx = {
  songs: [],
  byId: new Map(),
  state: load(),
  tab: 'sort',
  session: null,
  _model: null,
  _toastTimer: null,

  // Scores worden alleen opnieuw berekend na een wijziging in het log.
  model() {
    if (!this._model) {
      const fitted = fit(filterKnown(this.state.log, this.byId));
      const ranked = rankList(fitted);
      this._model = { fitted, ranked, cert: certainty(ranked, this.songs.length) };
    }
    return this._model;
  },
  commit(build) {
    this.state.log.push(...build(nextAction(this.state.log)));
    this.changed();
  },
  undoLast() {
    this.state.log = undo(this.state.log);
    this.changed();
  },
  changed() {
    this._model = null;
    save(this.state);
  },
  openSession(name) {
    history.pushState({ session: name }, '');
    this.session = { before: new Set(zekerIds()), startAction: nextAction(this.state.log) };
    document.body.classList.add('in-session');
    SESSIONS[name](this, view);
  },
  // Via history.back(), zodat ✕ en het Android-terug-gebaar hetzelfde doen.
  closeSession() {
    if (this.session) history.back();
  },
  toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2500);
  },
};

const zekerIds = () => ctx.model().ranked.filter((s) => dot(s.se) === 'vol').map((s) => s.id);

function endSession() {
  stop();
  const actions = new Set(ctx.state.log.filter((r) => r.a >= ctx.session.startAction).map((r) => r.a)).size;
  const newlySure = zekerIds().filter((id) => !ctx.session.before.has(id)).length;
  ctx.session = null;
  document.body.classList.remove('in-session');
  render();
  if (actions) ctx.toast(`+${actions} keuzes` + (newlySure ? ` · ${newlySure} nummers zeker erbij` : ''));
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ctx.tab));
  view.replaceChildren();
  if (ctx.tab === 'sort') renderSort();
  else if (ctx.tab === 'list') renderList(ctx, view);
  else renderMore();
}

// ---------- Sorteren ----------

function bar(label, value, frac) {
  return h('div', { class: 'bar' },
    h('div', { class: 'label' }, h('span', {}, label), h('span', {}, value)),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round(frac * 100)}%` })));
}

function menuButton(title, sub, count, session, disabled) {
  return h('button', { disabled, onclick: () => ctx.openSession(session) },
    h('span', {}, title, h('small', {}, sub)),
    count ? h('span', { class: 'count' }, count) : null);
}

function renderSort() {
  const { ranked, cert } = ctx.model();
  const total = ctx.songs.length;
  const open = total - ranked.length;
  const days = daysSince(ctx.state.lastExport);
  const needBackup = ctx.state.log.length > 0 && (days === null || days > 14);
  view.append(
    h('h1', {}, 'ESC Ranker'),
    bar('Ingedeeld', `${ranked.length}/${total}`, total ? ranked.length / total : 0),
    bar('Zekerheid', `${Math.round(cert * 100)}%`, cert),
    needBackup && h('button', { class: 'warn', onclick: () => { ctx.tab = 'more'; render(); } },
      days === null ? 'Nog geen back-up gemaakt: maak er nu een' : `Laatste back-up ${days} dagen geleden: maak een nieuwe`),
    h('div', { class: 'menu' },
      menuButton('Snelle schifting', 'Top / oké / meh per nummer', open, 'schifting', open === 0),
      menuButton('Duel', 'Kies de betere van twee', null, 'duel', ranked.length < 2),
      menuButton('Groepje van 8', 'Tik ze in volgorde', null, 'groepje', ranked.length < 8),
      open > 0 && menuButton('Invoegen', 'Plaats een nummer met een paar vragen', open, 'invoegen', false)),
  );
}

// ---------- Meer ----------

function renderMore() {
  const days = daysSince(ctx.state.lastExport);
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: (e) => importFile(e.target.files[0]) });
  view.append(
    h('h1', {}, 'Meer'),
    h('p', {}, `${ctx.state.log.length} opgeslagen keuzes · laatste back-up: `
      + (days === null ? 'nooit' : days === 0 ? 'vandaag' : `${days} dagen geleden`)),
    h('button', { class: 'big primary', onclick: exportBackup }, 'Back-up exporteren'),
    h('button', { class: 'big', onclick: () => fileInput.click() }, 'Back-up importeren'),
    fileInput,
    h('p', { class: 'muted' }, `${ctx.songs.length} nummers · opslag ${persisted ? 'beschermd' : 'niet beschermd'}`),
  );
}

async function exportBackup() {
  const now = new Date().toISOString();
  const name = `esc-ranker-${now.slice(0, 10)}.json`;
  const file = new File([exportText({ ...ctx.state, lastExport: now })], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      h('a', { href: URL.createObjectURL(file), download: name }).click();
    }
  } catch (e) {
    if (e.name === 'AbortError') return;  // delen geannuleerd
    alert(`Exporteren mislukt: ${e.message}`);
    return;
  }
  ctx.state.lastExport = now;
  save(ctx.state);
  render();
  ctx.toast('Back-up gemaakt');
}

async function importFile(file) {
  if (!file) return;
  try {
    const next = parseState(await file.text());
    if (!confirm(`Dit vervangt je ${ctx.state.log.length} keuzes door ${next.log.length} keuzes uit de back-up. Doorgaan?`)) return;
    ctx.state = next;
    ctx.changed();
    render();
    ctx.toast('Back-up teruggezet');
  } catch (e) {
    alert(`Kan dit bestand niet gebruiken: ${e.message}`);
  }
}

// ---------- opstart ----------

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  stop();
  ctx.tab = b.dataset.tab;
  render();
});
window.addEventListener('popstate', () => { if (ctx.session) endSession(); });
navigator.storage?.persist?.().then((p) => { persisted = p; });

async function start() {
  ctx.songs = await (await fetch('songs.json')).json();
  ctx.byId = new Map(ctx.songs.map((s) => [s.id, s]));
  render();
}
start();
```

- [ ] **Step 8: Controleer in de browser**

Start de server met `preview_start` (naam `esc-ranker`), zet het venster op preset `mobile` en open `http://localhost:8000`. Controleer:
1. Sorteren toont "Ingedeeld 0/309" en "Zekerheid 0%". Snelle schifting heeft badge 309. Duel en Groepje zijn uitgeschakeld. Invoegen is zichtbaar.
2. Er staan geen fouten in de console (`read_console_messages`, `onlyErrors`).
3. Tab Ranglijst: jaarknoppen Alle, '18, '19, '21 … '26. De melding "Nog niets ingedeeld". Onder "Nog niet ingedeeld (309)" staan de nummers.
4. Tab Meer: "0 opgeslagen keuzes · laatste back-up: nooit".
5. Zet een testlog in de console, herlaad en kijk of Ranglijst gevuld is:
   ```js
   localStorage.setItem('esc-ranker-v1', JSON.stringify({version:1, lastExport:null, log:[{a:1,type:'tier',id:'2023-SE',tier:'top'},{a:2,type:'tier',id:'2023-FI',tier:'oke'}]}))
   ```
   Verwacht: de Ranglijst toont 2 nummers, en een tik op een rij toont play, YouTube en "Totaal #1 …". De play-knop speelt het fragment af en de ring loopt mee. Sorteren toont een oranje back-up-herinnering.
6. Ruim op: `localStorage.clear()`.

- [ ] **Step 9: Commit**

```bash
git add .claude/launch.json app/index.html app/style.css app/ui.js app/player.js app/list.js app/app.js
git commit -m "App-raamwerk: tabs, audiospeler, ranglijst en back-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sessies Snelle schifting, Duel en Invoegen

**Files:**
- Create: `app/sessions.js`
- Modify: `app/app.js` (import plus `SESSIONS` vullen)

**Interfaces:**
- Consumes: `ctx` (Task 7), `ui.js`, `player.js`, en uit `ranking.js`: `tierRecord`, `duelRecords`, `finishInsert`, `insertStart`, `insertProbe`, `insertAnswer`, `pickDuel`, `recentPairs`, `makeRng`, `shuffle`.
- Produces: `schifting(ctx, view)`, `duel(ctx, view)`, `invoegen(ctx, view)`, `duelCard(song, onChoose, label)`.

- [ ] **Step 1: `app/sessions.js`**

```js
// sessions.js — de schermen Snelle schifting, Duel en Invoegen.
import { tierRecord, duelRecords, finishInsert, insertStart, insertProbe, insertAnswer,
  pickDuel, recentPairs, makeRng, shuffle } from './ranking.js';
import { h, frame, guard, songInfo } from './ui.js';
import { play, stop, toggle, playButton, skipButton, ytLink, playSequence } from './player.js';

const rng = makeRng();

export function duelCard(song, onChoose, label = 'KIES') {
  return h('div', { class: 'card', onclick: () => toggle(song) },
    songInfo(song),
    h('div', { class: 'controls' }, playButton(song), ytLink(song)),
    h('button', { class: 'choose', onclick: (e) => { e.stopPropagation(); onChoose(); } }, label));
}

const empty = (ctx, view, title, onUndo, text) =>
  view.replaceChildren(frame(ctx, title, onUndo, h('p', { class: 'empty' }, text)));

// ---------- Snelle schifting ----------

export function schifting(ctx, view) {
  const placed = () => ctx.model().fitted;
  let queue = shuffle(ctx.songs.filter((s) => !placed().has(s.id)).map((s) => s.id), rng);
  const done = [];  // in deze sessie geschifte nummers, voor ongedaan maken

  function render() {
    stop();
    queue = queue.filter((id) => !placed().has(id));
    const song = ctx.byId.get(queue[0]);
    if (!song) return empty(ctx, view, 'Snelle schifting', undoStep, 'Alle nummers zijn ingedeeld! 🎉');
    const choose = (tier) => guard(() => {
      ctx.commit((a) => tierRecord(song.id, tier, a));
      done.push(song.id);
      render();
    });
    view.replaceChildren(frame(ctx, `Snelle schifting · nog ${queue.length}`, undoStep,
      h('div', { class: 'card big' }, songInfo(song), h('div', { class: 'controls' }, playButton(song), skipButton(), ytLink(song))),
      h('div', { class: 'tiers' },
        h('button', { class: 'tier top', onclick: choose('top') }, 'Top'),
        h('button', { class: 'tier oke', onclick: choose('oke') }, 'Oké'),
        h('button', { class: 'tier meh', onclick: choose('meh') }, 'Meh'))));
    play(song);
  }

  function undoStep() {
    ctx.undoLast();
    const id = done.pop();
    if (id) queue.unshift(id);
    render();
  }

  render();
}

// ---------- Duel ----------

export function duel(ctx, view) {
  let pair = null;

  function next() {
    const { ranked, cert } = ctx.model();
    pair = pickDuel(ranked, recentPairs(ctx.state.log), cert, rng);
    render();
  }

  function render() {
    stop();
    if (!pair) return empty(ctx, view, 'Duel', undoStep, 'Deel eerst minstens 2 nummers in via Snelle schifting.');
    const [a, b] = pair.map((id) => ctx.byId.get(id));
    const win = (w, l) => guard(() => { ctx.commit((act) => duelRecords(w.id, l.id, act)); next(); });
    view.replaceChildren(frame(ctx, 'Duel', undoStep,
      h('div', { class: 'duel' }, duelCard(a, win(a, b)), duelCard(b, win(b, a))),
      h('div', { class: 'row' },
        h('button', { onclick: () => playSequence([a, b]) }, '▶▶ beide'),
        h('button', { onclick: guard(next) }, 'overslaan'))));
  }

  function undoStep() {
    ctx.undoLast();
    next();
  }

  next();
}

// ---------- Invoegen ----------

export function invoegen(ctx, view) {
  let song, ranked, state, answers;

  function begin() {
    // Nieuwste jaar eerst: na een nieuw songfestival zijn dat de nummers die je wilt plaatsen.
    song = ctx.songs.filter((s) => !ctx.model().fitted.has(s.id)).sort((x, y) => y.year - x.year)[0];
    ranked = ctx.model().ranked;  // vaste momentopname tijdens het zoeken
    state = insertStart(ranked);
    answers = [];
    render();
  }

  function render() {
    stop();
    if (!song) return empty(ctx, view, 'Invoegen', undoStep, 'Er zijn geen nieuwe nummers om in te voegen.');
    const mid = insertProbe(state);
    if (mid === null) {
      const placedSong = song;
      ctx.commit((a) => finishInsert(placedSong.id, answers, a));
      const rank = ctx.model().ranked.findIndex((s) => s.id === placedSong.id) + 1;
      ctx.toast(`${placedSong.artist} staat nu op #${rank}`);
      return begin();
    }
    const other = ctx.byId.get(ranked[mid].id);
    const total = Math.ceil(Math.log2(ranked.length + 1));
    const answer = (better) => guard(() => {
      answers.push({ otherId: other.id, better });
      state = insertAnswer(state, better);
      render();
    });
    view.replaceChildren(frame(ctx, `Invoegen · vraag ${answers.length + 1} van ~${total}`, undoStep,
      h('p', { class: 'muted center' }, 'Welke vind je beter?'),
      h('div', { class: 'duel' },
        duelCard(song, answer(true), 'NIEUW IS BETER'),
        duelCard(other, answer(false), 'DEZE IS BETER'))));
  }

  // Tijdens het zoeken: één vraag terug. Anders: de laatste opgeslagen actie terugdraaien.
  function undoStep() {
    if (answers.length) {
      answers.pop();
      state = answers.reduce((st, x) => insertAnswer(st, x.better), insertStart(ranked));
      render();
    } else {
      ctx.undoLast();
      begin();
    }
  }

  begin();
}
```

- [ ] **Step 2: Koppel de sessies in `app/app.js`**

Voeg toe bij de imports:
```js
import { schifting, duel, invoegen } from './sessions.js';
```
Vervang:
```js
// Sessieschermen; Task 8 en 9 vullen dit.
const SESSIONS = {};
```
door:
```js
// Sessieschermen; Task 9 voegt het groepje toe.
const SESSIONS = { schifting, duel, invoegen };
```

- [ ] **Step 3: Controleer in de browser** (mobiel formaat, eerst `localStorage.clear()` en herladen)
1. Snelle schifting: er verschijnt een kaart met vlag, land, jaar, artiest en titel. Tik **Top**: het volgende nummer verschijnt, de titel telt af ("nog 308") en het fragment start vanzelf. Doe er zo een stuk of 12.
2. ↶ brengt het vorige nummer terug. ✕ sluit de sessie, met een melding "+N keuzes". Sorteren toont "Ingedeeld N/309".
3. Het browser-terug-gebaar (`navigate` met `back`) tijdens een sessie sluit alleen de sessie.
4. Duel: twee kaarten. Tik op een kaart speelt die af en stopt de andere. **KIES** levert een nieuw paar op. "▶▶ beide" speelt A en daarna B. "overslaan" geeft een nieuw paar zonder opslag. Snel dubbel tikken op KIES slaat maar één keuze op (controleer `JSON.parse(localStorage['esc-ranker-v1']).log.length`).
5. Invoegen: "vraag 1 van ~4" (bij ~12 ingedeeld). Na de laatste vraag verschijnt een melding "… staat nu op #k" en komt het volgende nieuwe nummer. ↶ midden in het zoeken gaat één vraag terug.
6. Lege situatie: na `localStorage.clear()` en herladen eerst Invoegen openen. Het eerste nummer wordt direct geplaatst ("#1"), zonder vragen.
7. Een nummer zonder fragment toont "geen fragment" met een rode YouTube-knop. Zoek er een uit de lijst die het script meldde.
8. Er staan geen fouten in de console.

- [ ] **Step 4: Commit**

```bash
git add app/sessions.js app/app.js
git commit -m "Sessies schifting, duel en invoegen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Sessie Groepje van 8

**Files:**
- Create: `app/group.js`
- Modify: `app/app.js`

**Interfaces:**
- Consumes: `ctx`, `ui.js`, `player.js`, en uit `ranking.js`: `pickGroup`, `groupRecords`, `makeRng`.
- Produces: `groepje(ctx, view)`.

- [ ] **Step 1: `app/group.js`**

```js
// group.js — scherm "Groepje van 8": tik de nummers van beste naar slechtste.
import { pickGroup, groupRecords, makeRng } from './ranking.js';
import { h, frame, guard, flag } from './ui.js';
import { stop, playButton } from './player.js';

const rng = makeRng();

export function groepje(ctx, view) {
  let ids = null;
  let order = [];

  function next() {
    stop();
    const { ranked, cert } = ctx.model();
    ids = pickGroup(ranked, cert, rng);
    order = [];
    render();
  }

  // Let op: render stopt de audio niet, zodat je kunt blijven luisteren terwijl je tikt.
  function render() {
    if (!ids) {
      view.replaceChildren(frame(ctx, 'Groepje van 8', undoStep,
        h('p', { class: 'empty' }, 'Deel eerst minstens 8 nummers in via Snelle schifting.')));
      return;
    }
    const rows = ids.map((id) => {
      const song = ctx.byId.get(id);
      const pos = order.indexOf(id);
      return h('li', { class: pos >= 0 ? 'picked' : '' },
        playButton(song),
        h('button', { class: 'pick', onclick: () => tap(id) },
          h('span', { class: 'line' }, `${flag(song.cc)} ${song.artist} – ${song.title}`),
          h('span', { class: 'sub' }, `${song.country} ${song.year}`),
          h('span', { class: 'badge' }, pos >= 0 ? pos + 1 : '')));
    });
    view.replaceChildren(frame(ctx, `Groepje · ${order.length}/${ids.length}`, undoStep,
      h('p', { class: 'muted center' }, 'Tik van beste naar slechtste'),
      h('ol', { class: 'group' }, rows),
      h('div', { class: 'row' },
        h('button', { onclick: guard(next) }, 'Ander groepje'),
        h('button', { class: 'primary', disabled: order.length < ids.length, onclick: guard(submit) }, 'Bevestig'))));
  }

  // Nog eens tikken haalt een nummer uit de volgorde.
  function tap(id) {
    order = order.includes(id) ? order.filter((x) => x !== id) : [...order, id];
    render();
  }

  function submit() {
    ctx.commit((a) => groupRecords(order, a));
    next();
  }

  function undoStep() {
    ctx.undoLast();
    next();
  }

  next();
}
```

- [ ] **Step 2: Koppel in `app/app.js`**

Voeg toe bij de imports:
```js
import { groepje } from './group.js';
```
Vervang:
```js
// Sessieschermen; Task 9 voegt het groepje toe.
const SESSIONS = { schifting, duel, invoegen };
```
door:
```js
const SESSIONS = { schifting, duel, invoegen, groepje };
```

- [ ] **Step 3: Controleer in de browser** (mobiel formaat 375×812, minstens 8 nummers ingedeeld)
1. Groepje van 8: 8 rijen, header, hint en knoppen passen **zonder scrollen** (controleer met een screenshot).
2. Tik de rijen in volgorde: de badges tonen 1–8. Nogmaals tikken op rij 3 haalt die weg, en daarna schuiven 4–8 op naar 3–7. Bevestig is pas actief bij 8/8.
3. Bevestig levert een nieuw groepje op. Het log groeit met 28 records met één gemeenschappelijke `a`. ↶ haalt alle 28 in één keer weg.
4. Een play-knop speelt af, ook terwijl je tikt (de audio stopt niet bij een tik).
5. Met minder dan 8 ingedeeld (na `localStorage.clear()`) is de knop uitgeschakeld op Sorteren.

- [ ] **Step 4: Commit**

```bash
git add app/group.js app/app.js
git commit -m "Sessie groepje van 8 met tikken in volgorde

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verplaatsen in de ranglijst (naar #… en slepen per jaar)

**Files:**
- Modify: `app/list.js`
- Modify: `app/style.css` (toevoegen onderaan)

**Interfaces:**
- Consumes: `moveRecords` uit `ranking.js`, `guard` uit `ui.js`, `ctx.commit`.
- Produces: `moveTo(ctx, id, pos, visible, rerender)` (intern in list.js).

- [ ] **Step 1: Pas `app/list.js` aan**

Vervang de importregels bovenaan door:
```js
import { dot, moveRecords } from './ranking.js';
import { h, flag, guard } from './ui.js';
import { playButton, ytLink } from './player.js';
```

Vervang in `row()` dit stuk:
```js
      h('span', { class: 'sub' }, song.year)));
  if (isOpen) li.append(details(ctx, entry, song));
```
door:
```js
      h('span', { class: 'sub' }, song.year)),
    // Slepen alleen binnen één jaar; in de lijst van ~300 is dat onwerkbaar.
    year !== 'all' && h('span', { class: 'grip', 'aria-label': 'Verslepen',
      onpointerdown: (e) => startDrag(e, ctx, entry.id, i, visible, rerender) }, '≡'));
  if (isOpen) li.append(details(ctx, entry, song, i, visible, rerender));
```

Vervang de hele functie `details` door:
```js
function details(ctx, entry, song, i, visible, rerender) {
  const input = h('input', { type: 'number', min: 1, max: visible.length, value: i + 1, inputmode: 'numeric' });
  return h('div', { class: 'details' },
    h('div', { class: 'controls' }, playButton(song), ytLink(song)),
    h('p', { class: 'muted' },
      `Totaal #${entry.rank} (waarschijnlijk tussen #${entry.lo} en #${entry.hi}) · ${Math.round(entry.n)} vergelijkingen`),
    h('div', { class: 'row' },
      h('span', {}, 'Verplaats naar #'),
      input,
      h('button', { onclick: guard(() => moveTo(ctx, entry.id, Number(input.value), visible, rerender)) }, 'OK')));
}

// Verplaats naar plek `pos` (1 = bovenaan) in de zichtbare lijst: twee zware vergelijkingen met de nieuwe buren.
function moveTo(ctx, id, pos, visible, rerender) {
  const others = visible.filter((s) => s.id !== id);
  const k = Math.min(Math.max(1, Math.round(pos) || 1), others.length + 1) - 1;
  ctx.commit((a) => moveRecords(id, others[k - 1]?.id ?? null, others[k]?.id ?? null, a));
  rerender();
}

function startDrag(e, ctx, id, from, visible, rerender) {
  e.preventDefault();
  const list = e.target.closest('ol');
  const rowEl = e.target.closest('li');
  const items = [...list.children].filter((li) => li !== rowEl);
  rowEl.classList.add('dragging');
  let target = from;

  const move = (ev) => {
    if (ev.clientY < 80) scrollBy(0, -12);
    else if (ev.clientY > innerHeight - 80) scrollBy(0, 12);
    target = items.filter((li) => {
      const r = li.getBoundingClientRect();
      return r.top + r.height / 2 < ev.clientY;
    }).length;
    items.forEach((li, j) => li.classList.toggle('drop-before', j === target));
    list.classList.toggle('drop-end', target === items.length);
  };
  const end = (ev) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
    if (ev.type === 'pointerup' && target !== from) moveTo(ctx, id, target + 1, visible, rerender);
    else rerender();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
}
```

- [ ] **Step 2: Stijl voor slepen** (onderaan `app/style.css`)

```css
.grip { padding: 12px; color: var(--muted); touch-action: none; user-select: none; font-size: 20px; cursor: grab; }
li.dragging { opacity: .5; }
li.drop-before { box-shadow: 0 -3px 0 var(--accent); }
ol.drop-end { box-shadow: 0 3px 0 var(--accent); }
```

- [ ] **Step 3: Controleer in de browser** (minstens ~20 nummers ingedeeld, verspreid over jaren)
1. Bij "Alle" staat er geen grip ≡. Bij jaar '23 wel.
2. Tik op een rij, kies "Verplaats naar #1" en OK: het nummer staat bovenaan of er dicht bij. Het is een model, dus de plek hoeft niet exact te kloppen. Het log heeft 1–2 records met `wt: 3`.
3. Bij '23: sleep een nummer via ≡ omlaag. Een roze lijn toont de doelplek, en na loslaten staat het nummer daar of in de buurt. Slepen terug naar de eigen plek slaat niets op.
4. Ga terug naar Sorteren en open Duel. ↶ draait de verplaatsing terug.

- [ ] **Step 4: Commit**

```bash
git add app/list.js app/style.css
git commit -m "Verplaatsen in de ranglijst: naar #... en slepen per jaar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: PWA (manifest, iconen, offline) en publicatie-workflow

**Files:**
- Create: `data/make_icons.py`, `app/icon-192.png`, `app/icon-512.png` (gegenereerd)
- Create: `app/manifest.json`, `app/sw.js`
- Modify: `app/app.js` (service worker registreren)
- Create: `.github/workflows/pages.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: alle bestanden in `app/` (de service worker cachet ze).

- [ ] **Step 1: Iconen maken**

`data/make_icons.py`:
```python
"""Maakt app/icon-192.png en app/icon-512.png: een roze '12' op paars (douze points)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parent.parent / "app"

for size in (192, 512):
    img = Image.new("RGB", (size, size), "#140c2b")
    draw = ImageDraw.Draw(img)
    margin = size * 0.18  # binnen de "veilige zone" voor ronde Android-iconen
    draw.ellipse([margin, margin, size - margin, size - margin], fill="#ff3d8b")
    font = ImageFont.load_default(size=int(size * 0.32))
    draw.text((size / 2, size / 2), "12", font=font, fill="white", anchor="mm")
    img.save(APP / f"icon-{size}.png")
    print(f"icon-{size}.png gemaakt")
```

Run: `.venv/Scripts/python data/make_icons.py`
Expected: `icon-192.png gemaakt` en `icon-512.png gemaakt`. Bekijk `app/icon-512.png` met de Read-tool: een roze cirkel met "12".

- [ ] **Step 2: `app/manifest.json`**

```json
{
  "name": "ESC Ranker",
  "short_name": "ESC Ranker",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#140c2b",
  "theme_color": "#140c2b",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 3: `app/sw.js`**

```js
// sw.js — service worker: de app opent ook zonder internet.
// Strategie: geef direct de bewaarde versie en haal op de achtergrond een nieuwe op
// ("stale-while-revalidate"). Een nieuwe versie zie je dus bij de volgende keer openen.
const CACHE = 'esc-ranker';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'ranking.js', 'store.js', 'ui.js', 'player.js',
  'sessions.js', 'group.js', 'list.js', 'songs.json', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Alleen eigen bestanden; audio van iTunes en YouTube gaan gewoon via internet.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request);
    const fresh = fetch(e.request)
      .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => cached);
    return cached || fresh;
  }));
});
```

- [ ] **Step 4: Registreer de service worker** in `app/app.js`

Voeg toe direct boven `start();` (de laatste regel):
```js
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
```

- [ ] **Step 5: `.github/workflows/pages.yml`**

```yaml
# Publiceert de map app/ op GitHub Pages bij elke push naar main.
name: Publiceer app
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: app
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 6: `README.md`**

````markdown
# ESC Ranker

Persoonlijke app (PWA) om één ranglijst te maken van alle Eurovisie-inzendingen
2018, 2019 en 2021–2026, met audiofragmenten. Ontwerp: `docs/superpowers/specs/`.

## Mappen

- `data/`: Python-scripts die `app/songs.json` en de iconen maken
- `app/`: de app zelf (wordt gepubliceerd op GitHub Pages)
- `tests/`: tests voor Python (`pytest`) en JavaScript (`node --test`)

## Eenmalig installeren

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

## Nummers bijwerken (bijv. na een nieuw songfestival)

1. Voeg het jaar toe aan `YEARS` in `data/build_songs.py`.
2. `.venv/Scripts/python data/build_songs.py` (duurt even door de pauzes voor iTunes).
3. Verkeerd of ontbrekend fragment? Zet een regel in `data/overrides.csv`,
   bijv. `2026-NL,preview,https://...m4a`, en draai stap 2 opnieuw.
4. Commit en push. De nieuwe nummers verschijnen in de app onder "Invoegen".

## Testen

```bash
.venv/Scripts/python -m pytest
node --test "tests/*.test.js"
```

## Lokaal bekijken

```bash
python -m http.server 8000 --directory app
```
en open http://localhost:8000.

## Je ranglijst

Die staat alleen op je telefoon (browseropslag). Maak af en toe een back-up via
**Meer → Back-up exporteren**.
````

- [ ] **Step 7: Controleer**

Run: `.venv/Scripts/python -m pytest -q && node --test "tests/*.test.js"`
Expected: alle Python-tests en JS-tests slagen.

In de browser (herlaad twee keer):
1. Console zonder fouten. `navigator.serviceWorker.controller` is niet null.
2. `await caches.keys()` geeft `['esc-ranker']`.
3. `await (await fetch('manifest.json')).json()` geeft de naam "ESC Ranker".

- [ ] **Step 8: Commit**

```bash
git add data/make_icons.py app/icon-192.png app/icon-512.png app/manifest.json app/sw.js app/app.js .github/workflows/pages.yml README.md
git commit -m "PWA: manifest, iconen, offline en GitHub Pages-workflow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Publiceren en installeren op de telefoon (samen met de gebruiker)

Deze stappen zijn **naar buiten gericht**: er gaat iets online. Vraag bij elke stap eerst toestemming aan de gebruiker. De `gh`-CLI is niet geïnstalleerd, dus de gebruiker doet de GitHub-stappen in de browser en jij begeleidt.

**Files:** geen nieuwe.

- [ ] **Step 1: Hoofdbranch hernoemen naar `main`**

```bash
git branch -M main && git status --short
```
Expected: geen openstaande wijzigingen.

- [ ] **Step 2: De gebruiker maakt een GitHub-repository**

Vraag de gebruiker op https://github.com/new een **publieke** repository `esc-ranker` aan te maken, zonder README. GitHub Pages is gratis voor publieke repositories. Er staan geen persoonlijke gegevens in de repo: de ranglijst blijft op de telefoon. Vraag om de URL.

- [ ] **Step 3: Pushen (na toestemming)**

```bash
git remote add origin <URL van de gebruiker> && git push -u origin main
```

- [ ] **Step 4: Pages aanzetten**

De gebruiker gaat naar de repository → **Settings → Pages → Source: GitHub Actions**. Daarna start de workflow "Publiceer app" bij **Actions** opnieuw (Run workflow). Het adres wordt `https://<gebruikersnaam>.github.io/esc-ranker/`.

- [ ] **Step 5: Installeren op Android**

De gebruiker opent het adres in Chrome op de telefoon → menu ⋮ → **Toevoegen aan startscherm** (of "App installeren"). Laat de gebruiker controleren:
1. Het icoon "12" staat op het beginscherm en de app opent zonder adresbalk.
2. Het fragment speelt af na de eerste tik.
3. Het terug-gebaar in een sessie sluit alleen de sessie.
4. Meer → Back-up exporteren opent het deelmenu (bijv. Drive).
5. In vliegtuigmodus opent de app nog (alleen fragmenten werken dan niet).
````
