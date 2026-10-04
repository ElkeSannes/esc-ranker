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
