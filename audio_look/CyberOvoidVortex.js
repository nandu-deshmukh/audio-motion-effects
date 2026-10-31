(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;


/* =====================================================================================
   CyberOvoidVortex — Ovoid Shell Energy Infiltration
   Energy begins at the egg's outer shell and gets absorbed into its inner core.
   Keeps: constructor, buildEnvelope, reset, snap, restore, sync, step, draw, render.
   ===================================================================================== */

class CyberOvoidVortex {
  constructor(o) {
    o = o || {};

    this.audio = o.audio || null;
    this.t0 = o.t0 || 0;
    this.dur = o.dur || 1;
    this.total = Math.max(1, Math.round(this.dur * FPS));

    this.cfg = {
      RX: 66,
      RY: 94,
      PARTICLES: 108,
      TRAIL: 0.22,
      GLOW: 0.9,
      LAYER_W: 460,
      LAYER_H: 520
    };

    this.colMap = {
      cyan: [30, 245, 255],
      blue: [30, 105, 255],
      violet: [155, 50, 255],
      pink: [255, 40, 175],
      gold: [255, 205, 65],
      white: [255, 255, 255]
    };

    this.cp = new Map();
    this.gc = document.createElement('canvas');
    this.sc = document.createElement('canvas');
    this.bc = document.createElement('canvas');

    this.g = null;
    this.t = null;

    this.buildEnvelope();
    this.initParticles();
    this.reset();
  }

  // Deterministic random generator: supports repeatable seeking.
  rand() {
    this.randSeed = (
      (Math.imul(this.randSeed, 1664525) + 1013904223) >>> 0
    );
    return this.randSeed / 4294967296;
  }

  randRange(a, b) {
    return a + this.rand() * (b - a);
  }

  buildEnvelope() {
    const T = this.total;
    const a = this.audio;
    let seg = [];

    if (a && a.peaks && a.pps) {
      const start = Math.max(0, Math.round(this.t0 * a.pps));
      const end = Math.min(
        a.peaks.length,
        start + Math.round(this.dur * a.pps)
      );
      seg = a.peaks.slice(start, end);
    }

    const env = new Float32Array(T);
    const flux = new Float32Array(T);

    if (!seg.length) {
      this.env = env;
      this.flux = flux;
      return;
    }

    let mx = 0;
    for (const v of seg) mx = Math.max(mx, Math.abs(v));

    if (mx <= 0) {
      this.env = env;
      this.flux = flux;
      return;
    }

    const L = seg.length;

    for (let i = 0; i < T; i++) {
      const f = T > 1 ? i * (L - 1) / (T - 1) : 0;
      const lo = Math.floor(f);
      const hi = Math.min(lo + 1, L - 1);
      const fr = f - lo;

      env[i] = (
        Math.abs(seg[lo]) * (1 - fr) +
        Math.abs(seg[hi]) * fr
      ) / mx;
    }

    const smooth = new Float32Array(T);
    const radius = Math.max(2, Math.round(FPS * 0.07));

    for (let i = 0; i < T; i++) {
      let sum = 0;
      let weight = 0;

      for (let j = -radius; j <= radius; j++) {
        const k = i + j;
        if (k < 0 || k >= T) continue;

        const w = 1 - Math.abs(j) / (radius + 1);
        sum += env[k] * w;
        weight += w;
      }

      smooth[i] = Math.pow(sum / Math.max(0.001, weight), 0.7);
    }

    for (let i = 1; i < T; i++) {
      flux[i] = Math.max(0, smooth[i] - smooth[i - 1]);
    }

    this.env = smooth;
    this.flux = flux;
  }

  initParticles() {
    const oldSeed = this.randSeed;
    this.randSeed = 73194721;

    this.particles = [];

    for (let i = 0; i < this.cfg.PARTICLES; i++) {
      const angle = this.randRange(0, Math.PI * 2);

      this.particles.push({
        ang: angle,

        // 0 = touching shell; 1 = absorbed at the core.
        progress: this.randRange(0, 0.92),

        speed: this.randRange(0.006, 0.015),
        size: this.randRange(0.8, 2.1),
        trail: this.randRange(0.10, 0.24),
        phase: this.randRange(0, Math.PI * 2),
        orbit: this.randRange(-0.20, 0.20),
        hue: this.rand()
      });
    }

    this.randSeed = oldSeed;
  }

  reset() {
    this.smoothAmp = 0;
    this.ampVel = 0;
    this.f = -1;

    // Restore the same initial particle layout every time.
    this.randSeed = 73194721;
    this.initParticles();

    // Give each particle a stable initial position.
    for (const p of this.particles) {
      p.progress = this.randRange(0, 0.90);
    }
  }

  snap() {
    return JSON.stringify({
      sa: this.smoothAmp,
      av: this.ampVel,
      f: this.f,
      rs: this.randSeed,
      p: this.particles.map(p => [
        p.ang, p.progress, p.speed, p.size,
        p.trail, p.phase, p.orbit, p.hue
      ])
    });
  }

  restore(js) {
    const o = JSON.parse(js);

    this.smoothAmp = o.sa;
    this.ampVel = o.av;
    this.f = o.f;
    this.randSeed = o.rs;

    if (o.p) {
      for (let i = 0; i < this.particles.length; i++) {
        const a = o.p[i];
        if (!a) continue;

        const p = this.particles[i];
        [
          p.ang, p.progress, p.speed, p.size,
          p.trail, p.phase, p.orbit, p.hue
        ] = a;
      }
    }
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

    for (let i = this.f + 1; i <= k; i++) {
      this.step(i);
    }
  }

  step(i) {
    const env = this.env[i] || 0;
    const flux = this.flux[i] || 0;

    const target = env * 0.95;
    const stiffness = target > this.smoothAmp ? 0.35 : 0.13;

    this.ampVel =
      this.ampVel * 0.60 +
      (target - this.smoothAmp) * stiffness;

    this.smoothAmp = clamp(
      this.smoothAmp + this.ampVel,
      0,
      1
    );

    const pulse = this.smoothAmp;
    const burst = Math.min(1, flux * 5);

    for (const p of this.particles) {
      // Streams move from the shell toward the center.
      p.progress += p.speed * (1 + pulse * 1.8 + burst * 2.2);

      // Small angular drift gives each stream a curved trajectory.
      p.ang += p.orbit * 0.008 * (0.5 + pulse);

      if (p.progress >= 1) {
        // Re-enter from the shell after absorption.
        p.progress = 0;
        p.ang = this.randRange(0, Math.PI * 2);
        p.speed = this.randRange(0.006, 0.015);
        p.size = this.randRange(0.8, 2.1);
        p.trail = this.randRange(0.10, 0.24);
        p.phase = this.randRange(0, Math.PI * 2);
        p.orbit = this.randRange(-0.20, 0.20);
        p.hue = this.rand();
      }
    }

    this.f = i;

    if (i % 100 === 0) {
      this.cp.set(i, this.snap());

      // Bound memory usage during long renders.
      if (this.cp.size > 24) {
        const first = this.cp.keys().next().value;
        this.cp.delete(first);
      }
    }
  }

  draw(ctx, x, y, s) {
    const C = this.cfg;
    const cm = this.colMap;

    s = Math.max(0.1, s || 1);

    const LW = Math.ceil(C.LAYER_W * s);
    const LH = Math.ceil(C.LAYER_H * s);

    if (this.gc.width !== LW || this.gc.height !== LH) {
      this.gc.width = this.sc.width = LW;
      this.gc.height = this.sc.height = LH;
      this.g = null;
      this.t = null;
    }

    if (!this.g) {
      this.g = this.gc.getContext('2d');
      this.t = this.sc.getContext('2d');
    }

    const g = this.g;
    const t = this.t;

    for (const c of [g, t]) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, LW, LH);
      c.setTransform(s, 0, 0, s, LW / 2, LH / 2);
      c.lineCap = 'round';
      c.lineJoin = 'round';
    }

    const time = Math.max(0, this.f) / FPS;
    const amp = this.smoothAmp;
    const beat = 1 + amp * 0.075;
    const rx = C.RX * beat;
    const ry = C.RY * beat;

    // Map a particle to an elliptical shell-to-core trajectory.
    const point = (ang, r, bend) => {
      const a = ang + bend;
      return {
        x: Math.cos(a) * rx * r,
        y: Math.sin(a) * ry * r
      };
    };

    // 1. Shell aura: the light originates at the egg boundary.
    g.save();
    g.globalCompositeOperation = 'lighter';

    const halo = g.createRadialGradient(0, 0, ry * 0.25, 0, 0, ry * 1.35);
    halo.addColorStop(0, 'rgba(50,100,255,0.015)');
    halo.addColorStop(0.65, 'rgba(35,170,255,0.035)');
    halo.addColorStop(0.86, 'rgba(0,220,255,' + (0.08 + amp * 0.12) + ')');
    halo.addColorStop(1, 'rgba(170,35,255,0)');

    g.fillStyle = halo;
    g.beginPath();
    g.ellipse(0, 0, rx * 1.35, ry * 1.35, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // 2. Translucent plasma shell with a dark inner body.
    const body = t.createLinearGradient(-rx, -ry, rx, ry);
    body.addColorStop(0, 'rgba(15,35,100,0.88)');
    body.addColorStop(0.45, 'rgba(8,15,45,0.96)');
    body.addColorStop(1, 'rgba(65,10,95,0.84)');

    t.fillStyle = body;
    t.beginPath();
    t.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    t.fill();

    // Shell rim.
    t.save();
    t.globalCompositeOperation = 'lighter';

    t.strokeStyle = css(scaleC(cm.cyan, 0.9));
    t.lineWidth = 2.1;
    t.beginPath();
    t.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    t.stroke();

    t.strokeStyle = css(scaleC(cm.violet, 0.48));
    t.lineWidth = 5;
    t.beginPath();
    t.ellipse(0, 0, rx + 3, ry + 3, 0, 0, Math.PI * 2);
    t.stroke();
    t.restore();

    // 3. Moving electrical arcs travelling around the shell.
    for (let j = 0; j < 5; j++) {
      const start = time * (0.65 + j * 0.11) + j * 2.13;
      const span = 0.30 + 0.18 * Math.sin(time * 1.7 + j);

      t.save();
      t.globalCompositeOperation = 'lighter';
      t.strokeStyle = css(
        j % 2 ? cm.cyan : cm.violet
      );
      t.globalAlpha = 0.48 + amp * 0.42;
      t.lineWidth = j % 2 ? 1.5 : 2.4;

      t.beginPath();
      t.ellipse(
        0, 0, rx + 1.5, ry + 1.5,
        0, start, start + span
      );
      t.stroke();
      t.restore();
    }

    // 4. Curved inward energy streams.
    // Draw trails first, then bright moving particles.
    for (const p of this.particles) {
      const progress = p.progress;
      const bend = Math.sin(time * 1.1 + p.phase) * 0.10;
      const outer = 1 - progress * 0.91;
      const tail = Math.min(0.30, p.trail * (1 + amp * 0.6));
      const inner = Math.min(1, progress + tail);

      const a0 = point(p.ang, outer, bend);
      const a1 = point(p.ang, 1 - inner * 0.91, bend * 0.65);

      const fadeIn = clamp(progress * 7, 0, 1);
      const fadeOut = clamp((1 - progress) * 5, 0, 1);
      const alpha = fadeIn * fadeOut * (0.42 + amp * 0.45);

      const color =
        p.hue < 0.34 ? cm.cyan :
        p.hue < 0.68 ? cm.blue : cm.pink;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = alpha * 0.55;
      g.strokeStyle = css(color);
      g.lineWidth = p.size * 3.2;

      g.beginPath();
      g.moveTo(a0.x, a0.y);
      g.lineTo(a1.x, a1.y);
      g.stroke();
      g.restore();

      t.save();
      t.globalCompositeOperation = 'lighter';
      t.globalAlpha = alpha;

      t.strokeStyle = css(color);
      t.lineWidth = Math.max(0.7, p.size * 0.72);
      t.beginPath();
      t.moveTo(a0.x, a0.y);
      t.lineTo(a1.x, a1.y);
      t.stroke();

      // Bright point remains on the advancing inner tip.
      const head = point(p.ang, outer, bend);
      dot(t, head.x, head.y, p.size * 1.25, css(cm.white));

      t.restore();
    }

    // 5. Fine internal magnetic field lines.
    t.save();
    t.globalCompositeOperation = 'lighter';
    t.lineWidth = 0.8;

    for (let j = 0; j < 3; j++) {
      const r = 0.78 - j * 0.16;
      const rot = time * (j % 2 ? -0.24 : 0.31) + j * 0.7;

      t.strokeStyle = css(scaleC(
        j === 1 ? cm.violet : cm.cyan,
        0.18 + amp * 0.18
      ));

      t.beginPath();
      t.ellipse(0, 0, rx * r, ry * r, rot, 0, Math.PI * 2);
      t.stroke();
    }

    t.restore();

    // 6. Core: absorbs the incoming energy and reacts to the audio.
    const coreR = 8 + amp * 10;

    g.save();
    g.globalCompositeOperation = 'lighter';

    const coreGlow = g.createRadialGradient(0, 0, 1, 0, 0, coreR * 3.8);
    coreGlow.addColorStop(0, 'rgba(255,255,255,0.85)');
    coreGlow.addColorStop(0.22, 'rgba(30,235,255,0.55)');
    coreGlow.addColorStop(0.58, 'rgba(100,50,255,0.22)');
    coreGlow.addColorStop(1, 'rgba(150,30,255,0)');

    g.fillStyle = coreGlow;
    g.beginPath();
    g.arc(0, 0, coreR * 3.8, 0, Math.PI * 2);
    g.fill();
    g.restore();

    t.save();
    t.globalCompositeOperation = 'lighter';

    t.strokeStyle = css(cm.cyan);
    t.lineWidth = 1.4;
    t.beginPath();
    t.ellipse(
      0, 0,
      coreR * (1.6 + amp * 0.2),
      coreR * (1.1 + amp * 0.2),
      time * 0.7,
      0, Math.PI * 2
    );
    t.stroke();

    dot(t, 0, 0, coreR, css(cm.blue));
    dot(t, 0, 0, coreR * 0.62, css(cm.cyan));
    dot(t, 0, 0, Math.max(2, coreR * 0.27), css(cm.white));

    t.restore();

    // 7. Composite the glow and crisp detail onto the destination.
    const ox = x - LW / 2;
    const oy = y - LH / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = C.GLOW;

    if (HAS_FILTER) {
      ctx.filter = 'blur(' + (4 * s).toFixed(2) + 'px)';
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


    register({ key: 'cyber_ovoid_vortex', py: 32,order: 7, name: 'Cyber Ovoid Vortex', tag: 'fixed ovoid core · inward flowing energy waves · sci-fi plasma',
      defaults: { x: 640, y: 360, scale: 1 }, cls: CyberOvoidVortex });
})();