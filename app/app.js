// app.js — opstart, gedeelde staat, tabs Sorteren en Meer, en navigatie.
import { fit, rankList, certainty, filterKnown, undo, nextAction, dot } from './ranking.js';
import { load, save, exportText, parseState, daysSince } from './store.js';
import { h } from './ui.js';
import { stop } from './player.js';
import { renderList } from './list.js';
import { schifting, duel, invoegen } from './sessions.js';
import { groepje } from './group.js';

const SESSIONS = { schifting, duel, invoegen, groepje };

const view = document.getElementById('view');
const toastEl = document.getElementById('toast');
let persisted = false;

const ctx = {
  songs: [],
  byId: new Map(),
  state: load(),
  tab: 'sort',
  session: null,
  _model: null,
  _toastTimer: null,

  // Scores worden alleen opnieuw berekend na een wijziging in het log.
  model() {
    if (!this._model) {
      const fitted = fit(filterKnown(this.state.log, this.byId));
      const ranked = rankList(fitted);
      this._model = { fitted, ranked, cert: certainty(ranked, this.songs.length) };
    }
    return this._model;
  },
  commit(build) {
    this.state.log.push(...build(nextAction(this.state.log)));
    this.changed();
  },
  undoLast() {
    this.state.log = undo(this.state.log);
    this.changed();
  },
  changed() {
    this._model = null;
    save(this.state);
  },
  openSession(name) {
    history.pushState({ session: name }, '');
    this.session = { before: new Set(zekerIds()), startAction: nextAction(this.state.log) };
    document.body.classList.add('in-session');
    SESSIONS[name](this, view);
  },
  // Via history.back(), zodat ✕ en het Android-terug-gebaar hetzelfde doen.
  closeSession() {
    if (this.session) history.back();
  },
  toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2500);
  },
};

const zekerIds = () => ctx.model().ranked.filter((s) => dot(s.se) === 'vol').map((s) => s.id);

function endSession() {
  stop();
  const actions = new Set(ctx.state.log.filter((r) => r.a >= ctx.session.startAction).map((r) => r.a)).size;
  const newlySure = zekerIds().filter((id) => !ctx.session.before.has(id)).length;
  ctx.session = null;
  document.body.classList.remove('in-session');
  render();
  if (actions) ctx.toast(`+${actions} keuzes` + (newlySure ? ` · ${newlySure} nummers zeker erbij` : ''));
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ctx.tab));
  view.replaceChildren();
  if (ctx.tab === 'sort') renderSort();
  else if (ctx.tab === 'list') renderList(ctx, view);
  else renderMore();
}

// ---------- Sorteren ----------

function bar(label, value, frac) {
  return h('div', { class: 'bar' },
    h('div', { class: 'label' }, h('span', {}, label), h('span', {}, value)),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round(frac * 100)}%` })));
}

function menuButton(title, sub, count, session, disabled) {
  return h('button', { disabled, onclick: () => ctx.openSession(session) },
    h('span', {}, title, h('small', {}, sub)),
    count ? h('span', { class: 'count' }, count) : null);
}

function renderSort() {
  const { ranked, cert } = ctx.model();
  const total = ctx.songs.length;
  const open = total - ranked.length;
  const days = daysSince(ctx.state.lastExport);
  const needBackup = ctx.state.log.length > 0 && (days === null || days > 14);
  view.append(
    h('h1', {}, 'ESC Ranker'),
    bar('Ingedeeld', `${ranked.length}/${total}`, total ? ranked.length / total : 0),
    bar('Zekerheid', `${Math.round(cert * 100)}%`, cert),
    needBackup ? h('button', { class: 'warn', onclick: () => { ctx.tab = 'more'; render(); } },
      days === null ? 'Nog geen back-up gemaakt: maak er nu een' : `Laatste back-up ${days} dagen geleden: maak een nieuwe`) : '',
    h('div', { class: 'menu' },
      menuButton('Snelle schifting', 'Top / oké / meh per nummer', open, 'schifting', open === 0),
      menuButton('Duel', 'Kies de betere van twee', null, 'duel', ranked.length < 2),
      menuButton('Groepje van 8', 'Tik ze in volgorde', null, 'groepje', ranked.length < 8),
      open > 0 && menuButton('Invoegen', 'Plaats een nummer met een paar vragen', open, 'invoegen', false)),
  );
}

// ---------- Meer ----------

function renderMore() {
  const days = daysSince(ctx.state.lastExport);
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: (e) => importFile(e.target.files[0]) });
  view.append(
    h('h1', {}, 'Meer'),
    h('p', {}, `${ctx.state.log.length} opgeslagen keuzes · laatste back-up: `
      + (days === null ? 'nooit' : days === 0 ? 'vandaag' : `${days} dagen geleden`)),
    h('button', { class: 'big primary', onclick: exportBackup }, 'Back-up exporteren'),
    h('button', { class: 'big', onclick: () => fileInput.click() }, 'Back-up importeren'),
    fileInput,
    h('p', { class: 'muted' }, `${ctx.songs.length} nummers · opslag ${persisted ? 'beschermd' : 'niet beschermd'}`),
  );
}

async function exportBackup() {
  const now = new Date().toISOString();
  const name = `esc-ranker-${now.slice(0, 10)}.json`;
  const file = new File([exportText({ ...ctx.state, lastExport: now })], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      h('a', { href: URL.createObjectURL(file), download: name }).click();
    }
  } catch (e) {
    if (e.name === 'AbortError') return;  // delen geannuleerd
    alert(`Exporteren mislukt: ${e.message}`);
    return;
  }
  ctx.state.lastExport = now;
  save(ctx.state);
  render();
  ctx.toast('Back-up gemaakt');
}

async function importFile(file) {
  if (!file) return;
  try {
    const next = parseState(await file.text());
    if (!confirm(`Dit vervangt je ${ctx.state.log.length} keuzes door ${next.log.length} keuzes uit de back-up. Doorgaan?`)) return;
    ctx.state = next;
    ctx.changed();
    render();
    ctx.toast('Back-up teruggezet');
  } catch (e) {
    alert(`Kan dit bestand niet gebruiken: ${e.message}`);
  }
}

// ---------- opstart ----------

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  stop();
  ctx.tab = b.dataset.tab;
  render();
});
window.addEventListener('popstate', () => { if (ctx.session) endSession(); });
navigator.storage?.persist?.().then((p) => { persisted = p; });

async function start() {
  ctx.songs = await (await fetch('songs.json')).json();
  ctx.byId = new Map(ctx.songs.map((s) => [s.id, s]));
  render();
}
start();
