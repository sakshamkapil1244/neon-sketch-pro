'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const RoomManager = require('./src/roomManager');
const GameEngine = require('./src/gameEngine');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; " +
    "connect-src 'self' ws: wss:"
  );
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0 }));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingInterval: 10000,
  pingTimeout: 20000,
  perMessageDeflate: { threshold: 1024 }
});

const rooms = new RoomManager();
const engine = new GameEngine(io, rooms);

app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.rooms.size, uptime: process.uptime() }));

/* Rate limiter */
function allow(socket, key, max, windowMs) {
  const now = Date.now();
  const rl = socket.data.rl || (socket.data.rl = {});
  const b = rl[key];
  if (!b || now - b.start > windowMs) { rl[key] = { start: now, n: 1 }; return true; }
  b.n++;
  return b.n <= max;
}

io.on('connection', socket => {
  const on = (event, key, max, windowMs, fn) => {
    socket.on(event, (...args) => {
      if (!allow(socket, key, max, windowMs)) return;
      try { fn(...args); } catch (err) { console.error(`[${event}]`, err); }
    });
  };

  on('room:create', 'room', 10, 10000, name => engine.createRoom(socket, name));
  on('room:join', 'room', 10, 10000, p => engine.joinRoom(socket, p));
  on('room:rejoin', 'room', 10, 10000, p => engine.rejoin(socket, p));
  on('room:leave', 'room', 10, 10000, () => engine.leave(socket));

  on('game:start', 'ctl', 10, 5000, p => engine.startGame(socket, p));
  on('word:choose', 'ctl', 10, 5000, w => engine.chooseWord(socket, w));

  on('stroke:add', 'draw', 180, 1000, d => engine.addStroke(socket, d));
  on('stroke:end', 'draw', 180, 1000, d => engine.endStroke(socket, d));
  on('undo', 'edit', 20, 3000, () => engine.undo(socket));
  on('redo', 'edit', 20, 3000, () => engine.redo(socket));
  on('clear', 'edit', 20, 3000, () => engine.clear(socket));

  on('chat', 'chat', 6, 4000, t => engine.chat(socket, t));

  socket.on('disconnect', () => {
    try { engine.disconnect(socket); } catch (err) { console.error('[disconnect]', err); }
  });
});

process.on('unhandledRejection', err => console.error('unhandledRejection', err));
process.on('uncaughtException', err => console.error('uncaughtException', err));

function shutdown() {
  console.log('Shutting down...');
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`🎨 NEON SKETCH PRO live: http://localhost:${PORT}`));