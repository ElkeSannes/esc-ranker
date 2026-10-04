// list.js — tab Ranglijst: filter op jaar en details per nummer.
import { dot } from './ranking.js';
import { h, flag } from './ui.js';
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
      h('span', { class: 'sub' }, song.year)));
  if (isOpen) li.append(details(ctx, entry, song));
  return li;
}

function details(ctx, entry, song) {
  return h('div', { class: 'details' },
    h('div', { class: 'controls' }, playButton(song), ytLink(song)),
    h('p', { class: 'muted' },
      `Totaal #${entry.rank} (waarschijnlijk tussen #${entry.lo} en #${entry.hi}) · ${Math.round(entry.n)} vergelijkingen`));
}
