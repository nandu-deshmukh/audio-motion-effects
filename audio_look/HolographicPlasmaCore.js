(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

/* =====================================================================================
   * HolographicPlasmaCore   (Python: HolographicPlasmaCore)
   * 3D rotating wireframe sphere + travelling energy waves + tilted orbit rings with comets
   * ===================================================================================== */
  class HolographicPlasmaCore {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        NUM_PTS: 54,
        SPHERE_R: 34.0,
        LINK_DIST: 0.65,
        RING_R: [52.0, 60.0, 68.0],
        RING_SEG: 42,
        NUM_BARS: 50,
        BAR_IN: 75.0,
        BAR_MAX: 22.0,
        GLOW: 0.34,
        LAYER_W: 460,
        LAYER_H: 460
      };

      // Palette (RGB format)
      this.colCyan = [40, 235, 255];
      this.colDeep = [15, 90, 200];
      this.colMagenta = [255, 50, 215];
      this.colGold = [255, 210, 60];

      this.buildEnvelope();
      this.initGeometry();

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

    initGeometry() {
      const C = this.cfg, n = C.NUM_PTS;
      this.sph = [];
      for (let i = 0; i < n; i++) {
        const idx = i + 0.5;
        const phi = Math.acos(1 - 2 * idx / n);
        const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
        this.sph.push([
          Math.cos(theta) * Math.sin(phi),
          Math.cos(phi),
          Math.sin(theta) * Math.sin(phi)
        ]);
      }

      this.edges = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = this.sph[i][0] - this.sph[j][0];
          const dy = this.sph[i][1] - this.sph[j][1];
          const dz = this.sph[i][2] - this.sph[j][2];
          if (Math.hypot(dx, dy, dz) < C.LINK_DIST) {
            this.edges.push([i, j]);
          }
        }
      }

      this.unitRings = [];
      const ringTilts = [[1.1, 0.0], [0.4, 1.2], [-0.8, -0.6]];
      for (let ri = 0; ri < 3; ri++) {
        const pts = [];
        for (let s = 0; s <= C.RING_SEG; s++) {
          const a = (s / C.RING_SEG) * 2 * Math.PI;
          pts.push([Math.cos(a), Math.sin(a), 0]);
        }
        this.unitRings.push({ pts, tilt: ringTilts[ri] });
      }

      const rng = new RNG(77);
      this.barPhases = [];
      this.barFreqs = [];
      for (let k = 0; k < C.NUM_BARS; k++) {
        this.barPhases.push(rng.uniform(0, 2 * Math.PI));
        this.barFreqs.push(rng.uniform(0.6, 1.6));
      }
    }

    reset() {
      const C = this.cfg;
      this.smoothAmp = 0;
      this.ampVel = 0;
      this.cooldown = 0;
      this.spin = 0;
      this.bars = new Float32Array(C.NUM_BARS);
      this.shocks = [];
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        ba: Array.from(this.bars), sh: this.shocks, sa: this.smoothAmp,
        av: this.ampVel, cd: this.cooldown, sp: this.spin, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.bars = Float32Array.from(o.ba);
      this.shocks = o.sh; this.smoothAmp = o.sa; this.ampVel = o.av;
      this.cooldown = o.cd; this.spin = o.sp; this.f = o.f;
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

      const stiff = env > this.smoothAmp ? 0.52 : 0.28;
      this.ampVel = this.ampVel * 0.58 + (env - this.smoothAmp) * stiff;
      this.smoothAmp = clamp(this.smoothAmp + this.ampVel, 0, 1.25);

      this.cooldown = Math.max(0, this.cooldown - 1);
      const isBeat = flux > 0.075 && this.cooldown === 0;
      if (isBeat) {
        this.cooldown = 3;
        this.shocks.push([C.SPHERE_R * 1.1, 1.0]);
      }

      this.spin += 0.025 + this.smoothAmp * 0.08;

      const alive = [];
      for (const sh of this.shocks) {
        sh[0] += 3.6;
        sh[1] -= 0.045;
        if (sh[1] > 0) alive.push(sh);
      }
      this.shocks = alive;

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
    }

    rotMatrix(ax, ay, az) {
      const cx = Math.cos(ax), sx = Math.sin(ax);
      const cy = Math.cos(ay), sy = Math.sin(ay);
      const cz = Math.cos(az), sz = Math.sin(az);
      return [
        [cy*cz, sz*sy*cx - cz*sx, sz*sx + cz*sy*cx],
        [cy*sz, cz*cx + sz*sy*sx, cz*sy*sx - sz*cx],
        [-sy,   cy*sx,            cy*cx]
      ];
    }

    mulMatVec(m, v) {
      return [
        m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
        m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
        m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2]
      ];
    }

    project(pt, scale) {
      const persp = 1.0 + 0.22 * pt[2];
      return [pt[0] * scale * persp, pt[1] * scale * persp, pt[2]];
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
      const isBeat = this.shocks.some(sh => sh[0] < C.SPHERE_R * 1.5);

      // 1. Radial Voice Spectrum (outer bars) - FIXED barFreqs
      const t_time = this.f * 0.35;
      for (let k = 0; k < C.NUM_BARS; k++) {
        let target = Math.pow(this.smoothAmp * (0.30 + 0.70 * (0.5 + 0.5 * Math.sin(t_time * this.barFreqs[k] + this.barPhases[k]))), 1.3);
        if (isBeat) target = Math.min(1.2, target + 0.25);
        this.bars[k] = Math.max(this.bars[k] * 0.78, target);

        const ang = (k / C.NUM_BARS) * 2 * Math.PI + this.f * 0.008;
        const r0 = C.BAR_IN;
        const r1 = r0 + 3 + this.bars[k] * C.BAR_MAX;
        const p0x = cx + r0 * Math.cos(ang), p0y = cy + r0 * Math.sin(ang);
        const p1x = cx + r1 * Math.cos(ang), p1y = cy + r1 * Math.sin(ang);

        let col = lerpC(this.colDeep, this.colMagenta, this.bars[k]);
        if (this.bars[k] > 0.75) col = lerpC(col, this.colGold, (this.bars[k] - 0.75) * 3.0);

        seg(g, p0x, p0y, p1x, p1y, css(col), 4);
        seg(t, p0x, p0y, p1x, p1y, css(col), 2);
      }

      // 2. Beat Shockwaves
      for (const sh of this.shocks) {
        const col = scaleC(this.colCyan, sh[1] * 0.9);
        const r = Math.round(sh[0]);
        ring(g, cx, cy, r, css(col), 3);
        ring(t, cx, cy, r, css(col), 1);
      }

      // 3. Orbit Rings + Comets
      const M = this.rotMatrix(0.45 + 0.15 * Math.sin(this.f * 0.02), this.spin, 0.2);
      for (let ri = 0; ri < 3; ri++) {
        const ringObj = this.unitRings[ri];
        const RM = this.rotMatrix(ringObj.tilt[0] + this.f * 0.008 * (ri + 1), ringObj.tilt[1] + this.f * 0.012, this.f * 0.015 * (ri - 1));
        const rad = (C.RING_R[ri] / C.SPHERE_R) * (1.0 + 0.10 * this.smoothAmp);

        const projPts = [];
        for (let pt of ringObj.pts) {
          const r1 = this.mulMatVec(RM, [pt[0]*rad, pt[1]*rad, pt[2]*rad]);
          const r2 = this.mulMatVec(M, r1);
          projPts.push(this.project(r2, C.SPHERE_R));
        }

        const ringCol = scaleC(lerpC(this.colDeep, this.colCyan, 0.25 + 0.5 * this.smoothAmp), 0.35 + 0.4 * this.smoothAmp);
        g.strokeStyle = css(ringCol); g.lineWidth = 2; g.beginPath();
        g.moveTo(projPts[0][0], projPts[0][1]); for (let p of projPts) g.lineTo(p[0], p[1]);
        g.stroke();

        t.strokeStyle = css(ringCol); t.lineWidth = 1; t.beginPath();
        t.moveTo(projPts[0][0], projPts[0][1]); for (let p of projPts) t.lineTo(p[0], p[1]);
        t.stroke();

        // Comet (Safe positive angle normalization)
        const head = (this.f * (0.07 + 0.03 * ri) * (1.0 + 2.2 * this.smoothAmp) + ri * 2.1) % (2 * Math.PI);
        for (let tcount = 0; tcount < 10; tcount++) {
          let a = head - tcount * 0.07;
          // FIX: Ensure angle is strictly positive to prevent negative array indexing
          const normA = ((a % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
          const pos = Math.min(C.RING_SEG, Math.floor((normA / (2 * Math.PI)) * C.RING_SEG));
          
          if (projPts[pos]) {
            const px = projPts[pos][0], py = projPts[pos][1];
            const f_fac = 1.0 - tcount / 10.0;
            const c = lerpC(this.colCyan, ri !== 1 ? this.colGold : this.colMagenta, 0.6);
            dot(g, px, py, Math.max(1, 4 * f_fac), css(scaleC(c, f_fac)));
            if (tcount < 3) dot(t, px, py, Math.max(1, 2.2 * f_fac), 'rgb(255,255,255)');
          }
        }
      }

      // 4. Wireframe Plasma Sphere
      const sphereScale = C.SPHERE_R * (1.0 + 0.40 * this.smoothAmp);
      const projSph = [];
      const charge = [];
      for (let i = 0; i < C.NUM_PTS; i++) {
        const r1 = this.mulMatVec(M, this.sph[i]);
        projSph.push(this.project(r1, sphereScale));
        const wave = Math.max(0, Math.sin(this.sph[i][1] * 4.5 - this.f * 0.35)) * this.smoothAmp;
        charge.push(Math.min(1.0, wave * 1.1 + (isBeat ? 0.12 : 0.0)));
      }

      for (const edge of this.edges) {
        const i = edge[0], j = edge[1];
        const depth = 0.35 + 0.65 * ((projSph[i][2] + projSph[j][2]) * 0.25 + 0.5);
        const ch = (charge[i] + charge[j]) * 0.5;
        let col = lerpC(this.colDeep, this.colCyan, 0.25 + ch);
        if (ch > 0.5) col = lerpC(col, this.colMagenta, (ch - 0.5) * 1.6);
        col = scaleC(col, depth * (0.55 + 0.45 * ch));

        seg(g, projSph[i][0], projSph[i][1], projSph[j][0], projSph[j][1], css(col), 2);
        seg(t, projSph[i][0], projSph[i][1], projSph[j][0], projSph[j][1], css(col), 1);
      }

      for (let i = 0; i < C.NUM_PTS; i++) {
        const depth = 0.4 + 0.6 * (projSph[i][2] * 0.5 + 0.5);
        const ch = charge[i];
        const col = scaleC(lerpC(this.colCyan, this.colGold, ch), depth);
        const r = 1 + Math.round(ch * 2.5 + (projSph[i][2] > 0.3 ? 1 : 0));
        dot(g, projSph[i][0], projSph[i][1], r + 2, css(col));
        dot(t, projSph[i][0], projSph[i][1], r, css(scaleC([255, 255, 255], 0.5 + 0.5 * depth)));
      }

      // 5. Hot Core
      const coreR = Math.round(5 + this.smoothAmp * 9);
      const coreCol = lerpC(this.colCyan, this.colMagenta, this.smoothAmp);
      dot(g, cx, cy, coreR + 8, css(coreCol));
      dot(t, cx, cy, coreR, css(coreCol));
      dot(t, cx, cy, Math.max(2, coreR - 3), 'rgb(255,255,255)');

      // Composite and Draw
      const inten = clamp(C.GLOW + 0.16 * this.smoothAmp, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
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



    register( { key: 'holographic_plasma_core', py: 30,order: 8, name: 'Holographic Plasma Core', tag: '3d sphere wireframe · orbit rings · comets · radial spectrum',
      defaults: { x: 185, y: 555, scale: 1 }, cls: HolographicPlasmaCore });
})();