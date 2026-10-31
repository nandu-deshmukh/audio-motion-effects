(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

  /* =====================================================================================
   * CelestialSolarReactor   -   Classic Multi-Feature Circular Audio Reactor
   * Uses peaks, rms, zcr, lows, mids, highs, and spectralCentroid from audio_data.npz
   * ===================================================================================== */
  class CelestialSolarReactor {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        RADIUS: 65,
        NUM_BARS: 60,
        MAX_BAR_H: 55,
        GLOW: 0.38,
        LAYER_W: 360,
        LAYER_H: 360
      };
      // Palette (RGB)
      this.colMap = {
        cyan: [50, 240, 255],
        violet: [195, 55, 245],
        gold: [255, 215, 55],
        orange: [255, 120, 30],
        white: [255, 255, 255]
      };
      this.buildMultiFeatureEnvelopes();
      this.cp = new Map();
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
    }

    /* ---- Multi-feature envelope builder for peaks, rms, lows, mids, highs, centroid ---- */
    buildMultiFeatureEnvelopes() {
      const T = this.total, a = this.audio;
      const extract = (arr) => {
        if (!arr || !a || !a.pps) return new Float32Array(T);
        const s0 = Math.max(0, Math.round(this.t0 * a.pps));
        const e0 = Math.min(arr.length, s0 + Math.round(this.dur * a.pps));
        const seg_ = arr.slice(s0, e0);
        if (!seg_.length) return new Float32Array(T);
        
        const L = seg_.length, res = new Float32Array(T);
        let mx = 0;
        for (let i = 0; i < L; i++) mx = Math.max(mx, Math.abs(seg_[i]));
        const invMx = mx > 0 ? 1 / mx : 1;

        for (let i = 0; i < T; i++) {
          const f = T > 1 ? i * (L - 1) / (T - 1) : 0, lo = Math.floor(f), hi = Math.min(lo + 1, L - 1), fr = f - lo;
          res[i] = (Math.abs(seg_[lo]) * (1 - fr) + Math.abs(seg_[hi]) * fr) * invMx;
        }
        return res;
      };

      const A = a || {};                       // audio data na ho to bhi crash nahi
      this.envPeaks = extract(A.peaks);
      this.envRms = extract(A.rms);
      this.envLows = extract(A.lows);
      this.envMids = extract(A.mids);
      this.envHighs = extract(A.highs);
      this.envZcr = extract(A.zcr);

      // Centroid normal mapping
      const rawCentroid = A.spectralCentroid || A.centroid;
      this.envCentroid = extract(rawCentroid);
    }

    reset() {
      const C = this.cfg;
      this.rng = new RNG(77);
      this.smoothRms = 0;
      this.smoothBass = 0;
      this.rotAngle = 0;
      this.particles = [];       // [x, y, vx, vy, life, maxLife, colType]
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        pt: this.particles, sr: this.smoothRms, sb: this.smoothBass,
        ra: this.rotAngle, r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.particles = o.pt; this.smoothRms = o.sr; this.smoothBass = o.sb;
      this.rotAngle = o.ra; this.rng.s = o.r; this.f = o.f;
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
      const rmsVal = this.envRms[i] || 0;
      const bassVal = this.envLows[i] || 0;
      const zcrVal = this.envZcr[i] || 0;

      this.smoothRms = this.smoothRms * 0.6 + rmsVal * 0.4;
      this.smoothBass = this.smoothBass * 0.6 + bassVal * 0.4;
      this.rotAngle += 0.015 + this.smoothRms * 0.03;

      // Spawn energetic sparks based on ZCR and highs
      if (rmsVal > 0.35 && rng.rand() < 0.4 && this.particles.length < 50) {
        const ang = rng.uniform(0, 2 * Math.PI);
        const r = C.RADIUS + rng.uniform(5, 20);
        const spd = rng.uniform(1.5, 3.5);
        this.particles.push([
          Math.cos(ang) * r, Math.sin(ang) * r,
          Math.cos(ang) * spd, Math.sin(ang) * spd,
          20, 20, zcrVal > 0.5 ? 1 : 0
        ]);
      }

      // Update particles
      const alive = [];
      for (const p of this.particles) {
        p[0] += p[2]; p[1] += p[3]; p[4] -= 1;
        if (p[4] > 0) alive.push(p);
      }
      this.particles = alive;

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
    }

    draw(ctx, x, y, s) {
      const C = this.cfg, cm = this.colMap;
      const LW = Math.ceil(C.LAYER_W * s), LH = Math.ceil(C.LAYER_H * s);
      if (this.gc.width !== LW || this.gc.height !== LH) { this.gc.width = this.sc.width = LW; this.gc.height = this.sc.height = LH; this.g = null; }
      if (!this.g) { this.g = this.gc.getContext('2d'); this.t = this.sc.getContext('2d'); }
      const g = this.g, t = this.t;
      for (const c of [g, t]) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, LW, LH);
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2); c.lineCap = 'round'; c.lineJoin = 'round';
      }

      const cx = 0, cy = 0;
      const rms = this.envRms[this.f] || 0;
      const lows = this.envLows[this.f] || 0;
      const mids = this.envMids[this.f] || 0;
      const highs = this.envHighs[this.f] || 0;
      const centroid = this.envCentroid[this.f] || 0.5;

      // Dynamic color shifting based on spectral centroid & highs
      let baseCol = lerpC(cm.cyan, cm.violet, centroid);
      if (highs > 0.6) baseCol = lerpC(baseCol, cm.gold, (highs - 0.6) * 2.5);

      // 1. Pulsating Inner Core (Driven by RMS energy)
      const coreR = Math.round(C.RADIUS * 0.4 + rms * 28);
      dot(g, cx, cy, coreR + 6, css(scaleC(baseCol, 0.4)));
      dot(t, cx, cy, coreR, css(baseCol));
      dot(t, cx, cy, Math.max(2, coreR - 6), css(cm.white));

      // 2. Circular Frequency Spectrum Bars (Driven by Lows, Mids, Highs)
      const numBars = C.NUM_BARS;
      for (let i = 0; i < numBars; i++) {
        const ang = (i / numBars) * 2 * Math.PI + this.rotAngle;
        // Distribute frequency response across the circle
        const freqVal = i < numBars * 0.33 ? lows : (i < numBars * 0.66 ? mids : highs);
        const barH = Math.max(4, freqVal * C.MAX_BAR_H * (0.8 + 0.4 * Math.sin(this.f * 0.1 + i)));

        const x0 = cx + Math.cos(ang) * C.RADIUS;
        const y0 = cy + Math.sin(ang) * C.RADIUS;
        const x1 = cx + Math.cos(ang) * (C.RADIUS + barH);
        const y1 = cy + Math.sin(ang) * (C.RADIUS + barH);

        const barCol = lerpC(baseCol, cm.gold, freqVal);
        seg(g, x0, y0, x1, y1, css(scaleC(barCol, 0.6)), 4);
        seg(t, x0, y0, x1, y1, css(barCol), 2);
      }

      // 3. Outer Rotating Halo Ring (Driven by Bass / Lows)
      const haloR = C.RADIUS + 18 + this.smoothBass * 14;
      ring(g, cx, cy, haloR, css(scaleC(baseCol, 0.5)), 2);
      ring(t, cx, cy, haloR, css(baseCol), 1);

      // 4. Embers / Spark Particles
      for (const p of this.particles) {
        const fade = p[4] / p[5];
        const pCol = p[6] === 1 ? cm.gold : cm.white;
        dot(t, p[0], p[1], 2, css(scaleC(pCol, fade)));
      }

      // Composite and Draw
      const inten = clamp(C.GLOW + 0.15 * rms, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
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

    register({ key: 'celestial_solar_reactor', py: 23, order: 1, name: 'Celestial Solar Reactor', tag: 'classic circular spectrum · rms core · centroid color',
      defaults: { x: 640, y: 360, scale: 1 }, cls: CelestialSolarReactor });
})();