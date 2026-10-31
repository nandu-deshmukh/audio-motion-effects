(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

   /* =====================================================================================
   * SciFiSignalWave   (Python: SciFiSignalWave)
   * Twin interference waves + hologram hatching + HUD audio visualizer
   * ===================================================================================== */
  class SciFiSignalWave {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        ANCHOR_X: 70,
        ANCHOR_Y: 520,
        WAVE_WIDTH: 440.0,
        MAX_AMP: 95.0,
        NUM_POINTS: 220,
        LEVEL_ATTACK: 0.80,
        LEVEL_RELEASE: 0.55,
        GATE: 0.04,
        PHASE_SPEED: 0.30,
        SCAN_SPEED: 0.035,
        GLOW: 0.42,
        LAYER_W: 600,    // Size badha diya hai taaki cut na ho
        LAYER_H: 400
      };

      this.colGold = [215, 255, 70];
      this.white = [255, 255, 255];
      this.generateLUT();
      this.buildEnvelope();

      this.cp = new Map();
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
    }

    generateLUT() {
      const stops = [
        [40, 200, 255],
        [60, 130, 255],
        [140, 70, 235],
        [240, 60, 200],
        [255, 100, 140]
      ];
      const pos = [0.0, 0.30, 0.58, 0.82, 1.0];
      this.lut = [];
      for (let i = 0; i < 256; i++) {
        const t = i / 255.0;
        let idx = 0;
        while (idx < pos.length - 1 && t > pos[idx + 1]) idx++;
        if (idx >= pos.length - 1) {
          this.lut.push(stops[stops.length - 1]);
        } else {
          const t0 = pos[idx], t1 = pos[idx + 1];
          const f = (t - t0) / (t1 - t0);
          const c0 = stops[idx], c1 = stops[idx + 1];
          this.lut.push([
            Math.round(c0[0] + (c1[0] - c0[0]) * f),
            Math.round(c0[1] + (c1[1] - c0[1]) * f),
            Math.round(c0[2] + (c1[2] - c0[2]) * f)
          ]);
        }
      }
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

    reset() {
      this.level = 0.0;
      this.beat = 0.0;
      this.phase = 0.0;
      this.scan = 0.0;
      this.cooldown = 0;
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        lv: this.level, bt: this.beat, ph: this.phase, sc: this.scan,
        cd: this.cooldown, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.level = o.lv; this.beat = o.bt; this.phase = o.ph;
      this.scan = o.sc; this.cooldown = o.cd; this.f = o.f;
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
      const now = this.env[i] || 0;
      const nxt = this.env[Math.min(i + 1, this.total - 1)] || 0;
      let target = Math.max(now, nxt);
      if (target < C.GATE) target = 0.0;

      if (target > this.level) {
        this.level += (target - this.level) * C.LEVEL_ATTACK;
      } else {
        this.level = Math.max(target, this.level * C.LEVEL_RELEASE);
      }
      if (this.level < 0.02) this.level = 0.0;

      const flux = this.flux[i] || 0;
      this.cooldown = Math.max(0, this.cooldown - 1);
      if (flux > 0.08 && this.cooldown === 0 && this.level > 0.12) {
        this.cooldown = 3;
        this.beat = 1.0;
      } else {
        this.beat *= 0.50;
        if (this.beat < 0.05) this.beat = 0.0;
      }

      this.phase += this.level * C.PHASE_SPEED;
      if (this.level > 0.0) {
        this.scan = (this.scan + this.level * C.SCAN_SPEED) % 1.0;
      }

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
    }

    draw(ctx, x, y, s) {
      const C = this.cfg;
      const LW = Math.ceil(C.LAYER_W * s), LH = Math.ceil(C.LAYER_H * s);
      if (this.gc.width !== LW || this.gc.height !== LH) { this.gc.width = this.sc.width = LW; this.gc.height = this.sc.height = LH; this.g = null; }
      if (!this.g) { this.g = this.gc.getContext('2d'); this.t = this.sc.getContext('2d'); }
      const g = this.g, t = this.t;
      for (const c of [g, t]) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, LW, LH);
        // Anchor translation center set properly
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2); c.lineCap = 'round'; c.lineJoin = 'round';
      }

      const N = C.NUM_POINTS, W = C.WAVE_WIDTH, AMP = C.MAX_AMP;
      // Local origin centered offset calculation
      const localAX = -W / 2;
      const localAY = 0;

      const introFrames = Math.max(1, Math.round(FPS * 0.7));
      const reveal = 1.0 - Math.pow(Math.max(0, 1.0 - this.f / introFrames), 3);
      const TAU = 2.0 * Math.PI;

      const xs = new Float32Array(N), envelope = new Float32Array(N);
      const vis = new Float32Array(N), hA = new Float32Array(N), hB = new Float32Array(N);
      const colsA = [], colsB = [];

      for (let j = 0; j < N; j++) {
        const frac = j / (N - 1);
        xs[j] = localAX + frac * W;
        envelope[j] = Math.pow(Math.abs(Math.sin(frac * Math.PI)), 0.75);
        vis[j] = clamp((reveal * 1.3 - frac) / 0.25, 0.0, 1.0);

        const sa = 0.55 * Math.sin(TAU * 2.3 * frac - this.phase) + 0.30 * Math.sin(TAU * 5.2 * frac + 1.7 * this.phase) + 0.15 * Math.sin(TAU * 9.5 * frac - 2.3 * this.phase);
        const sb = 0.60 * Math.sin(TAU * 3.1 * frac + 1.3 * this.phase + 0.8) + 0.40 * Math.sin(TAU * 6.4 * frac - 0.9 * this.phase);

        hA[j] = this.level * AMP * envelope[j] * vis[j] * sa;
        hB[j] = this.level * AMP * 0.62 * envelope[j] * vis[j] * sb;

        colsA.push(this.lut[Math.min(255, Math.floor(frac * 255))]);
        colsB.push(this.lut[Math.min(255, Math.floor((frac * 0.7 + 0.30) * 255))]);
      }

      // HUD Baseline
      for (let segIdx = 0; segIdx < 48; segIdx++) {
        const f0 = segIdx / 48.0, f1 = (segIdx + 1) / 48.0;
        const br = Math.pow(Math.sin((f0 + f1) * 0.5 * Math.PI), 0.8);
        const col = scaleC(this.lut[110], (0.18 + 0.25 * br) * (0.6 + 0.4 * this.level) * reveal);
        seg(t, localAX - 24 + f0 * (W + 48), localAY, localAX - 24 + f1 * (W + 48), localAY, css(col), 1);
      }

      const tickB = (0.20 + 0.35 * this.level) * reveal;
      for (let k = 0; k <= W; k += 20) {
        const tx = localAX + k;
        const h = (k % 100 === 0) ? 6 : 3;
        seg(t, tx, localAY + 10, tx, localAY + 10 + h, css(scaleC(this.lut[90], tickB)), 1);
      }

      // Corner brackets
      const bl = 14, top = localAY - AMP - 18, bot = localAY + AMP + 18, left = localAX - 24, right = localAX + W + 24;
      const bcol = scaleC(this.lut[140], (0.25 + 0.40 * this.level) * reveal);
      for (const [cx_, cy_, sx_, sy_] of [[left, top, 1, 1], [right, top, -1, 1], [left, bot, 1, -1], [right, bot, -1, -1]]) {
        seg(t, cx_, cy_, cx_ + sx_ * bl, cy_, css(bcol), 1);
        seg(t, cx_, cy_, cx_, cy_ + sy_ * bl, css(bcol), 1);
      }

      // Hologram hatching
      if (this.level > 0.0) {
        for (let j = 2; j < N - 2; j += 4) {
          const a = Math.abs(hA[j]) / AMP;
          if (a < 0.04 || vis[j] < 0.05) continue;
          const c = scaleC(colsA[j], (0.14 + 0.40 * a) * vis[j]);
          seg(t, xs[j], localAY, xs[j], localAY - hA[j], css(c), 1);
        }
      }

      // Wave B
      if (this.level > 0.0) {
        for (let j = 0; j < N - 1; j++) {
          const v = 0.5 * (vis[j] + vis[j + 1]);
          if (v < 0.05) continue;
          const c = lerpC(colsB[j], this.colGold, 0.5 * this.beat);
          const y0 = localAY - hB[j], y1 = localAY - hB[j + 1];
          seg(g, xs[j], y0, xs[j + 1], y1, css(scaleC(c, 0.40 * v)), 3);
          seg(t, xs[j], y0, xs[j + 1], y1, css(scaleC(c, 0.65 * v)), 1);
        }
      }

      // Wave A
      for (let j = 0; j < N - 1; j++) {
        const v = 0.5 * (vis[j] + vis[j + 1]);
        if (v < 0.05) continue;
        const a = 0.5 * ((Math.abs(hA[j]) + Math.abs(hA[j + 1])) / AMP);
        let c = lerpC(colsA[j], this.white, 0.30 * a);
        c = lerpC(c, this.colGold, 0.60 * this.beat);
        const y0 = localAY - hA[j], y1 = localAY - hA[j + 1];
        seg(g, xs[j], y0, xs[j + 1], y1, css(scaleC(c, 0.55 * v)), 5);
        seg(t, xs[j], y0, xs[j + 1], y1, css(scaleC(c, (0.60 + 0.40 * a) * v)), 2);
      }

      // Scan marker
      if (this.level > 0.0) {
        const sj = Math.min(N - 1, Math.max(0, Math.floor(this.scan * (N - 1))));
        const sx = xs[sj], scCol = scaleC(this.lut[40], 0.20 + 0.40 * this.level);
        seg(t, sx, localAY - AMP - 10, sx, localAY + AMP + 10, css(scCol), 1);
        dot(t, sx, localAY - hA[sj], 3, css(this.white));
      }

      // Composite & Draw
      const inten = clamp(C.GLOW * (0.55 + 0.45 * Math.min(1.0, this.level * 1.6)) + 0.10 * this.beat, 0, 1);
      const ox = x - LW / 2, oy = y - LH / 2;
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

    register({ key: 'scifi_signal_wave', py: 22,order: 14, name: 'Sci-Fi Signal Wave', tag: 'twin interference waves · hologram · hud',
      defaults: { x: 70, y: 520, scale: 1 }, cls: SciFiSignalWave });
})();