(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

  /* =====================================================================================
   * QuantumPrismSynthesizer   (Python: QuantumPrismSynthesizer)
   * 3D Levitating Octahedron Crystal + Scrolling Perspective Sound-Terrain + Procedural Lightning
   * ===================================================================================== */
  class QuantumPrismSynthesizer {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        CRYSTAL_Y_OFFSET: -45,
        CRYSTAL_BASE_SIZE: 32.0,
        CRYSTAL_MAX_PULSE: 22.0,
        FOV: 280.0,
        CAM_DIST: 190.0,
        GRID_ROWS: 10,
        GRID_COLS: 13,
        TERRAIN_WIDTH: 180.0,
        TERRAIN_DEPTH: 100.0,
        TERRAIN_BASE_Y: 70.0,
        MAX_WAVE_HEIGHT: 40.0,
        GLOW: 0.35,
        LAYER_W: 500,
        LAYER_H: 450
      };

      // Palette (RGB format)
      this.colIceBlue = [80, 230, 255];
      this.colCrimson = [255, 30, 90];
      this.colViolet = [175, 60, 240];
      this.colGold = [255, 225, 60];
      this.colWhite = [255, 255, 255];

      // Octahedron 6 Vertices in 3D space
      this.baseVertices = [
        [0.0, -1.35, 0.0],
        [0.0,  1.35, 0.0],
        [-1.0, 0.0, -1.0],
        [ 1.0, 0.0, -1.0],
        [ 1.0, 0.0,  1.0],
        [-1.0, 0.0,  1.0]
      ];

      // 12 Edges
      this.crystalEdges = [
        [0, 2], [0, 3], [0, 4], [0, 5],
        [1, 2], [1, 3], [1, 4], [1, 5],
        [2, 3], [3, 4], [4, 5], [5, 2]
      ];

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
      this.rng = new RNG(77);
      this.smoothAmp = 0;
      this.ampVel = 0;
      this.beatFlash = 0;
      this.yaw = 0;
      this.cooldown = 0;

      this.terrainHeights = [];
      for (let r = 0; r < C.GRID_ROWS; r++) {
        this.terrainHeights.push(new Float32Array(C.GRID_COLS));
      }
      this.f = -1;
    }

    snap() {
      return JSON.stringify({
        th: this.terrainHeights, sa: this.smoothAmp, av: this.ampVel,
        bf: this.beatFlash, yw: this.yaw, cd: this.cooldown, r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.terrainHeights = o.th.map(row => Float32Array.from(row));
      this.smoothAmp = o.sa; this.ampVel = o.av; this.beatFlash = o.bf;
      this.yaw = o.yw; this.cooldown = o.cd; this.rng.s = o.r; this.f = o.f;
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
      this.smoothAmp = clamp(this.smoothAmp + this.ampVel, 0, 1.25);

      this.cooldown = Math.max(0, this.cooldown - 1);
      const isBeat = flux > 0.075 && this.cooldown === 0;
      if (isBeat) {
        this.cooldown = 2;
        this.beatFlash = Math.min(1.0, this.beatFlash + 0.80);
      } else {
        this.beatFlash *= 0.78;
      }

      this.yaw += 0.05 + this.smoothAmp * 0.16;

      for (let r = C.GRID_ROWS - 1; r > 0; r--) {
        for (let c = 0; c < C.GRID_COLS; c++) {
          this.terrainHeights[r][c] = this.terrainHeights[r - 1][c] * 0.88 + this.terrainHeights[r][c] * 0.12;
        }
      }

      for (let c = 0; c < C.GRID_COLS; c++) {
        const xNorm = -1.0 + (c / (C.GRID_COLS - 1)) * 2.0;
        const bell = Math.exp(-2.2 * (xNorm * xNorm));
        const wave = 0.65 + 0.35 * Math.cos(xNorm * 4.5 + i * 0.35) + 0.25 * Math.sin(xNorm * 8.0 - i * 0.5);
        this.terrainHeights[0][c] = this.smoothAmp * C.MAX_WAVE_HEIGHT * bell * clamp(wave, 0.2, 1.4);
      }

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
    }

    project3D(x, y, z, cx, cy) {
      const C = this.cfg;
      const zDist = Math.max(10.0, C.CAM_DIST + z);
      const scale = C.FOV / zDist;
      return [Math.round(cx + x * scale), Math.round(cy + y * scale), scale];
    }

    drawLightning(c, p1, p2, colGlow) {
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const length = Math.hypot(dx, dy) + 1e-5;
      const nx = -dy / length, ny = dx / length;
      const segs = 6, jitter = 11.0;
      const pts = [[p1[0], p1[1]]];

      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        let bx = p1[0] + dx * t, by = p1[1] + dy * t;
        const offset = this.rng.uniform(-jitter, jitter) * Math.sin(t * Math.PI);
        bx += nx * offset; by += ny * offset;
        pts.push([Math.round(bx), Math.round(by)]);
      }
      pts.push([p2[0], p2[1]]);

      c.strokeStyle = css(colGlow); c.lineWidth = 4; c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) c.lineTo(pts[k][0], pts[k][1]);
      c.stroke();
    }

    draw(ctx, x, y, s) {
      const C = this.cfg;
      const LW = Math.ceil(C.LAYER_W * s), LH = Math.ceil(C.LAYER_H * s);
      if (this.gc.width !== LW || this.gc.height !== LH) { this.gc.width = this.sc.width = LW; this.gc.height = this.sc.height = LH; this.g = null; }
      if (!this.g) { this.g = this.gc.getContext('2d'); this.t = this.sc.getContext('2d'); }
      const g = this.g, t = this.t;  // <-- FIX: `t` is now correctly referencing this.t (2D Context)
      for (const c of [g, t]) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, LW, LH);
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2); c.lineCap = 'round'; c.lineJoin = 'round';
      }

      const cx = 0, cy = 0;
      const cycle = 0.5 + 0.5 * Math.sin(this.f * 0.035);
      const colCrystal = lerpC(this.colIceBlue, this.colCrimson, cycle);
      const colTerrainFront = lerpC(this.colCrimson, this.colIceBlue, cycle);
      const colAccent = lerpC(colCrystal, this.colGold, this.beatFlash);

      // Terrain Grid Projection
      const projGrid = [];
      for (let r = 0; r < C.GRID_ROWS; r++) {
        const rowPts = [];
        const zDepth = (r / (C.GRID_ROWS - 1)) * C.TERRAIN_DEPTH;
        for (let c = 0; c < C.GRID_COLS; c++) {
          const xNorm = -1.0 + (c / (C.GRID_COLS - 1)) * 2.0;
          const x3d = xNorm * (C.TERRAIN_WIDTH * 0.5);
          const y3d = C.TERRAIN_BASE_Y - this.terrainHeights[r][c];
          rowPts.push(this.project3D(x3d, y3d, zDepth, cx, cy));
        }
        projGrid.push(rowPts);
      }

      for (let r = C.GRID_ROWS - 1; r >= 0; r--) {
        const depthFade = 1.0 - (r / C.GRID_ROWS) * 0.72;
        const rowCol = scaleC(lerpC(colTerrainFront, this.colViolet, r / C.GRID_ROWS), depthFade);
        const pts = projGrid[r];
        const thick = (r === 0) ? 2 : 1;

        g.strokeStyle = css(rowCol); g.lineWidth = thick + 2; g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]); for (let c = 1; c < pts.length; c++) g.lineTo(pts[c][0], pts[c][1]);
        g.stroke();

        t.strokeStyle = css(rowCol); t.lineWidth = thick; t.beginPath();
        t.moveTo(pts[0][0], pts[0][1]); for (let c = 1; c < pts.length; c++) t.lineTo(pts[c][0], pts[c][1]);
        t.stroke();
      }

      // Crystal Projection
      const yaw = this.yaw, pitch = 0.28 * Math.sin(this.f * 0.04), roll = 0.20 * Math.cos(this.f * 0.03);
      const cy_cos = Math.cos(yaw), sy_sin = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cr = Math.cos(roll), sr = Math.sin(roll);

      const cScale = C.CRYSTAL_BASE_SIZE + this.smoothAmp * C.CRYSTAL_MAX_PULSE;
      const bobY = Math.sin(this.f * 0.12) * 4.5;
      const crystalY = cy + C.CRYSTAL_Y_OFFSET + bobY;

      const verts2d = [];
      for (let i = 0; i < this.baseVertices.length; i++) {
        let vx = this.baseVertices[i][0] * cScale, vy = this.baseVertices[i][1] * cScale, vz = this.baseVertices[i][2] * cScale;
        let x1 = vx * cy_cos + vz * sy_sin, y1 = vy, z1 = -vx * sy_sin + vz * cy_cos;
        let x2 = x1, y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
        let vxRot = x2 * cr - y2 * sr, vyRot = x2 * sr + y2 * cr, vzRot = z2;

        verts2d.push(this.project3D(vxRot, vyRot, vzRot, cx, crystalY));
      }

      dot(g, cx, Math.round(crystalY), Math.round(8 + 10 * this.smoothAmp), css(colAccent));
      dot(t, cx, Math.round(crystalY), 4, 'rgb(255,255,255)');

      for (const edge of this.crystalEdges) {
        const p1 = verts2d[edge[0]], p2 = verts2d[edge[1]];
        const avgZ = (p1[2] + p2[2]) * 0.5;
        const depthFactor = clamp(0.75 - avgZ / (cScale * 2.0), 0.35, 1.0);
        const edgeCol = scaleC(colAccent, depthFactor);

        seg(g, p1[0], p1[1], p2[0], p2[1], css(edgeCol), 3);
        seg(t, p1[0], p1[1], p2[0], p2[1], css(edgeCol), 1.5);
      }

      if (this.smoothAmp > 0.22 || this.beatFlash > 0.1) {
        const bottomTip = [verts2d[1][0], verts2d[1][1]];
        const targetPt = projGrid[0][Math.floor(C.GRID_COLS / 2)];
        const boltCol = lerpC(this.colIceBlue, this.colGold, this.beatFlash);
        this.drawLightning(t, bottomTip, targetPt, boltCol);
      }

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

    register({ key: 'quantum_prism', py: 27,order: 13, name: 'Quantum Prism Synthesizer', tag: '3d octahedron crystal · perspective sound terrain · lightning',
      defaults: { x: 185, y: 555, scale: 1 }, cls: QuantumPrismSynthesizer });
})();