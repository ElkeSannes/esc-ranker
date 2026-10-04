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

// ---------- ongedaan maken en verplaatsen ----------

export function lastAction(log) {
  if (!log.length) return [];
  const last = log[log.length - 1].a;
  return log.filter((r) => r.a === last);
}

// Korte omschrijving van een actie, voor de melding na ↶. `name(id)` geeft een leesbare naam.
export function describeAction(recs, name) {
  if (!recs.length) return '';
  const [r] = recs;
  if (r.type === 'tier') return `schifting van ${name(r.id)}`;
  const pairs = recs.map((x) => [x.w, x.l]);
  const common = pairs[0].find((id) => pairs.every((p) => p.includes(id)));
  if (r.wt === CONFIG.GROUP_WT) return `groepje van ${new Set(pairs.flat()).size}`;
  if (r.wt === CONFIG.MOVE_WT) return recs.length > 1 ? `verplaatsing van ${name(common)}` : 'verplaatsing';
  if (recs.length === 1) return `duel ${name(r.w)} tegen ${name(r.l)}`;
  return `invoeging van ${name(common)}`;
}

// Ingetypte plek (1 = bovenaan) -> geldige plek, of null bij lege/ongeldige invoer.
export function targetPosition(value, count) {
  const n = Math.round(Number(value));
  if (value === '' || !Number.isFinite(n) || n < 1) return null;
  return Math.min(n, count);
}
