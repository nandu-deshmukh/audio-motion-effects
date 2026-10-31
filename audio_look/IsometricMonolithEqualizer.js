(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

  /* =====================================================================================
   * IsometricMonolithEqualizer   (Python: IsometricMonolithEqualizer)
   * 3D Isometric Cyber-Monolith Grid Audio Visualizer
   * ===================================================================================== */
  class IsometricMonolithEqualizer {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        GRID_X_SIZE: 6,
        GRID_Z_SIZE: 6,
        TILE_WIDTH: 22.0,
        TILE_DEPTH: 22.0,
        MONOLITH_BASE_H: 10.0,
        MAX_MONOLITH_H: 75.0,
        GLOW: 0.35,
        MAX_PARTICLES: 80,
        LAYER_W: 360,
        LAYER_H: 320
      };
      // Colors (RGB format) - Synthwave Neon Orange, Cyan, Cyber Violet, Gold
      this.colMap = {
        orange: [255, 140, 30],
        cyan: [70, 230, 255],
        violet: [140, 40, 210],
        gold: [255, 210, 50],
        white: [255, 255, 255]
      };
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
      const floor = 0.18 * emax + 1e-6, hw = Math.max(3, Math.floor(FPS * 0.6));
      const e2 = new Float32Array(T);
      for (let i = 0; i < T; i++) {
        let m = floor;
        const s = Math.max(0, i - hw), e = Math.min(T, i + hw + 1);
        for (let j = s; j < e; j++) if (env[j] > m) m = env[j];
        e2[i] = Math.pow(clamp(env[i] / m, 0, 1), 0.68);
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

    /* ---- state ---- */
    reset() {
      const C = this.cfg;
      this.rng = new RNG(99);
      this.smoothAmp = 0;
      this.ampVel = 0;
      this.beatFlash = 0;
      this.monolithHeights = new Float32Array(C.GRID_X_SIZE * C.GRID_Z_SIZE);
      this.monolithHeights.fill(C.MONOLITH_BASE_H);
      this.monolithVels = new Float32Array(C.GRID_X_SIZE * C.GRID_Z_SIZE);
      this.particles = [];       // [x, y, vy, life, maxLife, cType]
      this.cooldown = 0;
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        mh: Array.from(this.monolithHeights), mv: Array.from(this.monolithVels),
        pt: this.particles, sa: this.smoothAmp, av: this.ampVel,
        bf: this.beatFlash, cd: this.cooldown, r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.monolithHeights = Float32Array.from(o.mh);
      this.monolithVels = Float32Array.from(o.mv);
      this.particles = o.pt; this.smoothAmp = o.sa; this.ampVel = o.av;
      this.beatFlash = o.bf; this.cooldown = o.cd; this.rng.s = o.r; this.f = o.f;
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

    /* ---- physics step ---- */
    step(i) {
      const C = this.cfg, rng = this.rng;
      const env = this.env[i] || 0, flux = this.flux[i] || 0;

      const stiffness = env > this.smoothAmp ? 0.52 : 0.28;
      this.ampVel = this.ampVel * 0.58 + (env - this.smoothAmp) * stiffness;
      this.smoothAmp = clamp(this.smoothAmp + this.ampVel, 0, 1.25);

      this.cooldown = Math.max(0, this.cooldown - 1);
      const isBeat = flux > 0.075 && this.cooldown === 0;
      if (isBeat) {
        this.cooldown = 2;
        this.beatFlash = Math.min(1.0, this.beatFlash + 0.85);
      } else {
        this.beatFlash *= 0.78;
      }

      for (let gx = 0; gx < C.GRID_X_SIZE; gx++) {
        for (let gz = 0; gz < C.GRID_Z_SIZE; gz++) {
          const idx = gx * C.GRID_Z_SIZE + gz;
          const distCenter = Math.hypot(gx - C.GRID_X_SIZE / 2.0, gz - C.GRID_Z_SIZE / 2.0);
          const waveMod = Math.sin(i * 0.35 - distCenter * 1.2);

          let targetH = C.MONOLITH_BASE_H + this.smoothAmp * C.MAX_MONOLITH_H * (0.5 + 0.5 * waveMod);
          if (isBeat && distCenter < 1.8) targetH += 22.0;

          this.monolithVels[idx] = this.monolithVels[idx] * 0.55 + (targetH - this.monolithHeights[idx]) * 0.45;
          this.monolithHeights[idx] = Math.max(C.MONOLITH_BASE_H, this.monolithHeights[idx] + this.monolithVels[idx]);
        }
      }

      // update particles
      const aliveParticles = [];
      for (const p of this.particles) {
        p[1] += p[2]; p[3] -= 1;
        if (p[3] > 0) aliveParticles.push(p);
      }
      this.particles = aliveParticles;

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
    }

    toIsometric(gx, gz, height) {
      const C = this.cfg;
      const sx = Math.round((gx - gz) * C.TILE_WIDTH);
      const sy = Math.round((gx + gz) * (C.TILE_DEPTH * 0.5) - height);
      return [sx, sy];
    }

    /* ---- drawing ---- */
    draw(ctx, x, y, s) {
      const C = this.cfg, cm = this.colMap, sa = this.smoothAmp;
      const LW = Math.ceil(C.LAYER_W * s), LH = Math.ceil(C.LAYER_H * s);
      if (this.gc.width !== LW || this.gc.height !== LH) { this.gc.width = this.sc.width = LW; this.gc.height = this.sc.height = LH; this.g = null; }
      if (!this.g) { this.g = this.gc.getContext('2d'); this.t = this.sc.getContext('2d'); }
      const g = this.g, t = this.t;
      for (const c of [g, t]) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, LW, LH);
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2 + 30); c.lineCap = 'round'; c.lineJoin = 'round';
      }

      const cycle = 0.5 + 0.5 * Math.sin(this.f * 0.035);
      const colLeft = lerpC(cm.orange, cm.violet, cycle);
      const colRight = lerpC(cm.violet, cm.cyan, cycle);
      const colTop = lerpC(cm.cyan, cm.gold, this.beatFlash);

      // Painter's algorithm (Back-to-front sorting)
      const renderOrder = [];
      for (let gx = 0; gx < C.GRID_X_SIZE; gx++) {
        for (let gz = 0; gz < C.GRID_Z_SIZE; gz++) {
          renderOrder.push([gx + gz, gx, gz]);
        }
      }
      renderOrder.sort((a, b) => a[0] - b[0]);

      for (const item of renderOrder) {
        const gx = item[1], gz = item[2];
        const idx = gx * C.GRID_Z_SIZE + gz;
        const h = this.monolithHeights[idx];

        const pBase = this.toIsometric(gx, gz, 0.0);
        const pRight = this.toIsometric(gx + 1, gz, 0.0);
        const pBack = this.toIsometric(gx + 1, gz + 1, 0.0);
        const pLeft = this.toIsometric(gx, gz + 1, 0.0);

        const tBase = this.toIsometric(gx, gz, h);
        const tRight = this.toIsometric(gx + 1, gz, h);
        const tBack = this.toIsometric(gx + 1, gz + 1, h);
        const tLeft = this.toIsometric(gx, gz + 1, h);

        const heightFactor = clamp(h / C.MAX_MONOLITH_H, 0.2, 1.0);
        const faceLeftCol = scaleC(colLeft, heightFactor);
        const faceRightCol = scaleC(colRight, heightFactor * 0.85);
        const faceTopCol = scaleC(colTop, 0.7 + 0.3 * heightFactor);

        // Draw top face on glow layer
        g.fillStyle = css(faceTopCol); g.beginPath();
        g.moveTo(tBase[0], tBase[1]); g.lineTo(tRight[0], tRight[1]); g.lineTo(tBack[0], tBack[1]); g.lineTo(tLeft[0], tLeft[1]); g.closePath(); g.fill();

        // Draw left/right faces on stroke layer
        for (const [poly, fCol] of [[[pBase, pLeft, tLeft, tBase], faceLeftCol], [[pBase, pRight, tRight, tBase], faceRightCol]]) {
          t.fillStyle = css(fCol); t.beginPath();
          t.moveTo(poly[0][0], poly[0][1]); t.lineTo(poly[1][0], poly[1][1]); t.lineTo(poly[2][0], poly[2][1]); t.lineTo(poly[3][0], poly[3][1]); t.closePath(); t.fill();
        }

        // Outlines
        for (const poly of [[tBase, tRight, tBack, tLeft], [pBase, pLeft, tLeft, tBase], [pBase, pRight, tRight, tBase]]) {
          t.strokeStyle = css(colTop); t.lineWidth = 1; t.beginPath();
          t.moveTo(poly[0][0], poly[0][1]); for (let k = 1; k < poly.length; k++) t.lineTo(poly[k][0], poly[k][1]);
          t.closePath(); t.stroke();
        }

        // Spawn sparks
        if (h > (C.MONOLITH_BASE_H + 25.0) && this.rng.rand() < 0.35 && this.particles.length < C.MAX_PARTICLES) {
          const topX = (tBase[0] + tBack[0]) / 2, topY = (tBase[1] + tBack[1]) / 2;
          this.particles.push([topX + this.rng.uniform(-4, 4), topY, -this.rng.uniform(2.0, 5.0), 15, 15, this.rng.randint(0, 2)]);
        }
      }

      // Draw particles
      for (const p of this.particles) {
        const fade = Math.pow(p[3] / p[4], 0.85);
        const pCol = scaleC(p[5] === 0 ? cm.cyan : cm.gold, fade);
        dot(g, p[0], p[1], 2.5, css(pCol));
        dot(t, p[0], p[1], 1, 'rgb(255,255,255)');
      }

      // Composite and Draw
      const inten = clamp(C.GLOW + 0.14 * sa, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
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


    register({ key: 'isometric_monolith', py: 21,order: 9, name: 'Isometric Monolith Equalizer', tag: '3d isometric grid · cyber monoliths · sparks',
      defaults: { x: 220, y: 510, scale: 1 }, cls: IsometricMonolithEqualizer });
})();