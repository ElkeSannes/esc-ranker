// list.js — tab Ranglijst: filter op jaar en details per nummer.
import { dot, moveRecords } from './ranking.js';
import { h, flag, guard } from './ui.js';
import { playButton, ytLink } from './player.js';

let year = 'all';
let openId = null;

export function renderList(ctx, view) {
  const { ranked, fitted } = ctx.model();
  const years = [...new Set(ctx.songs.map((s) => s.year))].sort();
  const inYear = (y) => year === 'all' || y === year;
  const visible = ranked.filter((s) => inYear(ctx.byId.get(s.id).year));
  const unplaced = ctx.songs.filter((s) => !fitted.has(s.id) && inYear(s.year));
  const rerender = () => { view.replaceChildren(); renderList(ctx, view); };

  view.append(
    h('div', { class: 'chips' }, ['all', ...years].map((y) =>
      h('button', { class: y === year ? 'chip active' : 'chip', onclick: () => { year = y; openId = null; rerender(); } },
        y === 'all' ? 'Alle' : `'${String(y).slice(2)}`))),
    visible.length ? '' : h('p', { class: 'muted' }, 'Nog niets ingedeeld. Begin bij Sorteren.'),
    h('ol', { class: 'ranking' }, visible.map((entry, i) => row(ctx, entry, i, visible, rerender))),
    unplaced.length ? h('h3', {}, `Nog niet ingedeeld (${unplaced.length})`) : '',
    h('ul', { class: 'unplaced' }, unplaced.map((s) => h('li', {}, `${flag(s.cc)} ${s.artist} – ${s.title} (${s.year})`))),
  );
}

function row(ctx, entry, i, visible, rerender) {
  const song = ctx.byId.get(entry.id);
  const isOpen = openId === entry.id;
  const li = h('li', { class: isOpen ? 'open' : '' },
    h('button', { class: 'rowmain', onclick: () => { openId = isOpen ? null : entry.id; rerender(); } },
      h('span', { class: 'pos' }, i + 1),
      h('span', { class: `dot ${dot(entry.se)}` }),
      h('span', { class: 'line' }, `${flag(song.cc)} ${song.artist} – ${song.title}`),
      h('span', { class: 'sub' }, song.year)),
    // Slepen alleen binnen één jaar; in de lijst van ~300 is dat onwerkbaar.
    year !== 'all' && h('span', { class: 'grip', 'aria-label': 'Verslepen',
      onpointerdown: (e) => startDrag(e, ctx, entry.id, i, visible, rerender) }, '≡'));
  if (isOpen) li.append(details(ctx, entry, song, i, visible, rerender));
  return li;
}

function details(ctx, entry, song, i, visible, rerender) {
  const input = h('input', { type: 'number', min: 1, max: visible.length, value: i + 1, inputmode: 'numeric' });
  return h('div', { class: 'details' },
    h('div', { class: 'controls' }, playButton(song), ytLink(song)),
    h('p', { class: 'muted' },
      `Totaal #${entry.rank} (waarschijnlijk tussen #${entry.lo} en #${entry.hi}) · ${Math.round(entry.n)} vergelijkingen`),
    h('div', { class: 'row' },
      h('span', {}, 'Verplaats naar #'),
      input,
      h('button', { onclick: guard(() => moveTo(ctx, entry.id, Number(input.value), visible, rerender)) }, 'OK')));
}

// Verplaats naar plek `pos` (1 = bovenaan) in de zichtbare lijst: twee zware vergelijkingen met de nieuwe buren.
function moveTo(ctx, id, pos, visible, rerender) {
  const others = visible.filter((s) => s.id !== id);
  const k = Math.min(Math.max(1, Math.round(pos) || 1), others.length + 1) - 1;
  ctx.commit((a) => moveRecords(id, others[k - 1]?.id ?? null, others[k]?.id ?? null, a));
  rerender();
}

function startDrag(e, ctx, id, from, visible, rerender) {
  e.preventDefault();
  const list = e.target.closest('ol');
  const rowEl = e.target.closest('li');
  const items = [...list.children].filter((li) => li !== rowEl);
  rowEl.classList.add('dragging');
  let target = from;

  const move = (ev) => {
    if (ev.clientY < 80) scrollBy(0, -12);
    else if (ev.clientY > innerHeight - 80) scrollBy(0, 12);
    target = items.filter((li) => {
      const r = li.getBoundingClientRect();
      return r.top + r.height / 2 < ev.clientY;
    }).length;
    items.forEach((li, j) => li.classList.toggle('drop-before', j === target));
    list.classList.toggle('drop-end', target === items.length);
  };
  const end = (ev) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
    if (ev.type === 'pointerup' && target !== from) moveTo(ctx, id, target + 1, visible, rerender);
    else rerender();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
}
