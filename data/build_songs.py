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
