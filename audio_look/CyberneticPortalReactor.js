(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

/* =====================================================================================
   * CyberneticPortalReactor   -   Sci-Fi Stargate / Particle Accelerator Gate
   * Uses peaks, rms, lows, mids, highs, and spectralCentroid from audio_data.npz
   * ===================================================================================== */
  class CyberneticPortalReactor {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        PORTAL_RADIUS: 58,
        GLOW: 0.42,
        MAX_SPARKS: 70,
        LAYER_W: 380,
        LAYER_H: 380
      };
      // Cyberpunk / Plasma Palette (RGB)
      this.colMap = {
        neonCyan: [30, 240, 255],
        plasmaPink: [255, 40, 160],
        deepViolet: [140, 30, 240],
        solarGold: [255, 215, 50],
        white: [255, 255, 255]
      };
      this.buildMultiFeatureEnvelopes();
      this.cp = new Map();
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
    }

    buildMultiFeatureEnvelopes() {
      const T = this.total, a = this.audio || {};
      const extract = (arr) => {
        if (!arr || !a.pps) return new Float32Array(T);
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

      this.envRms = extract(a.rms || a.peaks);
      this.envLows = extract(a.lows);
      this.envMids = extract(a.mids);
      this.envHighs = extract(a.highs);
      this.envCentroid = extract(a.spectralCentroid || a.centroid);
    }

    reset() {
      const C = this.cfg;
      this.rng = new RNG(133);
      this.smoothRms = 0;
      this.rotorAngle1 = 0;
      this.rotorAngle2 = 0;
      this.sparks = [];
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        sp: this.sparks, sr: this.smoothRms,
        ra1: this.rotorAngle1, ra2: this.rotorAngle2,
        r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.sparks = o.sp; this.smoothRms = o.sr;
      this.rotorAngle1 = o.ra1; this.rotorAngle2 = o.ra2;
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
      const rms = this.envRms[i] || 0;
      const lows = this.envLows[i] || 0;
      const mids = this.envMids[i] || 0;  // <-- FIX: Mids variable properly defined here
      const highs = this.envHighs[i] || 0;

      this.smoothRms = this.smoothRms * 0.6 + rms * 0.4;
      this.rotorAngle1 += 0.02 + lows * 0.08;
      this.rotorAngle2 -= 0.03 + mids * 0.06;

      if ((highs > 0.35 || rms > 0.4) && rng.rand() < 0.6 && this.sparks.length < C.MAX_SPARKS) {
        const ang = rng.uniform(0, 2 * Math.PI);
        const spd = rng.uniform(2.0, 5.5);
        this.sparks.push([
          Math.cos(ang) * 10, Math.sin(ang) * 10,
          Math.cos(ang) * spd, Math.sin(ang) * spd,
          25, 25, highs > 0.6 ? 1 : 0
        ]);
      }

      const alive = [];
      for (const sp of this.sparks) {
        sp[0] += sp[2]; sp[1] += sp[3]; sp[4] -= 1;
        sp[2] *= 0.96; sp[3] *= 0.96;
        if (sp[4] > 0) alive.push(sp);
      }
      this.sparks = alive;

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
      const centroid = this.envCentroid[this.f] || 0.5;

      const portalCol = lerpC(cm.neonCyan, cm.plasmaPink, centroid);

      const coreR = Math.round(15 + rms * 25);
      dot(g, cx, cy, coreR + 8, css(scaleC(cm.deepViolet, 0.6)));
      dot(t, cx, cy, coreR, css(portalCol));
      dot(t, cx, cy, Math.max(2, coreR - 8), css(cm.white));

      const ringR = C.PORTAL_RADIUS + lows * 12;
      ring(g, cx, cy, ringR + 4, css(scaleC(portalCol, 0.4)), 3);
      ring(t, cx, cy, ringR, css(portalCol), 2);

      const segments = 8;
      for (let j = 0; j < segments; j++) {
        const ang1 = (j / segments) * 2 * Math.PI + this.rotorAngle1;
        const ang2 = (j / segments) * 2 * Math.PI + this.rotorAngle2;

        const x1_in = cx + Math.cos(ang1) * (ringR - 8);
        const y1_in = cy + Math.sin(ang1) * (ringR - 8);
        const x1_out = cx + Math.cos(ang1) * (ringR + 10);
        const y1_out = cy + Math.sin(ang1) * (ringR + 10);

        const x2_in = cx + Math.cos(ang2) * (ringR - 4);
        const y2_in = cy + Math.sin(ang2) * (ringR - 4);
        const x2_out = cx + Math.cos(ang2) * (ringR + 16);
        const y2_out = cy + Math.sin(ang2) * (ringR + 16);

        seg(t, x1_in, y1_in, x1_out, y1_out, css(cm.solarGold), 2);
        seg(t, x2_in, y2_in, x2_out, y2_out, css(cm.neonCyan), 1.5);
      }

      for (const sp of this.sparks) {
        const fade = sp[4] / sp[5];
        const sparkCol = sp[6] === 1 ? cm.solarGold : cm.white;
        dot(t, sp[0], sp[1], Math.max(1, 2 * fade), css(scaleC(sparkCol, fade)));
      }

      const inten = clamp(C.GLOW + 0.18 * rms, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
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

    register({ key: 'cyber_portal', py: 28,order: 6, name: 'Cybernetic Portal Reactor', tag: 'stargate ring · rotating rotors · plasma core · energy sparks',
      defaults: { x: 640, y: 360, scale: 1 }, cls: CyberneticPortalReactor });
})();