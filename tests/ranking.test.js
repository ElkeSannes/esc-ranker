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
