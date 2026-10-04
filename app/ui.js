// ui.js — kleine hulpfuncties om schermen op te bouwen.

// h('button', {class: 'x', onclick: fn}, 'tekst') -> <button class="x">tekst</button>
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// 'SE' -> 🇸🇪
export const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));

// Voorkomt dubbele tikken: na een tik zijn alle knoppen met guard 300 ms dood.
let busy = false;
export function guard(fn) {
  return (...args) => {
    if (busy) return;
    busy = true;
    setTimeout(() => { busy = false; }, 300);
    fn(...args);
  };
}

// Kader van een sessiescherm: ✕ links, titel, ↶ rechts.
export function frame(ctx, title, onUndo, ...body) {
  return h('div', { class: 'session' },
    h('header', {},
      h('button', { class: 'icon', 'aria-label': 'Sluiten', onclick: () => ctx.closeSession() }, '✕'),
      h('h2', {}, title),
      h('button', { class: 'icon', 'aria-label': 'Ongedaan maken', disabled: !ctx.state.log.length, onclick: guard(onUndo) }, '↶')),
    ...body);
}

export function songInfo(song) {
  return h('div', { class: 'info' },
    h('div', { class: 'meta' }, `${flag(song.cc)} ${song.country} · ${song.year}`),
    h('div', { class: 'artist' }, song.artist),
    h('div', { class: 'title' }, song.title));
}
