(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

  /* =====================================================================================
   * NewVoiceAuroraRibbons   (Python: NewVoiceAuroraRibbons)
   * Siri/aurora style multi-layer glowing ribbons with amplitude history propagation
   * ===================================================================================== */
  class NewVoiceAuroraRibbons {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        WAVE_W: 460,
        WAVE_AMP: 75,
        POINTS: 160,
        HISTORY: 42,
        GLOW: 0.45,
        LAYER_W: 520,
        LAYER_H: 260
      };

      // Palette (RGB format)
      const cyan = [0, 205, 255];
      const blue = [30, 90, 255];
      const violet = [150, 55, 255];
      const pink = [255, 40, 170];
      const ice = [170, 215, 255];
      this.highlight = [255, 215, 250];

      this.layers = [
        { ca: cyan,   cb: blue,   ampScale: 1.00, cycles: 2.0, speed:  2.6, offs: 0.0, thick: 2 },
        { ca: blue,   cb: violet, ampScale: 0.85, cycles: 2.8, speed: -2.1, offs: 1.3, thick: 2 },
        { ca: violet, cb: pink,   ampScale: 0.70, cycles: 3.6, speed:  3.0, offs: 2.4, thick: 2 },
        { ca: pink,   cb: cyan,   ampScale: 0.50, cycles: 4.4, speed: -3.4, offs: 0.7, thick: 1 },
        { ca: ice,    cb: ice,    ampScale: 0.38, cycles: 1.5, speed:  1.6, offs: 3.1, thick: 1 }
      ];

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
      if (!seg_.length || mx <= 0) { this.env = new Float32Array(T); return; }
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
      this.env = e2;
    }

    /* ---- state ---- */
    reset() {
      const C = this.cfg;
      this.smoothAmp = 0;
      this.hist = new Float32Array(C.HISTORY);
      this.phases = new Float32Array(this.layers.length);
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        h: Array.from(this.hist), p: Array.from(this.phases),
        sa: this.smoothAmp, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.hist = Float32Array.from(o.h);
      this.phases = Float32Array.from(o.p);
      this.smoothAmp = o.sa;
      this.f = o.f;
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
      const C = this.cfg;
      const amp = this.env[i] || 0;

      if (amp > this.smoothAmp) {
        this.smoothAmp = amp;
      } else {
        this.smoothAmp = this.smoothAmp * 0.45 + amp * 0.55;
      }

      // Roll history buffer
      for (let h = C.HISTORY - 1; h > 0; h--) {
        this.hist[h] = this.hist[h - 1];
      }
      this.hist[0] = amp;

      for (let li = 0; li < this.layers.length; li++) {
        this.phases[li] += this.layers[li].speed / FPS * (1 + 2.5 * this.smoothAmp);
      }

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

      const N = C.POINTS, W = C.WAVE_W, cy = 0, leftX = -W / 2;
      const xs = new Float32Array(N), px = new Float32Array(N), d = new Float32Array(N), windowArr = new Float32Array(N);

      for (let j = 0; j < N; j++) {
        xs[j] = j / (N - 1);
        px[j] = leftX + xs[j] * W;
        d[j] = Math.abs(2 * xs[j] - 1);
        windowArr[j] = Math.pow(Math.max(0, 1 - Math.pow(d[j], 2)), 1.4);
      }

      // Compute level envelope from history
      const level = new Float32Array(N);
      for (let j = 0; j < N; j++) {
        const histIdxFloat = d[j] * (C.HISTORY - 1);
        const lo = Math.floor(histIdxFloat), hi = Math.min(lo + 1, C.HISTORY - 1), fr = histIdxFloat - lo;
        const val = this.hist[lo] * (1 - fr) + this.hist[hi] * fr;
        level[j] = 0.05 + 0.95 * clamp(val, 0, 1);
      }

      // Draw Layers
      for (let li = 0; li < this.layers.length; li++) {
        const layer = this.layers[li];
        const kEff = layer.cycles * (1 + 0.45 * this.smoothAmp);
        const pts = [];

        for (let j = 0; j < N; j++) {
          const carrier = Math.sin(2 * Math.PI * kEff * xs[j] + this.phases[li] + layer.offs);
          const yVal = C.WAVE_AMP * layer.ampScale * level[j] * windowArr[j] * carrier;
          pts.push([px[j], cy - yVal]);
        }

        // Fill background soft polygon
        t.fillStyle = css(scaleC([
          (layer.ca[0] + layer.cb[0]) / 2,
          (layer.ca[1] + layer.cb[1]) / 2,
          (layer.ca[2] + layer.cb[2]) / 2
        ], 0.14));
        t.beginPath();
        t.moveTo(pts[0][0], pts[0][1]);
        for (let j = 1; j < pts.length; j++) t.lineTo(pts[j][0], pts[j][1]);
        for (let j = pts.length - 1; j >= 0; j--) t.lineTo(pts[j][0], cy);
        t.closePath(); t.fill();

        // Stroke lines
        for (let j = 0; j < N - 1; j++) {
          const f = j / (N - 1);
          const gCol = 0.5 + 0.5 * Math.sin(2 * Math.PI * (f * 0.7) - this.f * 0.05 + li * 1.3);
          const spike = Math.pow(Math.abs(pts[j][1] - cy) / (C.WAVE_AMP * layer.ampScale + 1e-6), 1.6);
          
          const baseR = layer.ca[0] * (1 - gCol) + layer.cb[0] * gCol;
          const baseG = layer.ca[1] * (1 - gCol) + layer.cb[1] * gCol;
          const baseB = layer.ca[2] * (1 - gCol) + layer.cb[2] * gCol;

          const segCol = [
            baseR * (1 - 0.4 * spike) + this.highlight[0] * (0.4 * spike),
            baseG * (1 - 0.4 * spike) + this.highlight[1] * (0.4 * spike),
            baseB * (1 - 0.4 * spike) + this.highlight[2] * (0.4 * spike)
          ];
          const bright = 0.6 + 0.3 * Math.min(1.0, this.smoothAmp + 0.2);
          const finalCol = scaleC(segCol, bright);

          const colStr = css(finalCol);
          seg(g, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], colStr, layer.thick + 3);
          seg(t, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], colStr, layer.thick);
        }
      }

      // Composite and Draw
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

    register({ key: 'aurora_ribbons', py: 25,order: 11, name: 'Voice Aurora Ribbons', tag: 'siri style multi-layer glowing ribbons · history wave',
      defaults: { x: 640, y: 560, scale: 1 }, cls: NewVoiceAuroraRibbons });
})();