// sessions.js — de schermen Snelle schifting, Duel en Invoegen.
import { tierRecord, duelRecords, finishInsert, insertStart, insertProbe, insertAnswer,
  pickDuel, recentPairs, makeRng, shuffle } from './ranking.js';
import { h, frame, guard, songInfo } from './ui.js';
import { play, stop, toggle, playButton, skipButton, ytLink, playSequence } from './player.js';

const rng = makeRng();

export function duelCard(song, onChoose, label = 'KIES') {
  return h('div', { class: 'card', onclick: () => toggle(song) },
    songInfo(song),
    h('div', { class: 'controls' }, playButton(song), ytLink(song)),
    h('button', { class: 'choose', onclick: (e) => { e.stopPropagation(); onChoose(); } }, label));
}

const empty = (ctx, view, title, onUndo, text) =>
  view.replaceChildren(frame(ctx, title, onUndo, h('p', { class: 'empty' }, text)));

// ---------- Snelle schifting ----------

export function schifting(ctx, view) {
  const placed = () => ctx.model().fitted;
  let queue = shuffle(ctx.songs.filter((s) => !placed().has(s.id)).map((s) => s.id), rng);
  function render() {
    stop();
    queue = queue.filter((id) => !placed().has(id));
    const song = ctx.byId.get(queue[0]);
    if (!song) return empty(ctx, view, 'Snelle schifting', undoStep, 'Alle nummers zijn ingedeeld! 🎉');
    const choose = (tier) => guard(() => {
      ctx.commit((a) => tierRecord(song.id, tier, a));
      render();
    });
    view.replaceChildren(frame(ctx, `Snelle schifting · nog ${queue.length}`, undoStep,
      h('div', { class: 'card big' }, songInfo(song), h('div', { class: 'controls' }, playButton(song), skipButton(), ytLink(song))),
      h('div', { class: 'tiers' },
        h('button', { class: 'tier top', onclick: choose('top') }, 'Top'),
        h('button', { class: 'tier oke', onclick: choose('oke') }, 'Oké'),
        h('button', { class: 'tier meh', onclick: choose('meh') }, 'Meh'))));
    play(song);
  }

  // Een teruggedraaide schifting komt meteen weer in beeld.
  function undoStep() {
    const t = ctx.undoLast().find((r) => r.type === 'tier');
    if (t) queue.unshift(t.id);
    render();
  }

  render();
}

// ---------- Duel ----------

export function duel(ctx, view) {
  let pair = null;

  function next() {
    const { ranked, cert } = ctx.model();
    pair = pickDuel(ranked, recentPairs(ctx.state.log), cert, rng);
    render();
  }

  function render() {
    stop();
    if (!pair) return empty(ctx, view, 'Duel', undoStep, 'Deel eerst minstens 2 nummers in via Snelle schifting.');
    const [a, b] = pair.map((id) => ctx.byId.get(id));
    const win = (w, l) => guard(() => { ctx.commit((act) => duelRecords(w.id, l.id, act)); next(); });
    view.replaceChildren(frame(ctx, 'Duel', undoStep,
      h('div', { class: 'duel' }, duelCard(a, win(a, b)), duelCard(b, win(b, a))),
      h('div', { class: 'row' },
        h('button', { onclick: () => playSequence([a, b]) }, '▶▶ beide'),
        h('button', { onclick: guard(next) }, 'overslaan'))));
  }

  function undoStep() {
    if (ctx.undoLast().length) next();
  }

  next();
}

// ---------- Invoegen ----------

export function invoegen(ctx, view) {
  let song, ranked, state, answers;

  function begin() {
    // Nieuwste jaar eerst: na een nieuw songfestival zijn dat de nummers die je wilt plaatsen.
    song = ctx.songs.filter((s) => !ctx.model().fitted.has(s.id)).sort((x, y) => y.year - x.year)[0];
    ranked = ctx.model().ranked;  // vaste momentopname tijdens het zoeken
    state = insertStart(ranked);
    answers = [];
    render();
  }

  function render() {
    stop();
    if (!song) return empty(ctx, view, 'Invoegen', undoStep, 'Er zijn geen nieuwe nummers om in te voegen.');
    const mid = insertProbe(state);
    if (mid === null) {
      const placedSong = song;
      ctx.commit((a) => finishInsert(placedSong.id, answers, a));
      const rank = ctx.model().ranked.findIndex((s) => s.id === placedSong.id) + 1;
      ctx.toast(`${placedSong.artist} staat nu op #${rank}`);
      return begin();
    }
    const other = ctx.byId.get(ranked[mid].id);
    const total = Math.ceil(Math.log2(ranked.length + 1));
    const answer = (better) => guard(() => {
      answers.push({ otherId: other.id, better });
      state = insertAnswer(state, better);
      render();
    });
    view.replaceChildren(frame(ctx, `Invoegen · vraag ${answers.length + 1} van ~${total}`, undoStep,
      h('p', { class: 'muted center' }, 'Welke vind je beter?'),
      h('div', { class: 'duel' },
        duelCard(song, answer(true), 'NIEUW IS BETER'),
        duelCard(other, answer(false), 'DEZE IS BETER'))));
  }

  // Tijdens het zoeken: één vraag terug. Anders: de laatste opgeslagen actie terugdraaien.
  function undoStep() {
    if (answers.length) {
      answers.pop();
      state = answers.reduce((st, x) => insertAnswer(st, x.better), insertStart(ranked));
      render();
    } else {
      ctx.undoLast();
      begin();
    }
  }

  begin();
}
