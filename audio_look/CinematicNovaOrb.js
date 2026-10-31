(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

/* =====================================================================================
   * CinematicNovaOrb   (Python: CinematicNovaOrb)
   * Compact & Ultra-Smooth Cinematic Nova Audio Visualizer with liquid harmonics & particles
   * ===================================================================================== */
  class CinematicNovaOrb {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        BASE_RADIUS: 52,
        NUM_POINTS: 240,
        IDLE_WOBBLE: 2.5,
        MAX_DEFORM: 22,
        PULSE: 10,
        GLOW: 0.32,
        MAX_PARTICLES: 220,
        LAYER_W: 340,
        LAYER_H: 340
      };

      // Palette (RGB format)
      this.colCyan = [130, 240, 255];
      this.colMagenta = [255, 80, 225];
      this.colViolet = [140, 70, 200];
      this.colGold = [255, 230, 130];
      this.colWhite = [255, 255, 255];

      // Smooth liquid harmonics config
      this.ks = [2, 3, 4, 5, 6];
      let wSum = 1.0 + 0.75 + 0.50 + 0.30 + 0.15;
      this.weights = [1.0/wSum, 0.75/wSum, 0.50/wSum, 0.30/wSum, 0.15/wSum];
      this.speeds = [0.09, -0.07, 0.11, -0.08, 0.06];

      const rng = new RNG(42);
      this.phases = [];
      for (let i = 0; i < this.ks.length; i++) this.phases.push(rng.uniform(0, 2 * Math.PI));

      this.thetas = new Float32Array(this.cfg.NUM_POINTS);
      for (let i = 0; i < this.cfg.NUM_POINTS; i++) this.thetas[i] = (i / this.cfg.NUM_POINTS) * 2 * Math.PI;

      this.buildEnvelope();
      this.cp = new Map();
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
    }

    /* ---- speech envelope ---- */
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
      const floor = 0.20 * emax + 1e-6, hw = Math.max(5, Math.floor(FPS * 1.2));
      const e2 = new Float32Array(T);
      for (let i = 0; i < T; i++) {
        let m = floor;
        const s = Math.max(0, i - hw), e = Math.min(T, i + hw + 1);
        for (let j = s; j < e; j++) if (env[j] > m) m = env[j];
        e2[i] = Math.pow(clamp(env[i] / m, 0, 1), 0.72);
      }
      const sm = new Float32Array(e2);
      for (let i = 2; i < T - 2; i++) sm[i] = 0.1 * e2[i-2] + 0.2 * e2[i-1] + 0.4 * e2[i] + 0.2 * e2[i+1] + 0.1 * e2[i+2];

      const fl = new Float32Array(T);
      for (let i = 1; i < T; i++) {
        let s = 0, n = 0;
        for (let j = Math.max(0, i - 3); j < i; j++) { s += sm[j]; n++; }
        fl[i] = Math.max(0, sm[i] - s / n);
      }
      this.env = sm; this.flux = fl;
    }

    /* ---- state ---- */
    reset() {
      const C = this.cfg;
      this.rng = new RNG(7);
      this.smoothAmp = 0;
      this.ampVel = 0;
      this.phaseAcc = 0;
      this.beatFlash = 0;
      this.cooldown = 0;

      this.radiiMain = new Float32Array(C.NUM_POINTS); this.radiiMain.fill(C.BASE_RADIUS);
      this.velMain = new Float32Array(C.NUM_POINTS);
      this.radiiSub = new Float32Array(C.NUM_POINTS); this.radiiSub.fill(C.BASE_RADIUS + 4);
      this.velSub = new Float32Array(C.NUM_POINTS);
      this.radiiEcho = new Float32Array(C.NUM_POINTS); this.radiiEcho.fill(C.BASE_RADIUS + 10);
      this.velEcho = new Float32Array(C.NUM_POINTS);

      this.particles = [];
      this.shockwaves = [];
      this.emitAcc = 0;
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        rm: Array.from(this.radiiMain), rs: Array.from(this.radiiSub), re: Array.from(this.radiiEcho),
        pt: this.particles, sw: this.shockwaves, sa: this.smoothAmp, av: this.ampVel,
        pa: this.phaseAcc, bf: this.beatFlash, cd: this.cooldown, ea: this.emitAcc,
        r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.radiiMain = Float32Array.from(o.rm); this.radiiSub = Float32Array.from(o.rs); this.radiiEcho = Float32Array.from(o.re);
      this.particles = o.pt; this.shockwaves = o.sw; this.smoothAmp = o.sa; this.ampVel = o.av;
      this.phaseAcc = o.pa; this.beatFlash = o.bf; this.cooldown = o.cd; this.emitAcc = o.ea;
      this.rng.s = o.r; this.f = o.f;
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

      const stiffness = env > this.smoothAmp ? 0.48 : 0.28;
      const damping = 0.62;
      this.ampVel = this.ampVel * damping + (env - this.smoothAmp) * stiffness;
      this.smoothAmp = clamp(this.smoothAmp + this.ampVel, 0, 1.15);

      this.phaseAcc += 0.75 + this.smoothAmp * 1.65;
      this.cooldown = Math.max(0, this.cooldown - 1);
      const isBeat = flux > 0.09 && this.cooldown === 0;
      if (isBeat) {
        this.cooldown = 2;
        this.beatFlash = Math.min(1.0, this.beatFlash + 0.65);
        if (env > 0.42 && this.shockwaves.length < 2) {
          this.shockwaves.push([C.BASE_RADIUS * 0.95, C.BASE_RADIUS + 38 + env * 28, 0.75]);
        }
      } else {
        this.beatFlash *= 0.80;
      }

      const deform = C.IDLE_WOBBLE + this.smoothAmp * C.MAX_DEFORM;

      const getOffs = (shift, dir) => {
        const o = new Float32Array(C.NUM_POINTS);
        for (let j = 0; j < C.NUM_POINTS; j++) {
          let sum = 0;
          for (let kIdx = 0; kIdx < this.ks.length; kIdx++) {
            sum += this.weights[kIdx] * Math.sin(this.ks[kIdx] * this.thetas[j] + this.phases[kIdx] + shift + this.phaseAcc * this.speeds[kIdx] * dir);
          }
          o[j] = sum;
        }
        return o;
      };

      const tMain = getOffs(0.0, 1.0), tSub = getOffs(2.1, -0.85), tEcho = getOffs(1.2, 0.65);
      const targetMain = new Float32Array(C.NUM_POINTS), targetSub = new Float32Array(C.NUM_POINTS), targetEcho = new Float32Array(C.NUM_POINTS);

      for (let j = 0; j < C.NUM_POINTS; j++) {
        targetMain[j] = C.BASE_RADIUS + this.smoothAmp * C.PULSE + tMain[j] * deform;
        targetSub[j] = C.BASE_RADIUS + 4 + this.smoothAmp * (C.PULSE * 1.1) + tSub[j] * (deform * 0.9);
        targetEcho[j] = C.BASE_RADIUS + 9 + this.smoothAmp * (C.PULSE * 1.25) + tEcho[j] * (deform * 1.05);
      }

      const updateSpring = (cur, vel, tgt, ks, ds) => {
        for (let j = 0; j < C.NUM_POINTS; j++) {
          vel[j] = vel[j] * ds + (tgt[j] - cur[j]) * ks;
          cur[j] += vel[j];
        }
      };

      updateSpring(this.radiiMain, this.velMain, targetMain, 0.45, 0.58);
      updateSpring(this.radiiSub, this.velSub, targetSub, 0.40, 0.60);
      updateSpring(this.radiiEcho, this.velEcho, targetEcho, 0.32, 0.65);

      // Particles
      this.emitAcc += Math.pow(this.smoothAmp, 1.6) * 3.2;
      let nNew = Math.floor(this.emitAcc);
      this.emitAcc -= nNew;
      if (isBeat) nNew += Math.floor(4 + this.smoothAmp * 7);
      nNew = Math.min(nNew, C.MAX_PARTICLES - this.particles.length);

      if (nNew > 0) {
        let meanR = 0;
        for (let j = 0; j < C.NUM_POINTS; j++) meanR += this.radiiMain[j];
        meanR /= C.NUM_POINTS;

        const probs = new Float32Array(C.NUM_POINTS);
        let pSum = 0;
        for (let j = 0; j < C.NUM_POINTS; j++) {
          probs[j] = Math.max(0, this.radiiMain[j] - meanR) + 1e-3;
          pSum += probs[j];
        }
        for (let j = 0; j < C.NUM_POINTS; j++) probs[j] /= pSum;

        for (let q = 0; q < nNew; q++) {
          // Weighted random choice
          let rPick = rng.rand(), cum = 0, idx = 0;
          for (let j = 0; j < C.NUM_POINTS; j++) {
            cum += probs[j];
            if (rPick <= cum) { idx = j; break; }
          }
          const ang = this.thetas[idx] + rng.uniform(-0.04, 0.04);
          const r = this.radiiMain[idx];
          const speed = (1.1 + this.smoothAmp * 3.4) * rng.uniform(0.75, 1.2) * (isBeat ? 1.25 : 1.0);
          const life = Math.floor(rng.uniform(12, 24));
          const cType = rng.rand() < 0.45 ? 0 : (rng.rand() < 0.85 ? 1 : 2);
          const swirlDir = (rng.rand() < 0.5 ? -1 : 1) * rng.uniform(0.02, 0.045);

          this.particles.push([
            r * Math.cos(ang), r * Math.sin(ang),
            speed * Math.cos(ang), speed * Math.sin(ang),
            life, life, cType, swirlDir
          ]);
        }
      }

      const alive = [];
      for (const p of this.particles) {
        let px = p[0], py = p[1], vx = p[2], vy = p[3], life = p[4], maxLife = p[5], cType = p[6], swirl = p[7];
        const cosS = Math.cos(swirl), sinS = Math.sin(swirl);
        const nvx = vx * cosS - vy * sinS, nvy = vx * sinS + vy * cosS;
        px += nvx; py += nvy;
        vx = nvx * 0.94; vy = nvy * 0.94;
        life -= 1;
        if (life > 0) alive.push([px, py, vx, vy, life, maxLife, cType, swirl]);
      }
      this.particles = alive;

      // Shockwaves
      const activeWaves = [];
      for (const sw of this.shockwaves) {
        sw[0] += (sw[1] - sw[0]) * 0.22 + 1.5;
        sw[2] -= 0.065;
        if (sw[2] > 0.03) activeWaves.push(sw);
      }
      this.shockwaves = activeWaves;

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
    }

    /* ---- drawing ---- */
    draw(ctx, x, y, s) {
      const C = this.cfg;
      const LW = Math.ceil(C.LAYER_W * s), LH = Math.ceil(C.LAYER_H * s);
      if (this.gc.width !== LW || this.gc.height !== LH) { this.gc.width = this.sc.width = LW; this.gc.height = this.sc.height = LH; this.g = null; }
      if (!this.g) { this.g = this.gc.getContext('2d'); this.t = this.sc.getContext('2d'); }
      const g = this.g, t = this.t;
      for (const c of [g, t]) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, LW, LH);
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2); c.lineCap = 'round'; c.lineJoin = 'round';
      }

      const cx = 0, cy = 0;
      const cycle = 0.5 + 0.5 * Math.sin(this.f * 0.04);
      const colPrimary = lerpC(this.colCyan, this.colMagenta, cycle);
      const colSecondary = lerpC(this.colMagenta, this.colCyan, cycle);
      const colAccent = lerpC(colPrimary, this.colGold, this.beatFlash * 0.65);
      const colOuterRing = lerpC(this.colCyan, this.colWhite, 0.55 + 0.35 * this.smoothAmp);
      const colCoreFill = lerpC(this.colViolet, colPrimary, 0.4 + 0.5 * this.smoothAmp);

      const toPts = (radii) => {
        const pts = [];
        for (let j = 0; j < C.NUM_POINTS; j++) {
          pts.push([Math.round(cx + radii[j] * Math.cos(this.thetas[j])), Math.round(cy + radii[j] * Math.sin(this.thetas[j]))]);
        }
        return pts;
      };

      const ptsMain = toPts(this.radiiMain);
      const ptsSub = toPts(this.radiiSub);
      const ptsEcho = toPts(this.radiiEcho);

      // 1. Inner Core
      g.fillStyle = css(colCoreFill);
      g.beginPath(); g.moveTo(ptsMain[0][0], ptsMain[0][1]);
      for (let j = 1; j < ptsMain.length; j++) g.lineTo(ptsMain[j][0], ptsMain[j][1]);
      g.closePath(); g.fill();

      const coreR = Math.round(C.BASE_RADIUS * (0.45 + 0.25 * this.smoothAmp));
      dot(g, cx, cy, coreR, css(colSecondary));
      dot(g, cx, cy, Math.max(1, coreR * 0.45), 'rgb(255,255,255)');

      // 2. Shockwaves
      for (const sw of this.shockwaves) {
        const rad = Math.round(sw[0]);
        const swCol = scaleC(this.colCyan, sw[2]);
        ring(g, cx, cy, rad, css(swCol), 3);
        ring(t, cx, cy, rad, 'rgb(255,255,255)', 1);
      }

      // 3. Borders (Glow + Crisp Strokes)
      for (const [pts, col, lw] of [
        [ptsEcho, colOuterRing, 4], [ptsSub, colSecondary, 5], [ptsMain, colAccent, 6]
      ]) {
        g.strokeStyle = css(col); g.lineWidth = lw; g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]); for (let j = 1; j < pts.length; j++) g.lineTo(pts[j][0], pts[j][1]);
        g.closePath(); g.stroke();
      }

      for (const [pts, col, lw] of [
        [ptsEcho, colOuterRing, 2], [ptsSub, colSecondary, 2], [ptsMain, colAccent, 3]
      ]) {
        t.strokeStyle = css(col); t.lineWidth = lw; t.beginPath();
        t.moveTo(pts[0][0], pts[0][1]); for (let j = 1; j < pts.length; j++) t.lineTo(pts[j][0], pts[j][1]);
        g.closePath(); t.stroke();
      }
      // Crisp white highlight on main
      t.strokeStyle = 'rgb(255,255,255)'; t.lineWidth = 1; t.beginPath();
      t.moveTo(ptsMain[0][0], ptsMain[0][1]); for (let j = 1; j < ptsMain.length; j++) t.lineTo(ptsMain[j][0], ptsMain[j][1]);
      t.closePath(); t.stroke();

      // 4. Particles
      for (const p of this.particles) {
        const fade = Math.pow(p[4] / p[5], 0.85);
        let baseC = this.colCyan;
        if (p[6] === 1) baseC = this.colMagenta;
        else if (p[6] === 2) baseC = this.colGold;

        const pCol = scaleC(baseC, fade);
        const curX = p[0], curY = p[1];
        const tailX = p[0] - p[2] * 1.8, tailY = p[1] - p[3] * 1.8;

        seg(g, tailX, tailY, curX, curY, css(pCol), 3);
        seg(t, tailX, tailY, curX, curY, css(pCol), 1);
        dot(t, curX, curY, Math.max(1, 1.5 * fade), 'rgb(255,255,255)');
      }

      // Composite and Draw
      const inten = clamp(C.GLOW + 0.14 * this.smoothAmp, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
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


    register({ key: 'cinematic_nova_orb', py: 26, order: 3,name: 'Cinematic Nova Orb', tag: 'smooth liquid harmonics · glowing core · shockwaves · neon particles',
      defaults: { x: 180, y: 565, scale: 1 }, cls: CinematicNovaOrb });
})();