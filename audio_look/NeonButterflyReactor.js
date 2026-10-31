(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

/* =====================================================================================
   * NeonButterflyReactor   -   Fixed Cinematic Butterfly with Speech-Reactive Inner Venation
   * Fixed wing contours + audio-reactive glowing inner lines/links
   * ===================================================================================== */
  class NeonButterflyReactor {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        SCALE_SZ: 50,
        GLOW: 0.45,
        LAYER_W: 440,
        LAYER_H: 380
      };
      // Cinematic Neon Palette (RGB)
      this.colMap = {
        cyan: [40, 240, 255],
        magenta: [255, 40, 180],
        gold: [255, 210, 50],
        violet: [160, 50, 255],
        white: [255, 255, 255]
      };
      this.buildEnvelopes();
      this.cp = new Map();
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
    }

    buildEnvelopes() {
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
      this.envRms = extract(a.rms);
      this.envLows = extract(a.lows);
      this.envMids = extract(a.mids);
      this.envHighs = extract(a.highs);
      this.envCentroid = extract(a.spectralCentroid || a.centroid);
    }

    reset() {
      this.rng = new RNG(112);
      this.smoothRms = 0;
      this.ripples = [];
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        rp: this.ripples, sr: this.smoothRms, r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.ripples = o.rp; this.smoothRms = o.sr; this.rng.s = o.r; this.f = o.f;
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
      const rng = this.rng;
      const rms = this.envRms[i] || 0;
      const lows = this.envLows[i] || 0;

      this.smoothRms = this.smoothRms * 0.6 + rms * 0.4;

      // Sound wave ripples on heavy speech / beats
      if (lows > 0.4 && rng.rand() < 0.5 && this.ripples.length < 5) {
        this.ripples.push([20, 1.0]);
      }

      const aliveRipples = [];
      for (const rp of this.ripples) {
        rp[0] += 4.5;
        rp[1] -= 0.05;
        if (rp[1] > 0) aliveRipples.push(rp);
      }
      this.ripples = aliveRipples;

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
      const mids = this.envMids[this.f] || 0;
      const highs = this.envHighs[this.f] || 0;
      const centroid = this.envCentroid[this.f] || 0.5;

      const primaryCol = lerpC(cm.cyan, cm.magenta, centroid);

      // 1. Expanding Sound Ripples
      for (const rp of this.ripples) {
        ring(g, cx, cy - 10, rp[0] * 1.5, css(scaleC(cm.gold, rp[1] * 0.5)), 2);
        ring(t, cx, cy - 10, rp[0], css(scaleC(cm.white, rp[1])), 1);
      }

      // 2. Thorax & Core
      dot(g, cx, cy, 10 + rms * 6, css(scaleC(primaryCol, 0.6)));
      dot(t, cx, cy, 5.5, css(cm.white));
      dot(t, cx, cy - 22, 3.5, css(cm.gold));

      // 3. FIXED Butterfly Wings Contour (Pankh bilkul fix rahenge)
      const pointsCount = 90;
      const leftWingPts = [], rightWingPts = [];

      for (let j = 0; j <= pointsCount; j++) {
        const t_par = (j / pointsCount) * 2 * Math.PI;
        const sinT = Math.sin(t_par), cosT = Math.cos(t_par);
        const term = Math.exp(cosT) - 2 * Math.cos(4 * t_par) - Math.pow(Math.sin(t_par / 12), 5);
        
        const bx = sinT * term * C.SCALE_SZ;
        const by = -cosT * term * C.SCALE_SZ;

        rightWingPts.push([Math.abs(bx), by]);
        leftWingPts.push([-Math.abs(bx), by]);
      }

      // Render Fixed Outer Wing Contours
      for (const pts of [leftWingPts, rightWingPts]) {
        g.strokeStyle = css(scaleC(primaryCol, 0.4)); g.lineWidth = 4; g.beginPath();
        t.strokeStyle = css(cm.cyan); t.lineWidth = 1.2; t.beginPath();
        
        for (let j = 0; j < pts.length; j++) {
          const pt = pts[j];
          if (j === 0) { g.moveTo(pt[0], pt[1]); t.moveTo(pt[0], pt[1]); }
          else { g.lineTo(pt[0], pt[1]); t.lineTo(pt[0], pt[1]); }
        }
        g.stroke(); t.stroke();
      }

      // 4. SPEECH-REACTIVE INNER LIKES / VENATION (Pankho ke andar ki lakire jo bolne pe shine karengi)
      for (let j = 6; j < pointsCount; j += 7) {
        const ptR = rightWingPts[j];
        const ptL = leftWingPts[j];

        // Speech intensity factor for glowing inner lines
        const shine = Math.max(0.2, (rms * 0.7 + mids * 0.3) * (0.8 + 0.4 * Math.sin(this.f * 0.25 + j)));
        const lineCol = lerpC(cm.violet, cm.gold, shine);

        // Inner Ribs connecting center to wing edges
        seg(g, cx, cy, ptR[0], ptR[1], css(scaleC(lineCol, shine * 0.8)), 2.5);
        seg(t, cx, cy, ptR[0], ptR[1], css(scaleC(cm.white, shine)), 1.2);

        seg(g, cx, cy, ptL[0], ptL[1], css(scaleC(lineCol, shine * 0.8)), 2.5);
        seg(t, cx, cy, ptL[0], ptL[1], css(scaleC(cm.white, shine)), 1.2);

        // Interconnecting webbing lines inside wings reacting to highs
        if (j + 4 < pointsCount) {
          const nextR = rightWingPts[j + 4];
          const nextL = leftWingPts[j + 4];
          const webCol = scaleC(cm.gold, shine * (0.6 + highs * 0.4));
          seg(t, ptR[0], ptR[1], nextR[0], nextR[1], css(webCol), 1);
          seg(t, ptL[0], ptL[1], nextL[0], nextL[1], css(webCol), 1);
        }
      }

      // Composite and Draw
      const inten = clamp(C.GLOW + 0.2 * rms, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
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

    register(    { key: 'neon_butterfly_reactor', py: 24,order: 10, name: 'Neon Butterfly Reactor', tag: 'butterfly wings · audio wave ripples · reactive beats',
      defaults: { x: 640, y: 360, scale: 1 }, cls: NeonButterflyReactor });
})();