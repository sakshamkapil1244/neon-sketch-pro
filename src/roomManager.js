'use strict';
const crypto = require('crypto');

const MAX_ROOMS = 5000;

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  get(code) {
    return this.rooms.get(String(code || ''));
  }

  _newCode() {
    let code;
    do { code = String(crypto.randomInt(1000, 10000)); } while (this.rooms.has(code));
    return code;
  }

  create() {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const code = this._newCode();
    const room = {
      code,
      hostId: null,
      players: new Map(),
      state: 'lobby',
      settings: { rounds: 3, drawTime: 60 },
      round: 0,
      order: [],
      idx: -1,
      drawerId: null,
      word: null,
      diff: 'easy',
      choices: [],
      hintArr: [],
      usedWords: new Set(),
      timeLeft: 0,
      guessedCount: 0,
      strokes: [],
      redo: [],
      ptsTotal: 0,
      timers: { tick: null, choose: null, next: null }
    };
    this.rooms.set(code, room);
    return room;
  }

  addPlayer(room, name) {
    const player = {
      id: crypto.randomUUID(),
      socketId: null,
      name,
      score: 0,
      guessed: false,
      streak: 0,
      gain: 0,
      connected: false,
      leaveTimer: null
    };
    room.players.set(player.id, player);
    return player;
  }

  delete(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    clearInterval(room.timers.tick);
    clearTimeout(room.timers.choose);
    clearTimeout(room.timers.next);
    room.players.forEach(p => clearTimeout(p.leaveTimer));
    this.rooms.delete(code);
  }
}

module.exports = RoomManager;