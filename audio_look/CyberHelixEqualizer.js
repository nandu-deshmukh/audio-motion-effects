(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

/* =====================================================================================
   * CyberHelixEqualizer   (Python: CyberHelixEqualizer)
   * 3D Holographic DNA Double-Helix + Peak-Hold Equalizer HUD + Rising Matrix Sparks
   * ===================================================================================== */
  class CyberHelixEqualizer {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        HELIX_HEIGHT: 170,
        HELIX_BASE_WIDTH: 28,
        HELIX_MAX_EXPAND: 30,
        NUM_RUNGS: 18,
        EQ_NUM_BARS: 15,
        EQ_WIDTH: 130,
        EQ_MAX_HEIGHT: 42,
        MAX_SPARKS: 90,
        GLOW: 0.30,
        LAYER_W: 420,
        LAYER_H: 480
      };

      // Theme Colors (RGB format)
      this.colEmerald = [40, 255, 130];
      this.colCyan = [30, 235, 255];
      this.colGold = [255, 210, 40];
      this.colMagenta = [255, 50, 210];
      this.colWhite = [255, 255, 255];

      this.buildEnvelope();

      this.cp = new Map();
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
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
      const C = this.cfg;
      this.rng = new RNG(101);
      this.smoothAmp = 0;
      this.ampVel = 0;
      this.phase = 0;
      this.beatFlash = 0;
      this.cooldown = 0;

      this.rungEnergy = new Float32Array(C.NUM_RUNGS);
      this.eqHeights = new Float32Array(C.EQ_NUM_BARS);
      this.eqVels = new Float32Array(C.EQ_NUM_BARS);
      this.eqPeaks = new Float32Array(C.EQ_NUM_BARS);
      this.eqPeakVels = new Float32Array(C.EQ_NUM_BARS);
      this.sparks = [];

      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        re: Array.from(this.rungEnergy), eh: Array.from(this.eqHeights), ev: Array.from(this.eqVels),
        ep: Array.from(this.eqPeaks), epv: Array.from(this.eqPeakVels), sp: this.sparks,
        sa: this.smoothAmp, av: this.ampVel, ph: this.phase, bf: this.beatFlash, cd: this.cooldown,
        r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.rungEnergy = Float32Array.from(o.re);
      this.eqHeights = Float32Array.from(o.eh); this.eqVels = Float32Array.from(o.ev);
      this.eqPeaks = Float32Array.from(o.ep); this.eqPeakVels = Float32Array.from(o.epv);
      this.sparks = o.sp; this.smoothAmp = o.sa; this.ampVel = o.av;
      this.phase = o.ph; this.beatFlash = o.bf; this.cooldown = o.cd;
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
      const C = this.cfg;
      const env = this.env[i] || 0, flux = this.flux[i] || 0;

      const stiffness = env > this.smoothAmp ? 0.52 : 0.28;
      this.ampVel = this.ampVel * 0.58 + (env - this.smoothAmp) * stiffness;
      this.smoothAmp = clamp(this.smoothAmp + this.ampVel, 0, 1.2);

      this.phase += 0.09 + this.smoothAmp * 0.22;

      for (let r = C.NUM_RUNGS - 1; r > 0; r--) {
        this.rungEnergy[r] = this.rungEnergy[r - 1] * 0.92 + this.rungEnergy[r] * 0.08;
      }
      this.rungEnergy[0] = this.smoothAmp;

      this.cooldown = Math.max(0, this.cooldown - 1);
      const isBeat = flux > 0.08 && this.cooldown === 0;
      if (isBeat) {
        this.cooldown = 2;
        this.beatFlash = Math.min(1.0, this.beatFlash + 0.75);
      } else {
        this.beatFlash *= 0.80;
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
      const topY = cy - C.HELIX_HEIGHT / 2;
      const botY = cy + C.HELIX_HEIGHT / 2;
      const eqBaseY = botY + 38;

      const colorCycle = 0.5 + 0.5 * Math.sin(this.f * 0.035);
      const colStrandA = lerpC(this.colCyan, this.colEmerald, colorCycle);
      const colStrandB = lerpC(this.colMagenta, this.colGold, colorCycle);
      const colLaser = lerpC(this.colEmerald, this.colGold, this.beatFlash);

      const strand1Pts = [], strand2Pts = [];

      for (let i = 0; i < C.NUM_RUNGS; i++) {
        const frac = i / (C.NUM_RUNGS - 1);
        const yCoord = Math.round(botY - frac * C.HELIX_HEIGHT);
        const taper = Math.pow(Math.sin(frac * Math.PI), 0.65);
        const localAmp = this.rungEnergy[i];

        const ang = frac * (2.6 * Math.PI) - this.phase;
        const sinA = Math.sin(ang), cosA = Math.cos(ang);

        const radiusX = (C.HELIX_BASE_WIDTH + localAmp * C.HELIX_MAX_EXPAND) * taper;
        const x1 = Math.round(cx + radiusX * sinA);
        const x2 = Math.round(cx - radiusX * sinA);

        strand1Pts.push([x1, yCoord, cosA, localAmp]);
        strand2Pts.push([x2, yCoord, -cosA, localAmp]);

        const energyFade = 0.30 + 0.70 * localAmp;
        const rungCol = scaleC(colLaser, energyFade);

        seg(g, x1, yCoord, x2, yCoord, css(rungCol), 2);
        seg(t, x1, yCoord, x2, yCoord, css(rungCol), 1);

        const midX = Math.round((x1 + x2) / 2 + Math.sin(this.phase * 2.0 + i) * localAmp * 5);
        if (localAmp > 0.25) {
          const nodeR = localAmp > 0.55 ? 2 : 1;
          dot(g, midX, yCoord, nodeR + 2, css(colLaser));
          dot(t, midX, yCoord, nodeR, 'rgb(255,255,255)');
        }
      }

      // Connect spine ribbons
      for (let sIdx = 0; sIdx < strand1Pts.length - 1; sIdx++) {
        const p1a = strand1Pts[sIdx], p2a = strand1Pts[sIdx + 1];
        const p1b = strand2Pts[sIdx], p2b = strand2Pts[sIdx + 1];

        seg(g, p1a[0], p1a[1], p2a[0], p2a[1], css(colStrandA), 4);
        seg(t, p1a[0], p1a[1], p2a[0], p2a[1], css(colStrandA), 2);

        seg(g, p1b[0], p1b[1], p2b[0], p2b[1], css(colStrandB), 4);
        seg(t, p1b[0], p1b[1], p2b[0], p2b[1], css(colStrandB), 2);
      }

      // Sort nodes by Z-depth
      const allNodes = [];
      for (const p of strand1Pts) allNodes.push([p[2], p[0], p[1], colStrandA, p[3]]);
      for (const p of strand2Pts) allNodes.push([p[2], p[0], p[1], colStrandB, p[3]]);
      allNodes.sort((a, b) => a[0] - b[0]);

      for (const node of allNodes) {
        const z = node[0], xCoord = node[1], yCoord = node[2], col = node[3], lAmp = node[4];
        const depthScale = 0.55 + 0.45 * ((z + 1.0) * 0.5);
        const nodeSize = Math.max(2, Math.round((2.5 + lAmp * 2.5) * depthScale));
        const shadedCol = scaleC(col, depthScale);

        dot(g, xCoord, yCoord, nodeSize + 2, css(shadedCol));
        dot(t, xCoord, yCoord, nodeSize, css(shadedCol));
        if (z > 0.25) {
          dot(t, xCoord, yCoord, Math.max(1, nodeSize - 1), 'rgb(255,255,255)');
        }
      }

      // Equalizer Deck
      const barSpacing = C.EQ_WIDTH / C.EQ_NUM_BARS;
      const startX = cx - C.EQ_WIDTH / 2;

      seg(t, startX - 10, eqBaseY, startX + C.EQ_WIDTH + 6, eqBaseY, css(colStrandA), 1);

      for (let b = 0; b < C.EQ_NUM_BARS; b++) {
        const distCenter = Math.abs(b - (C.EQ_NUM_BARS - 1) / 2) / ((C.EQ_NUM_BARS - 1) / 2);
        const freqMod = 0.55 + 0.45 * Math.sin(this.phase * (1.8 + b * 0.35) + b * 0.9);
        const bellCurve = (1.0 - 0.65 * Math.pow(distCenter, 1.4));

        let targetH = 3.0 + this.smoothAmp * C.EQ_MAX_HEIGHT * bellCurve * freqMod;
        const isBeat = this.beatFlash > 0.1;
        if (isBeat && distCenter < 0.5) targetH += 10.0;

        this.eqVels[b] = this.eqVels[b] * 0.52 + (targetH - this.eqHeights[b]) * 0.48;
        this.eqHeights[b] = Math.max(2.0, this.eqHeights[b] + this.eqVels[b]);

        if (this.eqHeights[b] >= this.eqPeaks[b]) {
          this.eqPeaks[b] = this.eqHeights[b];
          this.eqPeakVels[b] = 0.0;
        } else {
          this.eqPeakVels[b] += 0.28;
          this.eqPeaks[b] = Math.max(2.0, this.eqPeaks[b] - this.eqPeakVels[b]);
        }

        const bx1 = Math.round(startX + b * barSpacing);
        const bx2 = Math.round(bx1 + Math.max(3, barSpacing - 3));
        const byTop = Math.round(eqBaseY - this.eqHeights[b]);
        const byPeak = Math.round(eqBaseY - this.eqPeaks[b] - 3);

        const barCol = lerpC(colStrandA, colStrandB, b / (C.EQ_NUM_BARS - 1));
        const barColStr = css(barCol);

        g.fillStyle = barColStr; g.fillRect(bx1, byTop, bx2 - bx1, eqBaseY - byTop);
        t.fillStyle = barColStr; t.fillRect(bx1, byTop, bx2 - bx1, eqBaseY - byTop);

        seg(t, bx1, byPeak, bx2, byPeak, 'rgb(255,255,255)', 2);
        seg(g, bx1, byPeak, bx2, byPeak, css(colLaser), 3);
      }

      // Rising Matrix Sparks
      const nSpawn = Math.floor(this.smoothAmp * 3.5) + (this.beatFlash > 0.1 ? 4 : 0);
      const allowedSparks = Math.min(nSpawn, C.MAX_SPARKS - this.sparks.length);
      for (let q = 0; q < allowedSparks; q++) {
        const sx = cx + this.rng.uniform(-C.EQ_WIDTH * 0.55, C.EQ_WIDTH * 0.55);
        const sy = this.rng.uniform(topY, eqBaseY);
        const vy = -this.rng.uniform(1.8, 4.8) * (0.7 + 0.6 * this.smoothAmp);
        const sLen = Math.floor(this.rng.uniform(5, 14));
        const life = Math.floor(this.rng.uniform(12, 24));
        const cType = Math.floor(this.rng.uniform(0, 3));
        this.sparks.push([sx, sy, vy, sLen, life, life, cType]);
      }

      const aliveSparks = [];
      for (const sp of this.sparks) {
        let sx = sp[0], sy = sp[1], vy = sp[2], sLen = sp[3], life = sp[4], maxLife = sp[5], cType = sp[6];
        sy += vy;
        life -= 1;
        if (life <= 0 || sy < topY - 35) continue;
        aliveSparks.push([sx, sy, vy, sLen, life, maxLife, cType]);

        const fade = Math.pow(life / maxLife, 0.8);
        let sCol = this.colCyan;
        if (cType === 1) sCol = this.colEmerald;
        else if (cType === 2) sCol = this.colGold;

        const shadedCol = scaleC(sCol, fade);
        const ix = Math.round(sx), iy = Math.round(sy), iyTail = Math.round(sy + sLen * fade);

        seg(g, ix, iy, ix, iyTail, css(shadedCol), 2);
        seg(t, ix, iy, ix, iyTail, 'rgb(255,255,255)', 1);
      }
      this.sparks = aliveSparks;

      // Composite and Draw
      const inten = clamp(C.GLOW + 0.12 * this.smoothAmp, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
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

    register({ key: 'cyber_helix', py: 31,order: 4, name: 'Cyber Helix Equalizer', tag: '3d dna double helix · laser rungs · peak hold eq deck · matrix sparks',
      defaults: { x: 175, y: 545, scale: 1 }, cls: CyberHelixEqualizer });
})();