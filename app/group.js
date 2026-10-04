// group.js — scherm "Groepje van 8": tik de nummers van beste naar slechtste.
import { pickGroup, groupRecords, makeRng } from './ranking.js';
import { h, frame, guard, flag } from './ui.js';
import { stop, playButton } from './player.js';

const rng = makeRng();

export function groepje(ctx, view) {
  let ids = null;
  let order = [];

  function next() {
    stop();
    const { ranked, cert } = ctx.model();
    ids = pickGroup(ranked, cert, rng);
    order = [];
    render();
  }

  // Let op: render stopt de audio niet, zodat je kunt blijven luisteren terwijl je tikt.
  function render() {
    if (!ids) {
      view.replaceChildren(frame(ctx, 'Groepje van 8', undoStep,
        h('p', { class: 'empty' }, 'Deel eerst minstens 8 nummers in via Snelle schifting.')));
      return;
    }
    const rows = ids.map((id) => {
      const song = ctx.byId.get(id);
      const pos = order.indexOf(id);
      return h('li', { class: pos >= 0 ? 'picked' : '' },
        playButton(song),
        h('button', { class: 'pick', onclick: () => tap(id) },
          h('span', { class: 'line' }, `${flag(song.cc)} ${song.artist} – ${song.title}`),
          h('span', { class: 'sub' }, `${song.country} ${song.year}`),
          h('span', { class: 'badge' }, pos >= 0 ? pos + 1 : '')));
    });
    view.replaceChildren(frame(ctx, `Groepje · ${order.length}/${ids.length}`, undoStep,
      h('p', { class: 'muted center' }, 'Tik van beste naar slechtste'),
      h('ol', { class: 'group' }, rows),
      h('div', { class: 'row' },
        h('button', { onclick: guard(next) }, 'Ander groepje'),
        h('button', { class: 'primary', disabled: order.length < ids.length, onclick: guard(submit) }, 'Bevestig'))));
  }

  // Nog eens tikken haalt een nummer uit de volgorde.
  function tap(id) {
    order = order.includes(id) ? order.filter((x) => x !== id) : [...order, id];
    render();
  }

  function submit() {
    ctx.commit((a) => groupRecords(order, a));
    next();
  }

  function undoStep() {
    ctx.undoLast();
    next();
  }

  next();
}
