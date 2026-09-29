const W = 1200;
const H = 750;
export const BG = '#0b0a1a';

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const r4 = v => Math.round(v * 10000) / 10000;

export class DrawingBoard {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.tool = { color: '#00f0ff', size: 8, eraser: false };
    this.active = null;
    this.live = new Map();
    this.pending = [];
    this.raf = 0;
    this.rect = null;
    this.pid = null;
    this.tid = null;
    this._n = 0;
    this.clear();
    this._bind();
  }

  setTool(t) { Object.assign(this.tool, t); }

  clear() {
    this.ctx.fillStyle = BG;
    this.ctx.fillRect(0, 0, W, H);
    this.live.clear();
  }

  reset() {
    this._cancelActive();
    this.clear();
  }

  setStrokes(list) {
    this._cancelActive();
    this.clear();
    for (const s of list) this._renderFull(s);
  }

  remoteAdd({ sid, c, w, pts }) {
    let s = this.live.get(sid);
    if (!s) {
      s = { sid, c, w, pts: [], drawn: 0 };
      this.live.set(sid, s);
      if (this.live.size > 6) this.live.delete(this.live.keys().next().value);
    }
    for (const p of pts) s.pts.push(p);
    this._advance(s);
  }

  remoteEnd(sid) {
    const s = this.live.get(sid);
    if (!s) return;
    this._tail(s);
    this.live.delete(sid);
  }

  _style(s) {
    const c = this.ctx;
    c.strokeStyle = s.c;
    c.fillStyle = s.c;
    c.lineWidth = s.w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }

  _advance(s) {
    const pts = s.pts;
    const c = this.ctx;
    this._style(s);
    for (let i = s.drawn; i < pts.length; i++) {
      if (i === 0) {
        c.beginPath();
        c.arc(pts[0][0] * W, pts[0][1] * H, s.w / 2, 0, Math.PI * 2);
        c.fill();
        continue;
      }
      const m1 = i === 1 ? pts[0] : mid(pts[i - 2], pts[i - 1]);
      const m2 = mid(pts[i - 1], pts[i]);
      c.beginPath();
      c.moveTo(m1[0] * W, m1[1] * H);
      if (i === 1) c.lineTo(m2[0] * W, m2[1] * H);
      else c.quadraticCurveTo(pts[i - 1][0] * W, pts[i - 1][1] * H, m2[0] * W, m2[1] * H);
      c.stroke();
    }
    s.drawn = pts.length;
  }

  _tail(s) {
    const n = s.pts.length;
    if (n < 2) return;
    const c = this.ctx;
    const m = mid(s.pts[n - 2], s.pts[n - 1]);
    const last = s.pts[n - 1];
    this._style(s);
    c.beginPath();
    c.moveTo(m[0] * W, m[1] * H);
    c.lineTo(last[0] * W, last[1] * H);
    c.stroke();
  }

  _renderFull(s) {
    const t = { c: s.c, w: s.w, pts: s.pts, drawn: 0 };
    this._advance(t);
    this._tail(t);
  }

  _xy(e) {
    const r = this.rect || this.canvas.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    ];
  }

  _sid() {
    this._n++;
    return Date.now().toString(36) + this._n.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  _down(e) {
    if (this.active || !this.hooks.canDraw()) return false;
    this.rect = this.canvas.getBoundingClientRect();
    const t = this.tool;
    this.active = {
      sid: this._sid(),
      c: t.eraser ? BG : t.color,
      w: t.eraser ? t.size * 2.2 : t.size,
      pts: [],
      drawn: 0
    };
    this._add(this._xy(e));
    this._advance(this.active);
    this._schedule();
    return true;
  }

  _add(p) {
    const s = this.active;
    const last = s.pts[s.pts.length - 1];
    if (last && Math.abs(p[0] - last[0]) * W < 1.5 && Math.abs(p[1] - last[1]) * H < 1.5) return;
    s.pts.push(p);
    this.pending.push([r4(p[0]), r4(p[1])]);
  }

  _moveEv(e) {
    if (!this.active) return;
    if (!this.hooks.canDraw()) return this._up();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    for (const ev of (list && list.length ? list : [e])) this._add(this._xy(ev));
    this._advance(this.active);
    this._schedule();
  }

  _up() {
    const s = this.active;
    if (!s) return;
    this._advance(s);
    this._tail(s);
    this._flush();
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.active = null;
    this.rect = null;
    this.pid = null;
    this.tid = null;
    this.hooks.onEnd(s.sid);
  }

  _cancelActive() {
    this.active = null;
    this.pending = [];
    this.rect = null;
    this.pid = null;
    this.tid = null;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  _schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this._flush(); });
  }

  _flush() {
    const s = this.active;
    if (!s || !this.pending.length) return;
    const all = this.pending;
    this.pending = [];
    for (let i = 0; i < all.length; i += 60) {
      this.hooks.onStroke({ sid: s.sid, c: s.c, w: s.w, pts: all.slice(i, i + 60) });
    }
  }

  _bind() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());

    if (window.PointerEvent) {
      cv.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (this._down(e)) {
          this.pid = e.pointerId;
          e.preventDefault();
          try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }
      });
      cv.addEventListener('pointermove', e => {
        if (!this.active || e.pointerId !== this.pid) return;
        e.preventDefault();
        this._moveEv(e);
      });
      const end = e => { if (!e || e.pointerId === undefined || e.pointerId === this.pid) this._up(); };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('lostpointercapture', end);
    } else {
      const opt = { passive: false };
      cv.addEventListener('touchstart', e => {
        if (this.active) return;
        const t = e.changedTouches[0];
        if (this._down(t)) { this.tid = t.identifier; e.preventDefault(); }
      }, opt);
      cv.addEventListener('touchmove', e => {
        if (!this.active) return;
        e.preventDefault();
        for (const t of e.changedTouches) if (t.identifier === this.tid) this._moveEv(t);
      }, opt);
      const tend = e => { if (this.active) { e.preventDefault(); this._up(); } };
      cv.addEventListener('touchend', tend, opt);
      cv.addEventListener('touchcancel', tend, opt);
      cv.addEventListener('mousedown', e => { if (e.button === 0 && this._down(e)) e.preventDefault(); });
      window.addEventListener('mousemove', e => { if (this.active) this._moveEv(e); });
      window.addEventListener('mouseup', () => this._up());
    }
  }
}