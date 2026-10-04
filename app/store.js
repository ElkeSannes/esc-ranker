// store.js — het keuzelog bewaren in localStorage, plus export en import.
import { TIERS } from './ranking.js';

export const KEY = 'esc-ranker-v1';

export function emptyState() {
  return { version: 1, log: [], lastExport: null };
}

export function load(storage = localStorage, now = Date.now) {
  const raw = storage.getItem(KEY);
  if (!raw) return emptyState();
  try {
    return parseState(raw);
  } catch {
    // Niet stil weggooien: bewaar de kapotte versie (met tijdstempel, dus nooit overschreven).
    storage.setItem(`${KEY}-kapot-${now()}`, raw);
    return emptyState();
  }
}

// Sleutels van bewaarde kapotte versies; de app toont die zodat je ze kunt downloaden.
export function brokenCopies(storage = localStorage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k.startsWith(`${KEY}-kapot`)) keys.push(k);
  }
  return keys;
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
