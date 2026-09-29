'use strict';
const { pickChoices, MULTIPLIER } = require('./wordBank');

const L = {
  MAX_PLAYERS: 10,
  MIN_PLAYERS: 2,
  CHOOSE_MS: 15000,
  TURN_END_MS: 6000,
  GRACE_MS: 30000,
  MAX_STROKES: 400,
  MAX_PTS_STROKE: 3000,
  MAX_PTS_TOTAL: 50000
};

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r4 = v => Math.round(v * 10000) / 10000;
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

class GameEngine {
  constructor(io, rooms) {
    this.io = io;
    this.rooms = rooms;
  }

  ctx(socket) {
    const room = this.rooms.get(socket.data.code);
    const player = room && room.players.get(socket.data.pid);
    return player && player.socketId === socket.id ? { room, player } : {};
  }

  drawerCtx(socket) {
    const c = this.ctx(socket);
    return c.room && c.room.state === 'drawing' && c.room.drawerId === c.player.id ? c : {};
  }

  send(player, ev, data) {
    if (player && player.socketId) this.io.to(player.socketId).emit(ev, data);
  }
  broadcast(room, ev, data) { this.io.to(room.code).emit(ev, data); }
  system(room, text, type = 'info') { this.broadcast(room, 'system', { text, type }); }
  err(socket, msg) { socket.emit('room:error', msg); }

  cleanName(raw) {
    return String(raw || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  }
  uniqueName(room, name) {
    const names = new Set([...room.players.values()].map(p => p.name.toLowerCase()));
    if (!names.has(name.toLowerCase())) return name;
    for (let i = 2; i < 100; i++) {
      const n = `${name.slice(0, 11)} ${i}`;
      if (!names.has(n.toLowerCase())) return n;
    }
    return name;
  }

  publicPlayers(room) {
    return [...room.players.values()]
      .map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        guessed: p.guessed,
        connected: p.connected,
        isHost: p.id === room.hostId,
        isDrawer: room.state !== 'lobby' && p.id === room.drawerId
      }))
      .sort((a, b) => b.score - a.score);
  }
  pushPlayers(room) { this.broadcast(room, 'players', this.publicPlayers(room)); }

  stopTimers(room) {
    clearInterval(room.timers.tick);
    clearTimeout(room.timers.choose);
    clearTimeout(room.timers.next);
  }

  bind(room, socket, player) {
    clearTimeout(player.leaveTimer);
    player.leaveTimer = null;
    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.pid = player.id;
  }

  snapshot(room, player) {
    const isDrawer = player.id === room.drawerId;
    const drawer = room.players.get(room.drawerId);
    let hint = '';
    if (room.state === 'drawing') hint = (isDrawer || player.guessed) ? room.word : room.hintArr.join('');
    return {
      state: room.state,
      drawerId: room.drawerId,
      drawerName: drawer ? drawer.name : '',
      round: room.round,
      totalRounds: room.settings.rounds,
      hint,
      timeLeft: room.timeLeft,
      time: room.settings.drawTime,
      guessed: player.guessed,
      choices: room.state === 'choosing' && isDrawer ? room.choices : null,
      strokes: room.strokes
    };
  }

  welcome(room, player) {
    this.send(player, 'room:joined', {
      code: room.code, you: player.id, token: player.id,
      settings: room.settings, state: room.state
    });
    this.pushPlayers(room);
    if (room.state !== 'lobby') this.send(player, 'sync', this.snapshot(room, player));
  }

  createRoom(socket, rawName) {
    const name = this.cleanName(rawName);
    if (!name) return this.err(socket, 'Please enter your name first');
    this.leave(socket);
    const room = this.rooms.create();
    if (!room) return this.err(socket, 'Server is busy, try again in a moment');
    const player = this.rooms.addPlayer(room, name);
    room.hostId = player.id;
    this.bind(room, socket, player);
    this.welcome(room, player);
  }

  joinRoom(socket, payload) {
    const { code, name } = payload || {};
    const clean = this.cleanName(name);
    if (!clean) return this.err(socket, 'Please enter your name first');
    const room = this.rooms.get(code);
    if (!room) return this.err(socket, 'Room not found. Check the code.');
    if (room.players.size >= L.MAX_PLAYERS) return this.err(socket, 'Room is full (max 10).');
    this.leave(socket);
    const player = this.rooms.addPlayer(room, this.uniqueName(room, clean));
    this.bind(room, socket, player);
    this.welcome(room, player);
    this.system(room, `${player.name} joined the room 👋`);
  }

  rejoin(socket, payload) {
    const { code, token } = payload || {};
    const room = this.rooms.get(code);
    const player = room && room.players.get(String(token || ''));
    if (!player) return socket.emit('room:rejoinFailed');

    if (player.socketId && player.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(player.socketId);
      if (old) {
        old.leave(room.code);
        old.data.code = null;
        old.data.pid = null;
        old.emit('room:kicked');
      }
    }
    this.bind(room, socket, player);
    this.welcome(room, player);
    this.system(room, `${player.name} rejoined ⚡`);
  }

  leave(socket) {
    const { room, player } = this.ctx(socket);
    if (room) this.removePlayer(room, player.id);
    socket.data.code = null;
    socket.data.pid = null;
  }

  disconnect(socket) {
    const { room, player } = this.ctx(socket);
    if (!room) return;
    player.connected = false;
    player.socketId = null;
    if (room.hostId === player.id) this.migrateHost(room);
    this.pushPlayers(room);
    player.leaveTimer = setTimeout(() => this.removePlayer(room, player.id), L.GRACE_MS);
    this.checkAllGuessed(room);
  }

  migrateHost(room) {
    const list = [...room.players.values()];
    const next = list.find(p => p.connected) || list[0];
    if (!next || next.id === room.hostId) return;
    room.hostId = next.id;
    this.system(room, `👑 ${next.name} is now host`);
  }

  removePlayer(room, pid) {
    const p = room.players.get(pid);
    if (!p) return;
    clearTimeout(p.leaveTimer);
    room.players.delete(pid);

    const s = p.socketId && this.io.sockets.sockets.get(p.socketId);
    if (s) { s.leave(room.code); s.data.code = null; s.data.pid = null; }

    if (room.players.size === 0) return this.rooms.delete(room.code);

    if (room.hostId === pid) this.migrateHost(room);
    this.system(room, `${p.name} left the room 👋`);

    if (room.state !== 'lobby' && room.players.size < L.MIN_PLAYERS) {
      this.pushPlayers(room);
      return this.endGame(room);
    }
    if (room.drawerId === pid && room.state === 'drawing') {
      this.endTurn(room, 'Drawer left 😢');
    } else if (room.drawerId === pid && room.state === 'choosing') {
      this.nextTurn(room);
    } else {
      this.checkAllGuessed(room);
    }
    this.pushPlayers(room);
  }

  startGame(socket, payload) {
    const { room, player } = this.ctx(socket);
    if (!room || room.hostId !== player.id || room.state !== 'lobby') return;
    if (room.players.size < L.MIN_PLAYERS) return this.err(socket, 'At least 2 players required.');
    const { rounds, time } = payload || {};
    room.settings.rounds = clamp(parseInt(rounds, 10) || 3, 1, 10);
    room.settings.drawTime = clamp(parseInt(time, 10) || 60, 30, 180);
    room.round = 1;
    room.idx = -1;
    room.order = [...room.players.keys()];
    room.usedWords = new Set();
    room.players.forEach(p => { p.score = 0; p.streak = 0; p.guessed = false; p.gain = 0; });
    this.broadcast(room, 'game:started', { settings: room.settings });
    this.pushPlayers(room);
    this.nextTurn(room);
  }

  nextTurn(room) {
    this.stopTimers(room);
    room.idx++;
    for (;;) {
      if (room.idx >= room.order.length) {
        room.round++;
        room.idx = 0;
        room.order = [...room.players.keys()];
      }
      if (room.round > room.settings.rounds) return this.endGame(room);
      if (room.players.has(room.order[room.idx])) break;
      room.idx++;
    }

    const drawer = room.players.get(room.order[room.idx]);
    room.drawerId = drawer.id;
    room.state = 'choosing';
    room.word = null;
    room.strokes = [];
    room.redo = [];
    room.ptsTotal = 0;
    room.guessedCount = 0;
    room.players.forEach(p => { p.guessed = false; p.gain = 0; });
    room.choices = pickChoices(room.usedWords);

    this.broadcast(room, 'game:turn', {
      drawerId: drawer.id,
      drawerName: drawer.name,
      round: room.round,
      totalRounds: room.settings.rounds
    });
    this.pushPlayers(room);
    this.send(drawer, 'word:choices', room.choices);

    room.timers.choose = setTimeout(() => {
      if (room.state === 'choosing') this.beginDrawing(room, room.choices[1]);
    }, L.CHOOSE_MS);
  }

  chooseWord(socket, word) {
    const { room, player } = this.ctx(socket);
    if (!room || room.state !== 'choosing' || room.drawerId !== player.id) return;
    const choice = room.choices.find(c => c.word === word);
    if (choice) this.beginDrawing(room, choice);
  }

  beginDrawing(room, choice) {
    if (room.state !== 'choosing') return;
    clearTimeout(room.timers.choose);
    room.state = 'drawing';
    room.word = choice.word;
    room.diff = choice.diff;
    room.usedWords.add(choice.word);
    room.hintArr = [...choice.word].map(c => (c === ' ' ? ' ' : '_'));
    const total = room.settings.drawTime;
    room.timeLeft = total;

    room.players.forEach(p => {
      this.send(p, 'game:drawing', {
        hint: p.id === room.drawerId ? room.word : room.hintArr.join(''),
        time: total,
        diff: room.diff
      });
    });

    const letters = choice.word.replace(/ /g, '').length;
    const marks = (letters >= 8 ? [0.6, 0.4, 0.2] : [0.5, 0.25]).map(r => Math.floor(total * r));

    room.timers.tick = setInterval(() => {
      room.timeLeft--;
      this.broadcast(room, 'game:tick', room.timeLeft);
      if (marks.includes(room.timeLeft)) this.revealLetter(room);
      if (room.timeLeft <= 0) this.endTurn(room, '⏰ Time up!');
    }, 1000);
  }

  revealLetter(room) {
    const hidden = [];
    room.hintArr.forEach((c, i) => { if (c === '_') hidden.push(i); });
    if (hidden.length <= 2) return;
    const i = hidden[Math.floor(Math.random() * hidden.length)];
    room.hintArr[i] = room.word[i];
    const hint = room.hintArr.join('');
    room.players.forEach(p => {
      if (p.id !== room.drawerId && !p.guessed) this.send(p, 'game:hint', hint);
    });
  }

  checkAllGuessed(room) {
    if (room.state !== 'drawing') return;
    const guessers = [...room.players.values()].filter(p => p.id !== room.drawerId && p.connected);
    if (guessers.length && guessers.every(p => p.guessed)) {
      const d = room.players.get(room.drawerId);
      if (d) { d.score += 50; d.gain += 50; }
      this.endTurn(room, 'Everyone guessed it! 🎉');
    }
  }

  endTurn(room, reason) {
    if (room.state !== 'drawing') return;
    this.stopTimers(room);
    room.state = 'turn_end';
    room.players.forEach(p => { if (p.id !== room.drawerId && !p.guessed) p.streak = 0; });
    const gains = [...room.players.values()]
      .map(p => ({ id: p.id, name: p.name, gain: p.gain }))
      .sort((a, b) => b.gain - a.gain);
    this.broadcast(room, 'game:turnEnd', {
      word: room.word, reason, gains, nextIn: L.TURN_END_MS / 1000
    });
    this.pushPlayers(room);
    room.timers.next = setTimeout(() => this.nextTurn(room), L.TURN_END_MS);
  }

  endGame(room) {
    this.stopTimers(room);
    room.state = 'lobby';
    room.drawerId = null;
    room.word = null;
    room.strokes = [];
    room.redo = [];
    room.ptsTotal = 0;
    room.players.forEach(p => { p.guessed = false; });
    this.broadcast(room, 'game:over', { players: this.publicPlayers(room) });
    this.pushPlayers(room);
  }

  chat(socket, raw) {
    const { room, player } = this.ctx(socket);
    if (!room) return;
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text) return;

    if (room.state === 'drawing') {
      const g = norm(text);
      const w = norm(room.word);

      if (player.id === room.drawerId) {
        if (g.includes(w)) {
          return this.send(player, 'system', { text: '	Drawer cannot reveal the answer! 🚫', type: 'warn' });
        }
        return this.broadcast(room, 'chat', { name: player.name, text });
      }

      if (player.guessed) {
        room.players.forEach(q => {
          if (q.guessed || q.id === room.drawerId) {
            this.send(q, 'chat', { name: player.name, text, private: true });
          }
        });
        return;
      }

      if (g && g === w) return this.correctGuess(room, player);

      const maxDist = w.length >= 8 ? 2 : 1;
      if (g && w.length > 3 && lev(g, w) <= maxDist) {
        this.send(player, 'chat:close');
      }
    }
    this.broadcast(room, 'chat', { name: player.name, text });
  }

  correctGuess(room, player) {
    const total = room.settings.drawTime;
    player.streak = (player.streak || 0) + 1;
    let pts = 100 + Math.round((room.timeLeft / total) * 300);
    pts = Math.round(pts * (MULTIPLIER[room.diff] || 1));
    if (room.guessedCount === 0) pts += 50;
    pts += Math.min(player.streak - 1, 5) * 10;
    player.score += pts;
    player.gain += pts;
    player.guessed = true;
    room.guessedCount++;

    const d = room.players.get(room.drawerId);
    if (d) { d.score += 40; d.gain += 40; }

    this.send(player, 'guess:correct', { word: room.word, points: pts });
    this.system(room, `${player.name} guessed correctly! ✅ (+${pts})`, 'good');
    this.pushPlayers(room);
    this.checkAllGuessed(room);
  }

  addStroke(socket, data) {
    const { room } = this.drawerCtx(socket);
    if (!room || !data || !Array.isArray(data.pts)) return;
    const sid = String(data.sid || '').slice(0, 40);
    if (!sid) return;

    const pts = [];
    for (const p of data.pts.slice(0, 64)) {
      if (!Array.isArray(p)) continue;
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([r4(clamp(x, 0, 1)), r4(clamp(y, 0, 1))]);
    }
    if (!pts.length) return;

    let cur = room.strokes[room.strokes.length - 1];
    if (!cur || cur.sid !== sid) {
      if (room.strokes.length >= L.MAX_STROKES) return;
      cur = {
        sid,
        c: COLOR_RE.test(data.c) ? data.c : '#ffffff',
        w: clamp(Number(data.w) || 6, 1, 100),
        pts: []
      };
      room.strokes.push(cur);
      room.redo = [];
    }
    if (cur.pts.length + pts.length > L.MAX_PTS_STROKE) return;
    if (room.ptsTotal + pts.length > L.MAX_PTS_TOTAL) return;

    for (const p of pts) cur.pts.push(p);
    room.ptsTotal += pts.length;
    socket.to(room.code).emit('stroke:add', { sid, c: cur.c, w: cur.w, pts });
  }

  endStroke(socket, data) {
    const { room } = this.drawerCtx(socket);
    if (!room || !data) return;
    socket.to(room.code).emit('stroke:end', { sid: String(data.sid || '').slice(0, 40) });
  }

  recount(room) {
    room.ptsTotal = room.strokes.reduce((a, s) => a + s.pts.length, 0);
    this.broadcast(room, 'canvas:set', { strokes: room.strokes });
  }

  undo(socket) {
    const { room } = this.drawerCtx(socket);
    if (!room || !room.strokes.length) return;
    room.redo.push(room.strokes.pop());
    this.recount(room);
  }

  redo(socket) {
    const { room } = this.drawerCtx(socket);
    if (!room || !room.redo.length) return;
    room.strokes.push(room.redo.pop());
    this.recount(room);
  }

  clear(socket) {
    const { room } = this.drawerCtx(socket);
    if (!room) return;
    room.strokes = [];
    room.redo = [];
    this.recount(room);
  }
}

module.exports = GameEngine;