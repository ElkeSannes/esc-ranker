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
