import { sfx, setMuted, isMuted, unlockAudio } from './audio.js';
import { DrawingBoard } from './canvas.js';

const $ = id => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const fmtWord = s => [...s.toUpperCase()].map(c => (c === ' ' ? '\u00A0' : c)).join(' ');

const COLORS = ['#ffffff', '#00f0ff', '#ff2bd6', '#b6ff3c', '#ffe600', '#ff8a00',
  '#ff3b3b', '#a020ff', '#2b6bff', '#00ff9c', '#ff9ecb', '#b5651d'];
const MEDALS = ['🥇', '🥈', '🥉'];
const DIFF = {
  easy: { label: 'EASY', mult: '×1' },
  medium: { label: 'MEDIUM', mult: '×1.25' },
  hard: { label: 'HARD', mult: '×1.5' }
};

const store = {
  get() { try { return JSON.parse(sessionStorage.getItem('ns_session')); } catch { return null; } },
  set(v) { try { sessionStorage.setItem('ns_session', JSON.stringify(v)); } catch { /* ignore */ } },
  clear() { try { sessionStorage.removeItem('ns_session'); } catch { /* ignore */ } }
};

const S = {
  me: null, code: null, state: 'lobby', drawerId: null,
  guessed: false, isHost: false, total: 60,
  tool: { color: COLORS[1], size: 8, eraser: false }
};
const isDrawer = () => S.drawerId === S.me;
const canDraw = () => S.state === 'drawing' && isDrawer();

const socket = io({ reconnectionDelayMax: 3000 });

const board = new DrawingBoard($('cv'), {
  canDraw,
  onStroke: s => socket.emit('stroke:add', s),
  onEnd: sid => socket.emit('stroke:end', { sid })
});
const syncLock = () => $('cv').classList.toggle('locked', !canDraw());

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function toast(text, type = 'info', ms = 2600) {
  const box = $('toasts');
  const t = el('div', 'toast ' + type, text);
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}

function setStatus(t) { $('status').textContent = t; }

function setTimer(t, ratio) {
  $('timer').textContent = t;
  $('timer').classList.toggle('low', typeof t === 'number' && t <= 10);
  const f = $('timeFill');
  f.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
  f.className = ratio < 0.2 ? 'danger' : ratio < 0.5 ? 'warn' : '';
}

let ovTimer = 0;
function showOverlay(build) {
  clearInterval(ovTimer);
  const box = $('ovBox');
  box.replaceChildren();
  build(box);
  $('overlay').classList.remove('hidden');
}
function hideOverlay() {
  clearInterval(ovTimer);
  $('overlay').classList.add('hidden');
}
function countdown(node, secs, fn) {
  let n = secs;
  node.textContent = fn(n);
  clearInterval(ovTimer);
  ovTimer = setInterval(() => {
    n = Math.max(0, n - 1);
    node.textContent = fn(n);
    if (n === 0) clearInterval(ovTimer);
  }, 1000);
}

const fx = $('fx');
const fctx = fx.getContext('2d');
let parts = [];
let fxRaf = 0;
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function sizeFx() { fx.width = window.innerWidth; fx.height = window.innerHeight; }
window.addEventListener('resize', sizeFx);
sizeFx();

function confetti(n = 120, power = 1) {
  if (reduceMotion) return;
  const cols = ['#00f0ff', '#ff2bd6', '#b6ff3c', '#ffe600', '#ff8a00', '#a020ff'];
  for (let i = 0; i < n; i++) {
    parts.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * window.innerWidth * 0.4,
      y: window.innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14 * power,
      vy: (Math.random() * -12 - 4) * power,
      r: Math.random() * 5 + 3,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      c: cols[i % cols.length],
      life: 130 + Math.random() * 60
    });
  }
  if (!fxRaf) fxRaf = requestAnimationFrame(loopFx);
}
function loopFx() {
  fctx.clearRect(0, 0, fx.width, fx.height);
  parts = parts.filter(p => p.life > 0 && p.y < fx.height + 30);
  for (const p of parts) {
    p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr; p.life--;
    fctx.save();
    fctx.translate(p.x, p.y);
    fctx.rotate(p.rot);
    fctx.globalAlpha = Math.min(1, p.life / 40);
    fctx.fillStyle = p.c;
    fctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
    fctx.restore();
  }
  if (parts.length) fxRaf = requestAnimationFrame(loopFx);
  else { fxRaf = 0; fctx.clearRect(0, 0, fx.width, fx.height); }
}

['pointerdown', 'touchend', 'keydown'].forEach(t => window.addEventListener(t, unlockAudio, { once: true, passive: true }));
$('btnSound').textContent = isMuted() ? '🔇' : '🔊';
$('btnSound').classList.toggle('off', isMuted());
$('btnSound').onclick = () => {
  setMuted(!isMuted());
  $('btnSound').textContent = isMuted() ? '🔇' : '🔊';
  $('btnSound').classList.toggle('off', isMuted());
  sfx.click();
};

let wasDown = false;
socket.on('connect', () => {
  const ses = store.get();
  if (ses && ses.code && ses.token) socket.emit('room:rejoin', ses);
  if (wasDown) { toast('Reconnected ⚡', 'good'); wasDown = false; }
});
socket.on('disconnect', () => {
  wasDown = true;
  toast('Connection lost — reconnecting…', 'warn', 4000);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !socket.connected) socket.connect();
});
socket.on('room:rejoinFailed', () => {
  store.clear();
  resetLocal();
  show('home');
});
socket.on('room:kicked', () => {
  store.clear();
  resetLocal();
  show('home');
  toast('This account is open in another tab', 'warn');
});

function resetLocal() {
  S.code = null; S.me = null; S.state = 'lobby'; S.drawerId = null; S.guessed = false;
  hideOverlay();
  board.reset();
  $('msgs').replaceChildren();
  $('tools').classList.add('hidden');
  syncLock();
}

try { $('name').value = localStorage.getItem('ns_name') || ''; } catch { /* ignore */ }
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom && /^\d{4}$/.test(qRoom)) $('code').value = qRoom;

function showErr(t) {
  $('homeErr').textContent = t || '';
  $('lobbyErr').textContent = t || '';
  if (t) toast(t, 'error', 3000);
}
function saveName(n) { try { localStorage.setItem('ns_name', n); } catch { /* ignore */ } }

$('btnCreate').onclick = () => {
  sfx.click();
  const n = $('name').value.trim();
  if (!n) return showErr('Please enter your name first');
  saveName(n);
  socket.emit('room:create', n);
};
$('btnJoin').onclick = () => {
  sfx.click();
  const n = $('name').value.trim();
  const c = $('code').value.trim();
  if (!n) return showErr('Please enter your name first');
  if (!/^\d{4}$/.test(c)) return showErr('Enter a 4-digit code');
  saveName(n);
  socket.emit('room:join', { code: c, name: n });
};
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') $('code').focus(); });
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
$('code').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
socket.on('room:error', showErr);

socket.on('room:joined', d => {
  showErr('');
  S.me = d.you;
  S.code = d.code;
  S.state = d.state;
  store.set({ code: d.code, token: d.token });
  $('roomCode').textContent = d.code;
  hideOverlay();
  if (d.state === 'lobby') { show('lobby'); sfx.join(); } else show('game');
});

$('btnCopy').onclick = async () => {
  const link = `${location.origin}/?room=${S.code}`;
  try { await navigator.clipboard.writeText(link); toast('Invite link copied ✅', 'good'); }
  catch { toast(`Code: ${S.code}`, 'info'); }
};
$('btnStart').onclick = () => {
  sfx.click();
  socket.emit('game:start', { rounds: +$('setRounds').value, time: +$('setTime').value });
};

function leaveRoom() {
  if (!confirm('Leave the room?')) return;
  socket.emit('room:leave');
  store.clear();
  resetLocal();
  show('home');
}
$('btnLeave').onclick = leaveRoom;
$('btnLeaveLobby').onclick = leaveRoom;

function renderPlayers(ul, list, ranked) {
  const frag = document.createDocumentFragment();
  list.forEach((p, i) => {
    const li = el('li');
    if (p.id === S.me) li.classList.add('me');
    if (p.isDrawer) li.classList.add('drawer');
    if (p.guessed) li.classList.add('guessed');
    if (!p.connected) li.classList.add('offline');
    if (ranked) li.appendChild(el('span', 'rank', MEDALS[i] || '#' + (i + 1)));
    li.appendChild(el('span', 'nm', p.name));
    const badges = (p.isHost ? '👑' : '') + (p.isDrawer ? '✏️' : '') + (p.guessed ? '✅' : '') + (!p.connected ? '📡' : '');
    if (badges) li.appendChild(el('span', 'badges', badges));
    li.appendChild(el('span', 'sc', String(p.score)));
    frag.appendChild(li);
  });
  ul.replaceChildren(frag);
}

socket.on('players', list => {
  const me = list.find(p => p.id === S.me);
  S.isHost = !!(me && me.isHost);
  renderPlayers($('lobbyPlayers'), list, false);
  renderPlayers($('board'), list, true);
  $('hostBox').classList.toggle('hidden', !S.isHost);
  $('waitMsg').classList.toggle('hidden', S.isHost);
});

socket.on('game:started', () => toast('Game started! 🎮', 'good'));

socket.on('game:turn', d => {
  S.state = 'choosing';
  S.drawerId = d.drawerId;
  S.guessed = false;
  show('game');
  hideOverlay();
  board.reset();
  $('roundInfo').textContent = `ROUND ${d.round}/${d.totalRounds}`;
  $('wordBox').textContent = '…';
  $('wordMeta').textContent = '';
  setTimer('--', 1);
  $('tools').classList.add('hidden');
  setStatus(isDrawer() ? '✏️ Your turn! Pick a word…' : `${d.drawerName} is picking a word…`);
  syncLock();
  sfx.turn();
});

function showChoices(list) {
  showOverlay(box => {
    box.appendChild(el('h2', null, '🎯 CHOOSE A WORD'));
    list.forEach(({ word, diff }) => {
      const b = el('button', 'choice ' + diff);
      b.appendChild(el('span', 'cw', word.toUpperCase()));
      b.appendChild(el('span', 'cd', `${DIFF[diff].label} ${DIFF[diff].mult}`));
      b.onclick = () => { sfx.click(); socket.emit('word:choose', word); hideOverlay(); };
      box.appendChild(b);
    });
    const note = el('p', 'muted');
    box.appendChild(note);
    countdown(note, 15, n => `⏳ Auto-select in ${n}s`);
  });
}
socket.on('word:choices', showChoices);

socket.on('game:drawing', d => {
  S.state = 'drawing';
  S.total = d.time;
  hideOverlay();
  $('wordBox').textContent = fmtWord(d.hint);
  $('wordMeta').textContent = isDrawer()
    ? `${DIFF[d.diff].label} ${DIFF[d.diff].mult}`
    : `${d.hint.replace(/ /g, '').length} LETTERS`;
  setTimer(d.time, 1);
  $('tools').classList.toggle('hidden', !isDrawer());
  setStatus(isDrawer() ? '🎨 Draw this!' : '💬 Guess it — type in the chat below');
  syncLock();
  sfx.start();
});

socket.on('game:tick', t => {
  setTimer(t, t / S.total);
  if (t <= 10 && t > 0) sfx.tick(t % 2);
});

socket.on('game:hint', hint => {
  if (!S.guessed && !isDrawer()) $('wordBox').textContent = fmtWord(hint);
});

socket.on('guess:correct', d => {
  S.guessed = true;
  $('wordBox').textContent = fmtWord(d.word);
  setStatus(`✅ Correct! +${d.points} points`);
  toast(`Correct answer! +${d.points}`, 'good');
  sfx.correct();
  confetti(60, 0.7);
  if (navigator.vibrate) navigator.vibrate(60);
});

socket.on('chat:close', () => {
  toast('Very close! 🔥', 'warn', 1800);
  sfx.close();
});

socket.on('game:turnEnd', d => {
  S.state = 'turn_end';
  $('tools').classList.add('hidden');
  syncLock();
  sfx.roundEnd();
  showOverlay(box => {
    box.appendChild(el('h2', null, d.reason));
    box.appendChild(el('p', 'muted', 'THE WORD WAS'));
    box.appendChild(el('div', 'big', d.word.toUpperCase()));
    const list = d.gains.filter(g => g.gain > 0);
    if (!list.length) box.appendChild(el('p', 'muted', 'Nobody guessed it 😅'));
    list.forEach(g => {
      const row = el('div', 'gain');
      row.appendChild(el('span', null, g.name));
      row.appendChild(el('span', 'g', '+' + g.gain));
      box.appendChild(row);
    });
    const n = el('p', 'muted');
    box.appendChild(n);
    countdown(n, d.nextIn, s => `⏳ Next turn in ${s}s…`);
  });
});

socket.on('game:over', d => {
  S.state = 'lobby';
  S.drawerId = null;
  $('tools').classList.add('hidden');
  syncLock();
  sfx.fanfare();
  confetti(240, 1.25);
  showOverlay(box => {
    box.appendChild(el('h2', null, '🏆 GAME OVER'));
    const top = d.players.slice(0, 3);
    const order = top.length === 3 ? [1, 0, 2] : top.map((_, i) => i);
    const pod = el('div', 'podium');
    order.forEach(i => {
      const p = top[i];
      const col = el('div', 'pcol p' + (i + 1));
      col.appendChild(el('div', 'pmedal', MEDALS[i]));
      col.appendChild(el('div', 'pname', p.name));
      col.appendChild(el('div', 'pscore', String(p.score)));
      col.appendChild(el('div', 'pbar'));
      pod.appendChild(col);
    });
    box.appendChild(pod);
    d.players.slice(3).forEach((p, i) => {
      const row = el('div', 'gain');
      row.appendChild(el('span', null, `#${i + 4} ${p.name}`));
      row.appendChild(el('span', 'g', String(p.score)));
      box.appendChild(row);
    });
    const b = el('button', 'btn btn-primary', 'BACK TO LOBBY');
    b.onclick = () => { sfx.click(); hideOverlay(); show('lobby'); };
    box.appendChild(b);
  });
});

socket.on('sync', d => {
  S.state = d.state;
  S.drawerId = d.drawerId;
  S.guessed = !!d.guessed;
  S.total = d.time;
  show('game');
  hideOverlay();
  $('roundInfo').textContent = `ROUND ${d.round}/${d.totalRounds}`;
  board.setStrokes(d.strokes || []);
  $('tools').classList.toggle('hidden', !(d.state === 'drawing' && isDrawer()));
  $('wordMeta').textContent = '';
  if (d.state === 'drawing') {
    $('wordBox').textContent = fmtWord(d.hint);
    setTimer(d.timeLeft, d.timeLeft / d.time);
    setStatus(isDrawer() ? '🎨 Draw!' : S.guessed ? '✅ You guessed it!' : '👋 Joined mid-game — start guessing!');
  } else if (d.state === 'choosing') {
    $('wordBox').textContent = '…';
    setTimer('--', 1);
    setStatus(isDrawer() ? '✏️ Pick a word…' : `${d.drawerName} is picking a word…`);
    if (isDrawer() && d.choices) showChoices(d.choices);
  } else {
    $('wordBox').textContent = '…';
    setTimer('--', 1);
    setStatus('⏳ Wait for the next turn…');
  }
  syncLock();
});

socket.on('stroke:add', s => board.remoteAdd(s));
socket.on('stroke:end', d => board.remoteEnd(d.sid));
socket.on('canvas:set', d => board.setStrokes(d.strokes || []));

function updateBrushDot() {
  const dot = $('brushDot');
  const px = Math.max(6, Math.min(30, S.tool.size));
  dot.style.width = px + 'px';
  dot.style.height = px + 'px';
  dot.style.background = S.tool.eraser ? '#0b0a1a' : S.tool.color;
  dot.style.color = S.tool.color;
  dot.style.border = S.tool.eraser ? '1px dashed #8f8bbd' : '0';
}
function applyTool() {
  board.setTool({ color: S.tool.color, size: S.tool.size, eraser: S.tool.eraser });
  updateBrushDot();
}

COLORS.forEach((c, i) => {
  const d = el('div', 'sw' + (i === 1 ? ' on' : ''));
  d.style.background = c;
  d.style.color = c;
  d.onclick = () => {
    S.tool.color = c;
    S.tool.eraser = false;
    $('btnEraser').classList.remove('active');
    document.querySelectorAll('.sw').forEach(x => x.classList.remove('on'));
    d.classList.add('on');
    applyTool();
    sfx.click();
  };
  $('swatches').appendChild(d);
});
$('size').addEventListener('input', e => { S.tool.size = +e.target.value; applyTool(); });
$('btnEraser').onclick = () => {
  S.tool.eraser = !S.tool.eraser;
  $('btnEraser').classList.toggle('active', S.tool.eraser);
  applyTool();
  sfx.click();
};
$('btnUndo').onclick = () => { socket.emit('undo'); sfx.click(); };
$('btnRedo').onclick = () => { socket.emit('redo'); sfx.click(); };
$('btnClear').onclick = () => { socket.emit('clear'); sfx.click(); };
applyTool();

window.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || !canDraw()) return;
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); socket.emit('undo'); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); socket.emit('redo'); }
});

function addMsg(text, cls, name) {
  const box = $('msgs');
  const m = el('div', 'msg ' + (cls || ''));
  if (name) m.appendChild(el('b', null, name + ': '));
  m.appendChild(document.createTextNode(text));
  box.appendChild(m);
  while (box.children.length > 120) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
socket.on('chat', d => {
  addMsg(d.text, d.private ? 'private' : '', d.name + (d.private ? ' 🔒' : ''));
  sfx.msg();
});
socket.on('system', d => {
  addMsg(d.text, d.type === 'good' ? 'good' : d.type === 'warn' ? 'warn' : 'sys');
  if (d.type === 'warn') sfx.close();
});
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('chatIn').value.trim();
  if (!v) return;
  socket.emit('chat', v);
  $('chatIn').value = '';
});