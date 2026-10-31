(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

/* =====================================================================================
   SonicPulseNebula — Audio-Reactive Outward Sparks & Shockwaves
   New class; does not replace CyberOvoidVortex.
   Requires existing FPS, clamp, css, scaleC, dot and HAS_FILTER helpers.
   ===================================================================================== */

class SonicPulseNebula {
  constructor(o) {
    o = o || {};
    this.audio = o.audio || null;
    this.t0 = o.t0 || 0;
    this.dur = o.dur || 1;
    this.total = Math.max(1, Math.round(this.dur * FPS));

    this.cfg = {
      RX: 62,
      RY: 88,
      PARTICLES: 72,
      LAYER_W: 500,
      LAYER_H: 500
    };

    this.colMap = {
      cyan: [30, 245, 255],
      blue: [35, 115, 255],
      violet: [165, 55, 255],
      pink: [255, 55, 190],
      white: [255, 255, 255]
    };

    this.gc = document.createElement('canvas');
    this.sc = document.createElement('canvas');
    this.bc = document.createElement('canvas');
    this.g = this.t = null;
    this.cp = new Map();

    this.seed = 72419;
    this.initParticles();
    this.buildEnvelope();
    this.reset();
  }

  rand() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  range(a, b) {
    return a + this.rand() * (b - a);
  }

  initParticles() {
    this.seed = 72419;
    this.particles = [];

    for (let i = 0; i < this.cfg.PARTICLES; i++) {
      this.particles.push({
        a: this.range(0, Math.PI * 2),
        r: this.range(0, Math.PI * 2),
        v: this.range(0.012, 0.029),
        len: this.range(12, 32),
        size: this.range(1.0, 2.4),
        life: this.range(0, 1),
        hue: this.rand()
      });
    }
  }

  buildEnvelope() {
    const T = this.total;
    const src = [];
    const a = this.audio;

    if (a && a.peaks && a.pps) {
      const start = Math.max(0, Math.round(this.t0 * a.pps));
      const end = Math.min(
        a.peaks.length,
        start + Math.round(this.dur * a.pps)
      );
      for (let i = start; i < end; i++) {
        src.push(Math.abs(a.peaks[i] || 0));
      }
    }

    this.env = new Float32Array(T);
    this.flux = new Float32Array(T);

    if (!src.length) return;

    let mx = 0;
    for (const v of src) mx = Math.max(mx, v);
    if (mx <= 1e-8) return;

    for (let i = 0; i < T; i++) {
      const f = T > 1 ? i * (src.length - 1) / (T - 1) : 0;
      const lo = Math.floor(f);
      const hi = Math.min(src.length - 1, lo + 1);
      const q = f - lo;

      this.env[i] = (
        src[lo] * (1 - q) + src[hi] * q
      ) / mx;
    }

    const raw = new Float32Array(this.env);

    for (let i = 0; i < T; i++) {
      let sum = 0, n = 0;

      for (let j = -2; j <= 2; j++) {
        const k = i + j;
        if (k < 0 || k >= T) continue;
        sum += raw[k];
        n++;
      }

      this.env[i] = Math.pow(sum / Math.max(1, n), 0.65);
    }

    for (let i = 1; i < T; i++) {
      this.flux[i] = Math.max(0, this.env[i] - this.env[i - 1]);
    }
  }

  reset() {
    this.f = -1;
    this.amp = 0;
    this.vel = 0;
    this.burst = 0;
    this.initParticles();
  }

  snap() {
    return JSON.stringify({
      f: this.f,
      amp: this.amp,
      vel: this.vel,
      burst: this.burst,
      seed: this.seed,
      p: this.particles.map(p => [
        p.a, p.r, p.v, p.len, p.size, p.life, p.hue
      ])
    });
  }

  restore(str) {
    const o = JSON.parse(str);
    this.f = o.f;
    this.amp = o.amp;
    this.vel = o.vel;
    this.burst = o.burst;
    this.seed = o.seed;

    o.p.forEach((v, i) => {
      const p = this.particles[i];
      if (p) {
        [p.a, p.r, p.v, p.len, p.size, p.life, p.hue] = v;
      }
    });
  }

  sync(k) {
    if (k === this.f) return;

    if (k < this.f || k - this.f > 400) {
      let b = Math.floor(k / 100) * 100;
      let state = null;

      while (b >= 0) {
        state = this.cp.get(b);
        if (state) break;
        b -= 100;
      }

      if (k < this.f || (state && b > this.f)) {
        if (state) this.restore(state);
        else this.reset();
      }
    }

    for (let i = this.f + 1; i <= k; i++) this.step(i);
  }

  step(i) {
    const target = this.env[i] || 0;
    const flux = this.flux[i] || 0;

    this.vel = this.vel * 0.5 +
      (target - this.amp) * (target > this.amp ? 0.46 : 0.14);

    this.amp = clamp(this.amp + this.vel, 0, 1);
    this.burst = Math.max(
      this.burst * 0.82,
      clamp(flux * 5, 0, 1)
    );

    for (const p of this.particles) {
      p.life += p.v * (1 + this.amp * 1.7 + this.burst);

      if (p.life >= 1) {
        p.life = 0;
        p.a = this.range(0, Math.PI * 2);
        p.r = this.range(0, Math.PI * 2);
        p.v = this.range(0.012, 0.029);
        p.len = this.range(12, 32);
        p.size = this.range(1, 2.4);
        p.hue = this.rand();
      }
    }

    this.f = i;

    if (i % 100 === 0) {
      this.cp.set(i, this.snap());
      if (this.cp.size > 24) {
        this.cp.delete(this.cp.keys().next().value);
      }
    }
  }

  draw(ctx, x, y, s) {
    const C = this.cfg, cm = this.colMap;
    s = Math.max(0.1, s || 1);

    const LW = Math.ceil(C.LAYER_W * s);
    const LH = Math.ceil(C.LAYER_H * s);

    if (this.gc.width !== LW || this.gc.height !== LH) {
      this.gc.width = this.sc.width = LW;
      this.gc.height = this.sc.height = LH;
      this.g = this.t = null;
    }

    if (!this.g) {
      this.g = this.gc.getContext('2d');
      this.t = this.sc.getContext('2d');
    }

    const g = this.g, t = this.t;
    const time = Math.max(0, this.f) / FPS;
    const amp = this.amp;
    const burst = this.burst;
    const rx = C.RX, ry = C.RY;

    for (const c of [g, t]) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, LW, LH);
      c.setTransform(s, 0, 0, s, LW / 2, LH / 2);
      c.lineCap = 'round';
      c.lineJoin = 'round';
    }

    // Egg-shaped shell with a strong neon edge.
    const body = t.createRadialGradient(0, -12, 5, 0, 0, ry * 1.1);
    body.addColorStop(0, 'rgba(25,55,105,0.48)');
    body.addColorStop(0.65, 'rgba(8,14,38,0.80)');
    body.addColorStop(1, 'rgba(40,20,100,0.48)');

    t.fillStyle = body;
    t.beginPath();
    t.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    t.fill();

    // Wavefronts visibly expand from the shell.
    // Several distinct wavefronts remain visible even during quiet speech.
    for (let j = 0; j < 4; j++) {
      const phase = (time * (0.48 + j * 0.09) + j * 0.25) % 1;
      const radius = 1.05 + phase * (0.48 + amp * 0.30);
      const fade = 1 - phase;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.15 + fade * (0.12 + amp * 0.34);
      g.strokeStyle = css(j % 2 ? cm.cyan : cm.violet);
      g.lineWidth = 1.6 + amp * 2.4;

      g.beginPath();
      g.ellipse(
        0, 0, rx * radius, ry * radius,
        0, 0, Math.PI * 2
      );
      g.stroke();
      g.restore();
    }

    // Audio-triggered radial shockwave.
    if (burst > 0.025) {
      const r = 1.04 + (1 - burst) * 0.28;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.35 + burst * 0.6;
      g.strokeStyle = css(cm.white);
      g.lineWidth = 1.5 + burst * 3.5;
      g.beginPath();
      g.ellipse(
        0, 0, rx * r, ry * r,
        0, 0, Math.PI * 2
      );
      g.stroke();
      g.restore();
    }

    // Shell edge.
    t.save();
    t.globalCompositeOperation = 'lighter';
    t.strokeStyle = css(cm.cyan);
    t.lineWidth = 2 + amp * 1.5;
    t.beginPath();
    t.ellipse(
      0, 0,
      rx * (1 + amp * 0.035),
      ry * (1 + amp * 0.035),
      0, 0, Math.PI * 2
    );
    t.stroke();
    t.restore();

    // Sparks shoot outward from the egg boundary.
    for (const p of this.particles) {
      const u = p.life;
      const startR = 1.01;
      const endR = 1.12 + u * (0.40 + amp * 0.48);

      const a = p.a +
        Math.sin(time * 1.7 + p.r) * 0.035 * u;

      const x1 = Math.cos(a) * rx * startR;
      const y1 = Math.sin(a) * ry * startR;

      const x2 = Math.cos(a) * rx * endR;
      const y2 = Math.sin(a) * ry * endR;

      const fade = Math.sin(Math.PI * u);
      const alpha = 0.20 + fade * (0.40 + amp * 0.50);
      const col = p.hue < 0.5 ? cm.cyan : cm.violet;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = alpha;
      g.strokeStyle = css(col);
      g.lineWidth = p.size * 3.2;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      g.restore();

      t.save();
      t.globalCompositeOperation = 'lighter';
      t.globalAlpha = alpha;
      t.strokeStyle = css(cm.white);
      t.lineWidth = p.size;
      t.beginPath();
      t.moveTo(x1, y1);
      t.lineTo(x2, y2);
      t.stroke();

      dot(
        t, x2, y2,
        p.size * 1.35,
        css(col)
      );
      t.restore();
    }

    // Small moving surface highlights.
    for (let j = 0; j < 6; j++) {
      const a = time * (0.75 + j * 0.06) + j * 1.047;
      const px = Math.cos(a) * rx;
      const py = Math.sin(a) * ry;

      dot(
        g, px, py,
        5 + amp * 5,
        css(scaleC(cm.cyan, 0.45 + amp * 0.45))
      );

      dot(t, px, py, 1.8 + amp * 1.4, css(cm.white));
    }

    // Composite glow.
    const ox = x - LW / 2, oy = y - LH / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.95;

    if (HAS_FILTER) {
      ctx.filter = 'blur(' + (3.5 * s).toFixed(2) + 'px)';
      ctx.drawImage(this.gc, ox, oy);
      ctx.filter = 'none';
    } else {
      const sw = Math.max(8, Math.ceil(LW / 3));
      const sh = Math.max(8, Math.ceil(LH / 3));

      if (this.bc.width !== sw || this.bc.height !== sh) {
        this.bc.width = sw;
        this.bc.height = sh;
      }

      const b = this.bc.getContext('2d');
      b.clearRect(0, 0, sw, sh);
      b.drawImage(this.gc, 0, 0, sw, sh);
      ctx.drawImage(this.bc, 0, 0, sw, sh, ox, oy, LW, LH);
    }

    ctx.globalAlpha = 1;
    ctx.drawImage(this.sc, ox, oy);
    ctx.restore();
  }

  render(ctx, T, x, y, scale) {
    const k = clamp(
      Math.floor(T * FPS + 1e-6),
      0,
      this.total - 1
    );

    this.sync(k);
    this.draw(ctx, x, y, scale || 1);
  }
}


    register({ key: 'sonic_pulse_nebula', py: 32,order: 15, name: 'Sonic Pulse Nebula', tag: 'Test',
      defaults: { x: 640, y: 360, scale: 1 }, cls: SonicPulseNebula });
})();