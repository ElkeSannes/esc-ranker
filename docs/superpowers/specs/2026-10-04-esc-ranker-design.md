# ESC Ranker — ontwerp

Datum: 2026-10-04

## Doel

Een app op mijn Android-telefoon om **één persoonlijke ranglijst** te maken van alle
Eurovisie-inzendingen van 2018, 2019 en 2021 t/m 2026 (2020 telt niet mee). Het gaat om
ongeveer 300 nummers, inclusief nummers die in de halve finale afvielen. Een ranglijst per
jaar krijg je door de totaallijst op jaar te filteren.

Bij elk nummer hoort een audiofragment van 30 seconden. De app helpt op meerdere manieren
bij het rangschikken, en ik kies zelf via een menu welke methode ik gebruik.

**Geslaagd als:**
- de app als icoon op het beginscherm staat en zonder laptop werkt;
- ik na ~300 schiftingsklikken en ~500 duels al een bruikbare lijst heb;
- ik per nummer zie hoe zeker de plek is;
- ik mijn voortgang niet kwijtraak (back-up).

**Buiten scope:** accounts, synchronisatie tussen apparaten, delen met vrienden, iPhone,
volledige nummers afspelen in de app, Spotify.

## Architectuur

- **Python-script** (`data/build_songs.py`) maakt één keer per jaar `app/songs.json`.
- **PWA**: één webpagina met gewone HTML/CSS/JavaScript, zonder framework. Gehost op
  GitHub Pages en via "Toevoegen aan startscherm" geïnstalleerd.
- **Gegevens** staan alleen in de browseropslag (`localStorage`) van de telefoon. Er is
  geen server.

```
ranker/
  data/
    build_songs.py     maakt songs.json (Wikipedia + iTunes)
    overrides.csv      handmatige correcties
    cache/             tussenresultaten van iTunes (niet in git)
  app/                 wordt gepubliceerd op GitHub Pages
    index.html
    app.js             schermen, knoppen, audio, opslag
    ranking.js         model en paarselectie (geen DOM; los testbaar)
    style.css
    songs.json
    manifest.json      app-naam en icoon voor Android
    sw.js              service worker: app opent ook zonder internet
    icon-192.png, icon-512.png
  tests/
    test_build_songs.py   (pytest)
    ranking.test.js       (node --test)
```

## Gegevens: `songs.json`

Een lijst met per nummer:

| veld | voorbeeld | opmerking |
|---|---|---|
| `id` | `"2023-SE"` | jaar + ISO-landcode; stabiel en uniek |
| `year` | `2023` | |
| `country` | `"Sweden"` | |
| `cc` | `"SE"` | ISO-code, de app maakt hier de vlag-emoji van |
| `artist` | `"Loreen"` | |
| `title` | `"Tattoo"` | |
| `preview` | `"https://…m4a"` of `null` | fragment van 30 s (iTunes) |
| `youtube` | `"https://www.youtube.com/results?search_query=…"` | zoeklink naar het optreden |

### `build_songs.py`

1. Haalt per jaar de Wikipedia-pagina "Eurovision Song Contest JJJJ" op en leest de
   deelnemerstabel (land, artiest, titel). Landnamen worden met een vaste tabel omgezet
   naar ISO-codes.
2. Zoekt per nummer via de iTunes Search API
   (`https://itunes.apple.com/search?term=<artiest titel>&entity=song&limit=5`).
   Kiest de beste match op genormaliseerde artiest en titel (kleine letters, zonder
   leestekens en accenten). Bij twijfel geen fragment, liever leeg dan fout.
   - Tussen aanvragen zit ~3 s pauze, want iTunes staat ongeveer 20 per minuut toe.
   - Antwoorden worden bewaard in `data/cache/`, zodat opnieuw draaien snel gaat.
3. Past `overrides.csv` toe (kolommen `id,veld,waarde`), bijvoorbeeld een ander
   fragment of een gecorrigeerde titel.
4. Maakt de YouTube-zoeklink: `Eurovision <jaar> <land> <artiest> <titel>`.
5. Schrijft `app/songs.json` en drukt af welke nummers geen fragment hebben.

## Rangschikmodel (`ranking.js`)

### Eén bron van waarheid: het keuzelog

De app slaat **geen scores** op, maar een log van alles wat ik gekozen heb. Na elke actie
worden alle scores opnieuw berekend. De volgorde van mijn keuzes maakt dus niet uit,
tegenstrijdige keuzes middelen uit, en ongedaan maken betekent: laatste actie uit het log
halen.

Soorten records:
- `{a, type:"tier", id, tier}`: schifting, met `tier` = `top` | `oke` | `meh`.
- `{a, type:"cmp", w, l, wt}`: `w` won van `l` met gewicht `wt`.

`a` is een actie-ID. Alle records van één actie (bijvoorbeeld een heel groepje) delen
dezelfde `a`, zodat ongedaan maken in één keer werkt.

### Model: Bradley-Terry

- Elk nummer heeft een sterkte. P(A wint van B) = sA / (sA + sB).
- Er zijn drie **vaste ankers**: TOP, OKÉ en MEH, op +150, 0 en −150 punten (Elo-schaal).
- **Prior:** elk ingedeeld nummer speelt twee virtuele gelijke spellen (gewicht 1, dus
  0,5 winst + 0,5 verlies per spel) tegen het anker van zijn schifting-tier. Zonder tier
  (bijvoorbeeld bij invoegen) is dat het OKÉ-anker. Zo vliegen nummers zonder verlies
  niet naar oneindig.
- Schatten gebeurt met het MM-algoritme (Hunter, 2004). Het start vanaf de vorige
  uitkomst en stopt bij een verandering < 1e-6 of na 200 rondes.
- De getoonde score is `1500 + 400·log10(s)`.
- **Onzekerheid:** SE = 1 / √(Σ wt·p·(1−p)) over alle (virtuele) vergelijkingen van een
  nummer, omgerekend naar Elo-punten. In de lijst staat dat als rangbereik: de plaatsen
  die horen bij score ± 1 SE, bijvoorbeeld "#12 (8–17)".
- Een nummer is **zeker** als SE < `ZEKER_SE` (start: 60 punten). **Zekerheid** van de
  hele lijst = het aandeel zekere nummers.
- **Ingedeeld** = een nummer met minstens één tier- of cmp-record.

### Hoe elke methode het log vult

| methode | records |
|---|---|
| Schifting | 1 tier-record |
| Duel | 1 cmp, `wt=1`. "Overslaan" wordt niet opgeslagen |
| Groepje van 8 | alle 28 paren uit de getikte volgorde, elk `wt=0.5` |
| Invoegen | binair zoeken over de huidige lijst; elk antwoord is 1 cmp met `wt=1` (~8 vragen) |
| Handmatig verplaatsen | 2 cmp met `wt=3`: wint van de nieuwe onderbuur, verliest van de nieuwe bovenbuur |

### Paarselectie (duel)

- **Eerste nummer:** willekeurig uit de 10 ingedeelde nummers met de hoogste SE.
- **Tegenstander:**
  - met kans `r` een willekeurig nummer. `r` loopt lineair van `R_START` (0,30) bij 0%
    zekerheid naar `R_END` (0,15) bij ≥ 80% zekerheid. Onder 50% zekerheid komt dit
    nummer uit de hele lijst, daarna uit ±`R_RANGE` (40) plaatsen;
  - anders willekeurig uit de 10 nummers die in score het dichtst bij liggen;
  - in `SAME_YEAR` (25%) van de gevallen: liefst uit hetzelfde jaar, want dat maakt
    de lijsten per jaar scherper;
  - geen paar dat in de laatste 20 duels al voorkwam.
- Links en rechts staan in willekeurige volgorde.

### Samenstelling groepje van 8

- Rond een nummer met hoge SE.
- Onder 50% zekerheid: 4 nummers dichtbij + 4 verspreid (één uit elk kwart van de lijst).
- Vanaf 50% zekerheid: 6 dichtbij + 2 verspreid.

Alle getallen hierboven staan als constanten bovenaan `ranking.js`.

### Opslag

- `localStorage`-sleutel `esc-ranker-v1` met `{version:1, log:[…], lastExport}`.
- Er wordt opgeslagen na elke actie.
- Bij de start vraagt de app `navigator.storage.persist()` aan, zodat Android de opslag
  niet zomaar wist.
- Records met een `id` dat niet in `songs.json` staat, worden genegeerd (niet verwijderd).

## Schermen

Onderaan staan drie tabs: **Sorteren · Ranglijst · Meer**. Een methode opent schermvullend,
met ✕ (terug) en ↶ (laatste actie ongedaan maken). Het Android-terug-gebaar sluit het
scherm, niet de app (`history.pushState`).

**Sorteren:** twee voortgangsbalken (ingedeeld x/300, zekerheid %) en vier grote knoppen:
Snelle schifting (badge: aantal open), Duel, Groepje van 8, Invoegen. Invoegen is alleen
zichtbaar als er niet-ingedeelde nummers zijn. Na het sluiten van een sessie verschijnt
een korte melding, bijvoorbeeld "+14 keuzes · 3 nummers zekerder".

**Schifting:** grote kaart met vlag, land, jaar, artiest en titel, een play-knop en een
YouTube-link. Daaronder drie knoppen: Top / Oké / Meh. Het fragment start automatisch,
behalve bij het eerste nummer, want Android eist eerst een tik.

**Duel:** twee kaarten naast elkaar. Tikken op een kaart speelt het fragment af, een
aparte **KIES**-knop kiest. Onder de kaarten staan "▶▶ beide" (A en daarna B) en
"overslaan".

**Groepje van 8:** acht compacte rijen (≈ 60 px) die zonder scrollen op één scherm passen.
Links op elke rij een play-vak, rechts het tikvlak. Tik in volgorde van beste naar
slechtste; elke rij krijgt een badge 1–8, en nog eens tikken haalt de badge weg. Na 8
tikken verschijnt **Bevestig**.

**Invoegen:** zelfde opbouw als het duel. Links staat vast het nieuwe nummer, rechts het
vergelijkingsnummer. Bovenaan "vraag 3 van ~8".

**Ranglijst:** jaarknoppen (Alle · 18 · 19 · 21 … 26) en per rij plaats, vlag,
artiest – titel en een zekerheidsstip (leeg / half / vol). Een tik op een rij klapt die
uit met play, YouTube, het rangbereik en **"verplaats naar #…"**. Slepen kan alleen met
een filter op één jaar, via een grip ≡ (lang indrukken). Niet-ingedeelde nummers staan
apart onderaan.

**Meer:** exporteren (deelmenu via Web Share; als dat niet werkt een download van
`esc-ranker-JJJJ-MM-DD.json`), importeren (vervangt alles, eerst bevestigen) en
"laatste back-up: x dagen geleden".

### Gedrag van de audio

- Er is één `<audio>`-element; een nieuw fragment stopt het vorige.
- Om de play-knop staat een voortgangsring, plus een knop **+10 s**.
- Bij een ontbrekend of kapot fragment (`error`) is de play-knop grijs ("geen fragment")
  en wordt YouTube de hoofdknop.
- De audio stopt als de app naar de achtergrond gaat (`visibilitychange`).

### Kleine beveiligingen

- Bij een back-up ouder dan 14 dagen verschijnt een herinnering op Sorteren.
- Na een keuze zijn de knoppen 300 ms geblokkeerd (geen dubbele tik).
- `overscroll-behavior: none` voorkomt pull-to-refresh.
- Slepen werkt met Pointer Events en `touch-action: none` op de grip.

## Offline

De service worker bewaart de app-bestanden en `songs.json`. De app opent dus zonder
internet, en de ranglijst en schifting-gegevens zijn bekijkbaar. Fragmenten afspelen
heeft wel internet nodig.

## Testen

- **`ranking.test.js`** (`node --test`):
  - BT-uitkomst bij een bekende set uitslagen;
  - volgorde van het log maakt niet uit;
  - ongedaan maken herstelt de vorige stand;
  - het groepje levert 28 paren met het juiste gewicht;
  - invoegen vindt de juiste plek;
  - de paarselectie respecteert de constanten (statistisch, met een vaste seed).
- **`test_build_songs.py`** (pytest):
  - parseren van een opgeslagen Wikipedia-fragment;
  - normaliseren en matchen van iTunes-resultaten;
  - toepassen van overrides.
- **Handmatig:** de app op de telefoon proberen (installeren, audio, tikken, terug-gebaar,
  export en import).

## Publiceren

- `ranker/` wordt een git-repository.
- De map `app/` wordt via GitHub Pages gepubliceerd met een kleine GitHub Action
  (`.github/workflows/pages.yml`). De simpele instelling "deploy from folder" kan dat
  niet, want die ondersteunt alleen de hoofdmap of `docs/`.
