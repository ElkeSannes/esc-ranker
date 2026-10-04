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
