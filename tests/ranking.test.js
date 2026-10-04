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
