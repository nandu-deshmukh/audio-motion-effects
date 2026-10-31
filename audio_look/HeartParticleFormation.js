(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

/* =====================================================================================
   * HeartParticleFormation   (Python: HeartParticleFormation)
   * Heart shape particles with spring physics, beat blast, and motion trail
   * ===================================================================================== */
  class HeartParticleFormation {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        HEART_SIZE: 95,
        NUM_PARTICLES: 1200,
        GLOW: 0.45,
        LAYER_W: 460,
        LAYER_H: 420
      };

      this.hotPink = [255, 60, 180];
      this.neonRed = [255, 40, 70];

      this.buildEnvelope();
      this.initParticles();

      this.cp = new Map();
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
    }

    // Normal distribution helper (Box-Muller transform)
    randn(mean = 0, std = 1) {
      let u = 0, v = 0;
      while (u === 0) u = this.rng.rand();
      while (v === 0) v = this.rng.rand();
      const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
      return mean + num * std;
    }

    buildEnvelope() {
      const T = this.total, a = this.audio;
      let seg_ = [];
      if (a && a.peaks && a.pps) {
        const s0 = Math.max(0, Math.round(this.t0 * a.pps));
        const e0 = Math.min(a.peaks.length, s0 + Math.round(this.dur * a.pps));
        seg_ = a.peaks.slice(s0, e0);
      }
      let mx = 0;
      for (const v of seg_) mx = Math.max(mx, Math.abs(v));
      if (!seg_.length || mx <= 0) { this.env = new Float32Array(T); this.flux = new Float32Array(T); return; }
      const L = seg_.length, env = new Float32Array(T);
      for (let i = 0; i < T; i++) {
        const f = T > 1 ? i * (L - 1) / (T - 1) : 0, lo = Math.floor(f), hi = Math.min(lo + 1, L - 1), fr = f - lo;
        env[i] = Math.abs(seg_[lo]) * (1 - fr) + Math.abs(seg_[hi]) * fr;
      }
      let emax = 0;
      for (let i = 0; i < T; i++) emax = Math.max(emax, env[i]);
      const floor = 0.18 * emax + 1e-6, hw = Math.max(3, Math.floor(FPS * 0.6));
      const e2 = new Float32Array(T);
      for (let i = 0; i < T; i++) {
        let m = floor;
        const s = Math.max(0, i - hw), e = Math.min(T, i + hw + 1);
        for (let j = s; j < e; j++) if (env[j] > m) m = env[j];
        e2[i] = Math.pow(clamp(env[i] / m, 0, 1), 0.7);
      }
      const sm = new Float32Array(e2);
      for (let i = 2; i < T - 2; i++) sm[i] = 0.10 * e2[i - 2] + 0.22 * e2[i - 1] + 0.36 * e2[i] + 0.22 * e2[i + 1] + 0.10 * e2[i + 2];
      const fl = new Float32Array(T);
      for (let i = 1; i < T; i++) {
        let s = 0, n = 0;
        for (let j = Math.max(0, i - 3); j < i; j++) { s += sm[j]; n++; }
        fl[i] = Math.max(0, sm[i] - s / n);
      }
      this.env = sm; this.flux = fl;
    }

    initParticles() {
      const C = this.cfg, n = C.NUM_PARTICLES;
      this.rng = new RNG(42); // temporary for initialization
      const rng = this.rng;

      this.baseTargets = [];
      this.baseColors = [];
      this.outDir = [];

      let meanY = 0;
      const rawPts = [];
      for (let i = 0; i < n; i++) {
        const t = rng.uniform(0, 2 * Math.PI);
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        const px = hx / 16.0, py = hy / 16.0;
        rawPts.push([px, py]);
        meanY += py;
      }
      meanY /= n;

      for (let i = 0; i < n; i++) {
        const inner = rng.rand() < 0.4 ? 1.0 : Math.sqrt(rng.uniform(0.05, 1.0));
        const tx = rawPts[i][0] * inner + this.randn(0, 0.012);
        const ty = (rawPts[i][1] - meanY) * inner + this.randn(0, 0.012);
        this.baseTargets.push([tx, ty]);

        const len = Math.hypot(tx, ty) + 1e-6;
        this.outDir.push([tx / len, ty / len]);

        const mix = rng.uniform(0, 1);
        this.baseColors.push([
          this.hotPink[0] * (1 - mix) + this.neonRed[0] * mix,
          this.hotPink[1] * (1 - mix) + this.neonRed[1] * mix,
          this.hotPink[2] * (1 - mix) + this.neonRed[2] * mix
        ]);
      }
    }

    reset() {
      const C = this.cfg, n = C.NUM_PARTICLES;
      this.rng = new RNG(42);
      this.smoothAmp = 0;
      this.prevAmp = 0;
      this.framesSinceBeat = 999;

      this.particles = [];
      for (let i = 0; i < n; i++) {
        const px = this.rng.uniform(-150, 150);
        const py = this.rng.uniform(-150, 150);
        this.particles.push({
          x: px, y: py,
          vx: 0, vy: 0,
          target: this.baseTargets[i],
          dir: this.outDir[i],
          col: this.baseColors[i]
        });
      }
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        pt: this.particles.map(p => [p.x, p.y, p.vx, p.vy]),
        sa: this.smoothAmp, pa: this.prevAmp, fsb: this.framesSinceBeat,
        r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.smoothAmp = o.sa; this.prevAmp = o.pa; this.framesSinceBeat = o.fsb;
      this.rng.s = o.r; this.f = o.f;
      for (let i = 0; i < o.pt.length; i++) {
        this.particles[i].x = o.pt[i][0];
        this.particles[i].y = o.pt[i][1];
        this.particles[i].vx = o.pt[i][2];
        this.particles[i].vy = o.pt[i][3];
      }
    }

    sync(k) {
      if (k === this.f) return;
      if (k < this.f || k - this.f > 400) {
        let b = Math.floor(k / 100) * 100, s = null;
        while (b >= 0) { s = this.cp.get(b); if (s) break; b -= 100; }
        if (k < this.f || (s && b > this.f)) { if (s) this.restore(s); else this.reset(); }
      }
      for (let i = this.f + 1; i <= k; i++) this.step(i);
    }

    step(i) {
      const C = this.cfg, rng = this.rng;
      const env = this.env[i] || 0, flux = this.flux[i] || 0;

      if (env > this.smoothAmp) {
        this.smoothAmp = env;
      } else {
        this.smoothAmp = this.smoothAmp * 0.45 + env * 0.55;
      }

      const delta = env - this.prevAmp;
      this.framesSinceBeat++;
      const beat = delta > 0.06 && env > 0.12 && this.framesSinceBeat > 2;
      this.prevAmp = env;

      const springK = 0.22, damping = 0.70;
      const breathing = 0.015 * Math.sin(i * 0.07);
      const scale = 1.0 + 0.30 * this.smoothAmp + breathing;

      if (beat) {
        this.framesSinceBeat = 0;
      }
      const strength = beat ? Math.min(1.0, 0.35 + delta * 4.0) : 0;

      for (let p of this.particles) {
        const tx = p.target[0] * (C.HEART_SIZE * scale);
        const ty = p.target[1] * (C.HEART_SIZE * scale);

        const ax = (tx - p.x) * springK;
        const ay = (ty - p.y) * springK;
        p.vx = (p.vx + ax) * damping;
        p.vy = (p.vy + ay) * damping;

        if (beat) {
          const power = rng.uniform(4, 11) * strength;
          const noiseX = this.randn(0, 0.45);
          const noiseY = this.randn(0, 0.45);
          p.vx += (p.dir[0] + noiseX) * power;
          p.vy += (p.dir[1] + noiseY) * power;
        }

        p.vx += p.dir[0] * (Math.abs(delta) * 14.0);
        p.vy += p.dir[1] * (Math.abs(delta) * 14.0);

        const jitX = this.randn(0, 0.4 + this.smoothAmp * 3.0);
        const jitY = this.randn(0, 0.4 + this.smoothAmp * 3.0);

        p.x += p.vx + jitX;
        p.y += p.vy + jitY;
      }

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
    }

    draw(ctx, x, y, s) {
      const C = this.cfg;
      const LW = Math.ceil(C.LAYER_W * s), LH = Math.ceil(C.LAYER_H * s);
      if (this.gc.width !== LW || this.gc.height !== LH) { this.gc.width = this.sc.width = LW; this.gc.height = this.sc.height = LH; this.g = null; this.t = null; }
      if (!this.g) { this.g = this.gc.getContext('2d'); this.t = this.sc.getContext('2d'); }
      
      const g = this.g, t = this.t;
      for (const c of [g, t]) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, LW, LH);
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2); c.lineCap = 'round'; c.lineJoin = 'round';
      }

      const cx = 0, cy = 0;
      const intensity = 0.55 + 0.45 * Math.min(1.0, this.smoothAmp + 0.3);

      for (const p of this.particles) {
        const speed = Math.hypot(p.vx, p.vy);
        const bright = clamp(speed / 9.0, 0, 1);
        
        const r = p.col[0] + (255 - p.col[0]) * bright;
        const gg = p.col[1] + (255 - p.col[1]) * bright;
        const b = p.col[2] + (255 - p.col[2]) * bright;

        // FIX: intensity ko 255 se divide nahi karna hai, kyunki scaleC 0-1 factor leta hai
        const col = scaleC([r, gg, b], intensity);
        const colStr = css(col);

        dot(g, p.x, p.y, 2.5, colStr);
        dot(t, p.x, p.y, 1.5, colStr);
      }

      const inten = clamp(C.GLOW + 0.15 * this.smoothAmp, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = inten;
      if (HAS_FILTER) {
        ctx.filter = 'blur(' + (3.2 * s).toFixed(2) + 'px)';
        ctx.drawImage(this.gc, ox, oy);
        ctx.filter = 'none';
      } else {
        const sw = Math.max(8, Math.ceil(LW / 3)), sh = Math.max(8, Math.ceil(LH / 3));
        if (!this.bc) this.bc = document.createElement('canvas');
        if (this.bc.width !== sw || this.bc.height !== sh) { this.bc.width = sw; this.bc.height = sh; }
        const b = this.bc.getContext('2d');
        b.clearRect(0, 0, sw, sh); b.drawImage(this.gc, 0, 0, sw, sh);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.bc, 0, 0, sw, sh, ox, oy, LW, LH);
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(this.sc, ox, oy);
      ctx.restore();
    }

    render(ctx, T, x, y, scale) {
      const k = clamp(Math.floor(T * FPS + 1e-6), 0, this.total - 1);
      this.sync(k);
      this.draw(ctx, x, y, scale || 1);
    }
  }


    register({ key: 'heart_particle_formation', py: 29,order: 8, name: 'Heart Particle Formation', tag: 'heart shape particles · spring physics · beat blast',
      defaults: { x: 210, y: 540, scale: 1 }, cls: HeartParticleFormation });
})();