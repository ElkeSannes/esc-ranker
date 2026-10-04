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

test('lastAction: de records van de laatste actie', () => {
  const log = [tier('A', 'top', 1), cmp('A', 'B', 2, 0.5), cmp('A', 'C', 2, 0.5)];
  assert.deepEqual(R.lastAction(log), log.slice(1));
  assert.deepEqual(R.lastAction([]), []);
});

test('describeAction: zegt in gewone taal wat er wordt teruggedraaid', () => {
  const name = (id) => `#${id}`;
  assert.equal(R.describeAction([tier('A', 'top')], name), 'schifting van #A');
  assert.equal(R.describeAction([cmp('A', 'B')], name), 'duel #A tegen #B');
  assert.equal(R.describeAction(R.groupRecords(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 1), name), 'groepje van 8');
  assert.equal(R.describeAction(R.moveRecords('X', 'U', 'L', 1), name), 'verplaatsing van #X');
  assert.equal(R.describeAction(R.finishInsert('N', [{ otherId: 'A', better: true }, { otherId: 'B', better: false }], 1), name), 'invoeging van #N');
});

test('targetPosition: ongeldige invoer doet niets, de rest wordt begrensd', () => {
  assert.equal(R.targetPosition('', 10), null);
  assert.equal(R.targetPosition('0', 10), null);
  assert.equal(R.targetPosition('abc', 10), null);
  assert.equal(R.targetPosition('3', 10), 3);
  assert.equal(R.targetPosition('2.6', 10), 3);
  assert.equal(R.targetPosition('99', 10), 10);
});
