// player.js — één audiospeler voor de hele app; er speelt nooit meer dan één fragment.
import { h } from './ui.js';

const audio = new Audio();
const broken = new Set();   // fragmenten die niet laadden
let currentId = null;
let queue = [];             // voor "▶▶ beide"

export const hasPreview = (song) => Boolean(song.preview) && !broken.has(song.id);

export function play(song, keepQueue = false) {
  if (!keepQueue) queue = [];
  if (!hasPreview(song)) return;
  if (currentId !== song.id) {
    audio.src = song.preview;
    currentId = song.id;
  }
  audio.play().catch(() => {});  // Android blokkeert afspelen vóór de eerste tik; dat is prima
}

export function stop() {
  queue = [];
  audio.pause();
}

export function toggle(song) {
  if (currentId === song.id && !audio.paused) stop();
  else play(song);
}

export function playSequence(songs) {
  const [first, ...rest] = songs.filter(hasPreview);
  if (!first) return;
  play(first);
  queue = rest;
}

export function playButton(song) {
  if (!hasPreview(song)) return h('button', { class: 'play none', disabled: true }, 'geen fragment');
  return h('button', { class: 'play', 'data-id': song.id, 'aria-label': 'Afspelen',
    onclick: (e) => { e.stopPropagation(); toggle(song); } });
}

export function skipButton() {
  return h('button', { class: 'skip', onclick: (e) => {
    e.stopPropagation();
    if (currentId) audio.currentTime = Math.min(audio.currentTime + 10, (audio.duration || 30) - 0.5);
  } }, '+10 s');
}

export function ytLink(song) {
  return h('a', { class: hasPreview(song) ? 'yt' : 'yt primary', href: song.youtube, target: '_blank', rel: 'noopener',
    onclick: (e) => { e.stopPropagation(); stop(); } }, '▶ YouTube');
}

// Alle play-knoppen op het scherm bijwerken (icoon en voortgangsring).
function refresh() {
  for (const b of document.querySelectorAll('button.play[data-id]')) {
    const on = b.dataset.id === currentId;
    b.classList.toggle('playing', on && !audio.paused);
    b.style.setProperty('--p', on && audio.duration ? audio.currentTime / audio.duration : 0);
  }
}

for (const ev of ['play', 'pause', 'timeupdate', 'ended']) audio.addEventListener(ev, refresh);
audio.addEventListener('ended', () => { if (queue.length) play(queue.shift(), true); });
audio.addEventListener('error', () => {
  if (!currentId) return;
  broken.add(currentId);
  for (const b of document.querySelectorAll(`button.play[data-id="${currentId}"]`)) b.replaceWith(playButton({ id: currentId }));
  currentId = null;
  if (queue.length) play(queue.shift(), true);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
