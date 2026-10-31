(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

  /* =====================================================================================
   * CinematicHaloReactor   (Python: CinematicHaloReactor)
   * Local (0,0) around simulation, rendered at target (x, y) with scale.
   * ===================================================================================== */
  class CinematicHaloReactor {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        CORE_RADIUS: 42,
        NUM_BARS: 72,
        MAX_BAR_HEIGHT: 55,
        MAX_EMBERS: 250,
        LAYER_W: 320,
        LAYER_H: 320
      };
      // Colors (RGB format) - teal + amber cinematic grade
      this.colMap = {
        teal: [40, 210, 255],
        amber: [255, 160, 30],
        white: [255, 255, 255]
      };
      this.buildEnvelope();
      this.cp = new Map();
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
    }

    /* ---- speech envelope (Python: _prepare_envelope equivalent) ---- */
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
        e2[i] = Math.pow(clamp(env[i] / m, 0, 1), 0.7);
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
      this.rng = new RNG(42);
      const rng = this.rng;

      this.barPhases = new Float32Array(C.NUM_BARS);
      this.barFreqs = new Float32Array(C.NUM_BARS);
      this.smoothBars = new Float32Array(C.NUM_BARS);
      this.barAngles = new Float32Array(C.NUM_BARS);

      for (let i = 0; i < C.NUM_BARS; i++) {
        this.barPhases[i] = rng.uniform(0, 2 * Math.PI);
        this.barFreqs[i] = rng.uniform(0.9, 2.8);
        this.barAngles[i] = (i / C.NUM_BARS) * 2 * Math.PI;
      }

      this.ringTheta = new Float32Array(240);
      for (let i = 0; i < 240; i++) this.ringTheta[i] = (i / 240) * 2 * Math.PI;

      this.embers = [];          // [x, y, vx, vy, life, maxLife]
      this.shockwaves = [];      // [age, strength]
      this.smoothAmp = 0;
      this.prevAmp = 0;
      this.framesSinceBeat = 999;
      this.flash = 0;
      this.rotAcc = 0;
      this.f = -1;
    }

    spawnEmbers(count, speedLo, speedHi, strength) {
      const rng = this.rng, R = this.cfg.CORE_RADIUS;
      for (let i = 0; i < count; i++) {
        const ang = rng.uniform(0, 2 * Math.PI);
        const r = R + rng.uniform(0, 14);
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
        const spd = rng.uniform(speedLo, speedHi) * (0.6 + strength);
        const vx = Math.cos(ang) * spd, vy = Math.sin(ang) * spd;
        const life = Math.floor(rng.uniform(18, 46));
        this.embers.push([x, y, vx, vy, life, life]);
      }
    }

    snap() {
      return JSON.stringify({
        eb: this.embers, sw: this.shockwaves, sa: this.smoothAmp,
        pa: this.prevAmp, fsb: this.framesSinceBeat, fl: this.flash,
        ra: this.rotAcc, sb: Array.from(this.smoothBars), r: this.rng.s, f: this.f
      });
    }

    restore(js) {
      const o = JSON.parse(js);
      this.embers = o.eb; this.shockwaves = o.sw; this.smoothAmp = o.sa;
      this.prevAmp = o.pa; this.framesSinceBeat = o.fsb; this.flash = o.fl;
      this.rotAcc = o.ra; this.smoothBars = Float32Array.from(o.sb);
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

    /* ---- one frame of physics ---- */
    step(i) {
      const C = this.cfg, rng = this.rng;
      const amp = this.env[i] || 0, flux = this.flux[i] || 0;

      if (amp > this.smoothAmp) {
        this.smoothAmp = amp;
      } else {
        this.smoothAmp = this.smoothAmp * 0.45 + amp * 0.55;
      }

      const delta = amp - this.prevAmp;
      this.framesSinceBeat++;
      const beat = delta > 0.06 && amp > 0.12 && this.framesSinceBeat > 2;
      this.prevAmp = amp;

      this.flash *= 0.80;
      if (beat) {
        this.framesSinceBeat = 0;
        const strength = Math.min(1.0, 0.35 + delta * 4.0);
        this.flash = Math.max(this.flash, strength);
        this.shockwaves.push([0, strength]);
        if (this.shockwaves.length > 6) this.shockwaves.shift();
        this.spawnEmbers(Math.floor(12 * strength), 2.0, 7.0, strength);
      }

      if (amp > 0.1) {
        const cnt = Math.floor(amp * 2.5);
        if (cnt > 0) this.spawnEmbers(cnt, 0.8, 3.0, amp);
      }

      this.rotAcc += 0.012 + this.smoothAmp * 0.05;

      // update embers
      const aliveEmbers = [];
      for (const e of this.embers) {
        let x = e[0] + e[2], y = e[1] + e[3];
        e[2] *= 0.95; e[3] *= 0.95;
        const dist = Math.hypot(x, y) + 1e-4;
        const tx = -y / dist, ty = x / dist;
        e[2] += tx * 0.15; e[3] += ty * 0.15;
        e[4] -= 1;
        if (e[4] > 0) {
          aliveEmbers.push([x, y, e[2], e[3], e[4], e[5]]);
        }
      }
      if (aliveEmbers.length > C.MAX_EMBERS) {
        this.embers = aliveEmbers.slice(-C.MAX_EMBERS);
      } else {
        this.embers = aliveEmbers;
      }

      // update shockwaves
      const aliveWaves = [];
      for (const sw of this.shockwaves) {
        if (sw[0] < 16) {
          aliveWaves.push([sw[0] + 1, sw[1]]);
        }
      }
      this.shockwaves = aliveWaves;

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
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
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2); c.lineCap = 'round'; c.lineJoin = 'round';
      }

      const cx = 0, cy = 0, R = C.CORE_RADIUS, t_frame = this.f * 0.12;

      // 1. Inner energy core
      const coreR = Math.round(R * 0.20 + sa * 5);
      dot(g, cx, cy, coreR, css(scaleC(cm.white, 0.3 + 0.4 * sa)));

      // 2. Reactive waveform ring
      const rt = this.ringTheta;
      g.strokeStyle = css(scaleC(cm.teal, 0.5)); g.lineWidth = 4; g.beginPath();
      t.strokeStyle = css(cm.white); t.lineWidth = 2; t.beginPath();
      for (let k = 0; k < rt.length; k++) {
        const th = rt[k];
        const noise = 0.5 * Math.sin(3 * th + t_frame * 1.7) + 0.3 * Math.sin(5 * th - t_frame * 2.3) + 0.2 * Math.sin(9 * th + t_frame * 3.1);
        const lobes = noise * 0.5 + 0.5;
        const rad = R + sa * 16 * lobes;
        const rx = cx + Math.cos(th) * rad, ry = cy + Math.sin(th) * rad;
        if (k) { g.lineTo(rx, ry); t.lineTo(rx, ry); } else { g.moveTo(rx, ry); t.moveTo(rx, ry); }
      }
      g.closePath(); g.stroke();
      t.closePath(); t.stroke();

      // 3. Tapered radial bars
      for (let i = 0; i < C.NUM_BARS; i++) {
        const wave = Math.abs(Math.sin(this.f * 0.2 * this.barFreqs[i] + this.barPhases[i]));
        let target = sa * (0.2 + 0.8 * wave) * C.MAX_BAR_HEIGHT;
        target = Math.max(3.0, target);
        if (target > this.smoothBars[i]) this.smoothBars[i] = target;
        else this.smoothBars[i] = this.smoothBars[i] * 0.55 + target * 0.45;

        const h = this.smoothBars[i];
        const a = this.barAngles[i] + this.rotAcc * 0.25;
        const ca = Math.cos(a), sa_val = Math.sin(a);
        const r0 = R + 14, r1 = r0 + h;
        const x0 = cx + ca * r0, y0 = cy + sa_val * r0;
        const x1 = cx + ca * r1, y1 = cy + sa_val * r1;
        const barCol = lerpC(cm.teal, cm.amber, h / C.MAX_BAR_HEIGHT);
        seg(t, x0, y0, x1, y1, css(barCol), 3);
        seg(g, x0, y0, x1, y1, css(scaleC(barCol, 0.5)), 3);
      }

      // 4. Rotating HUD arcs
      const brightness = 0.25 + 0.35 * sa;
      const rotDeg = this.rotAcc * (180 / Math.PI);
      const radArc = R + C.MAX_BAR_HEIGHT + 16;
      for (let j = 0; j < 6; j++) {
        const start = rotDeg + j * 60;
        const colArc = css(scaleC(cm.teal, brightness));
        t.strokeStyle = colArc; t.lineWidth = 1; t.beginPath(); t.arc(cx, cy, radArc, (start) * Math.PI / 180, (start + 30) * Math.PI / 180); t.stroke();
      }

      // 5. Shockwave rings
      for (const sw of this.shockwaves) {
        const age = sw[0], st = sw[1];
        const prog = age / 16.0;
        if (prog >= 1.0) continue;
        const rad = R + 8 + age * (4 + 3 * st);
        const fade = Math.pow(1 - prog, 1.2) * st;
        ring(g, cx, cy, rad, css(scaleC(cm.white, fade * 0.6)), 2);
        ring(t, cx, cy, rad, css(scaleC(cm.white, fade)), 2);
      }

      // 6. Embers (sparks)
      for (const e of this.embers) {
        const k = e[4] / e[5];
        const emberCol = lerpC(cm.amber, cm.white, Math.pow(k, 0.5));
        dot(t, e[0], e[1], 1.5, css(emberCol));
      }

      // Composite and Draw
      const inten = clamp(0.32 + 0.14 * sa, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
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


    register( { key: 'halo_reactor', py: 20, order: 2,name: 'Cinematic Halo Reactor', tag: 'halo ring · radial bars · embers · hud',
      defaults: { x: 160, y: 565, scale: 1 }, cls: CinematicHaloReactor });
})();