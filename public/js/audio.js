let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('ns_muted') === '1'; } catch { /* ignore */ }

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('ns_muted', muted ? '1' : '0'); } catch { /* ignore */ }
}

function tone({ f = 440, to = null, type = 'sine', dur = 0.12, vol = 0.08, at = 0 }) {
  if (muted) return;
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

export const sfx = {
  click:   () => tone({ f: 620, type: 'square', dur: 0.05, vol: 0.04 }),
  join:    () => { tone({ f: 500, type: 'triangle', dur: 0.08 }); tone({ f: 750, type: 'triangle', dur: 0.1, at: 0.08 }); },
  msg:     () => tone({ f: 900, dur: 0.04, vol: 0.03 }),
  turn:    () => tone({ f: 420, to: 560, type: 'triangle', dur: 0.14 }),
  start:   () => { tone({ f: 660, type: 'triangle', dur: 0.1 }); tone({ f: 990, type: 'triangle', dur: 0.16, at: 0.1 }); },
  tick:    alt => tone({ f: alt ? 260 : 340, type: 'square', dur: 0.05, vol: 0.045 }),
  close:   () => { tone({ f: 380, type: 'square', dur: 0.09, vol: 0.05 }); tone({ f: 380, type: 'square', dur: 0.09, vol: 0.05, at: 0.13 }); },
  correct: () => [660, 880, 1320].forEach((f, i) => tone({ f, dur: 0.14, vol: 0.075, at: i * 0.09 })),
  roundEnd: () => tone({ f: 420, to: 130, type: 'sawtooth', dur: 0.45, vol: 0.06 }),
  fanfare: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.2, vol: 0.09, at: i * 0.13 }));
    [784, 988, 1175, 1568].forEach(f => tone({ f, type: 'square', dur: 0.7, vol: 0.03, at: 0.55 }));
  }
};