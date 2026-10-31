(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;
/* =====================================================================================
   QuantumNeuralReactor
   Advanced audio-reactive quantum core, orbital rings, neural links,
   traveling energy packets, orbiting particles and expanding shockwaves.
   New class; does not replace CyberneticNeuralSwarm.
   Requires: FPS, clamp, css, scaleC, dot, seg, ring, lerpC, HAS_FILTER.
   ===================================================================================== */


/* =====================================================================================
   * QuantumNeuralReactor   -   Clean Visible Floating Rings & Connected Nodes
   * ===================================================================================== */
  class QuantumNeuralReactor {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));

      this.cfg = {
        NODES: 28,
        CORE_R: 16,
        ORBIT_RX: 105,
        ORBIT_RY: 75,
        LAYER_W: 440,
        LAYER_H: 440,
        MAX_SIGNALS: 60,
        MAX_WAVES: 6
      };

      this.col = {
        cyan: [35, 245, 255],
        blue: [35, 110, 255],
        violet: [170, 55, 255],
        magenta: [255, 45, 195],
        gold: [255, 220, 75],
        white: [255, 255, 255]
      };

      this.seed = 782341;
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = document.createElement('canvas');
      this.g = null;
      this.t = null;
      this.cp = new Map();

      this.buildEnvelope();
      this.reset();
    }

    rand() {
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }

    range(a, b) {
      return a + this.rand() * (b - a);
    }

    buildEnvelope() {
      const T = this.total;
      const a = this.audio;
      const src = [];

      if (a && a.peaks && a.pps) {
        const start = Math.max(0, Math.round(this.t0 * a.pps));
        const end = Math.min(
          a.peaks.length,
          start + Math.round(this.dur * a.pps)
        );

        for (let i = start; i < end; i++) {
          src.push(Math.abs(a.peaks[i] || 0));
        }
      }

      this.env = new Float32Array(T);
      this.flux = new Float32Array(T);

      if (!src.length) return;

      let mx = 0;
      for (const v of src) mx = Math.max(mx, v);
      if (mx <= 1e-8) return;

      for (let i = 0; i < T; i++) {
        const f = T > 1 ? i * (src.length - 1) / (T - 1) : 0;
        const lo = Math.floor(f);
        const hi = Math.min(src.length - 1, lo + 1);
        const q = f - lo;

        this.env[i] = (
          src[lo] * (1 - q) + src[hi] * q
        ) / mx;
      }

      const raw = new Float32Array(this.env);

      for (let i = 0; i < T; i++) {
        let sum = 0, n = 0;

        for (let j = -2; j <= 2; j++) {
          const k = i + j;
          if (k < 0 || k >= T) continue;
          sum += raw[k];
          n++;
        }

        this.env[i] = Math.pow(sum / Math.max(1, n), 0.68);
      }

      for (let i = 1; i < T; i++) {
        this.flux[i] = Math.max(0, this.env[i] - this.env[i - 1]);
      }
    }

    reset() {
      const C = this.cfg;

      this.seed = 782341;
      this.f = -1;
      this.time = 0;
      this.amp = 0;
      this.ampVel = 0;
      this.energy = 0;
      this.cool = 0;

      this.nodes = [];

      for (let i = 0; i < C.NODES; i++) {
        const band = i % 3;
        const angle = this.range(0, Math.PI * 2);

        const radius = band === 0
          ? this.range(0.4, 0.65)
          : band === 1
            ? this.range(0.66, 0.85)
            : this.range(0.86, 1.05);

        this.nodes.push({
          a: angle,
          baseA: angle,
          band,
          radius,
          speed: this.range(0.2, 0.5) * (band === 1 ? -1 : 1),
          tilt: this.range(-0.35, 0.35),
          size: this.range(1.8, 3.2),
          charge: this.range(0.05, 0.4),
          ringOffset: this.range(0, Math.PI * 2), // Floating ring phase
          type: this.rand() < 0.25 ? 'gold' : (this.rand() < 0.55 ? 'magenta' : 'cyan')
        });
      }

      this.signals = [];
      this.waves = [];
    }

    snap() {
      return JSON.stringify({
        f: this.f,
        time: this.time,
        amp: this.amp,
        ampVel: this.ampVel,
        energy: this.energy,
        cool: this.cool,
        seed: this.seed,
        nodes: this.nodes,
        signals: this.signals,
        waves: this.waves
      });
    }

    restore(str) {
      const o = JSON.parse(str);

      this.f = o.f;
      this.time = o.time;
      this.amp = o.amp;
      this.ampVel = o.ampVel;
      this.energy = o.energy;
      this.cool = o.cool;
      this.seed = o.seed;

      this.nodes = o.nodes;
      this.signals = o.signals;
      this.waves = o.waves;
    }

    sync(k) {
      if (k === this.f) return;

      if (k < this.f || k - this.f > 400) {
        let b = Math.floor(k / 100) * 100;
        let state = null;

        while (b >= 0) {
          state = this.cp.get(b);
          if (state) break;
          b -= 100;
        }

        if (k < this.f || (state && b > this.f)) {
          if (state) this.restore(state);
          else this.reset();
        }
      }

      for (let i = this.f + 1; i <= k; i++) {
        this.step(i);
      }
    }

    step(i) {
      const env = this.env[i] || 0;
      const flux = this.flux[i] || 0;

      this.ampVel = this.ampVel * 0.58 +
        (env - this.amp) * (env > this.amp ? 0.45 : 0.2);

      this.amp = clamp(this.amp + this.ampVel, 0, 1.2);

      this.energy += (this.amp - this.energy) * 0.1;
      this.cool = Math.max(0, this.cool - 1);

      const beat = flux > 0.05 && this.cool === 0;

      if (beat) {
        this.cool = 4;
        this.waves.push({
          p: 0,
          speed: 0.015 + Math.min(0.02, flux * 0.08),
          power: clamp(0.3 + flux * 3, 0.3, 0.9)
        });

        if (this.waves.length > this.cfg.MAX_WAVES) {
          this.waves.shift();
        }
      }

      for (let n = 0; n < this.nodes.length; n++) {
        const nd = this.nodes[n];
        nd.a += nd.speed * (0.01 + this.amp * 0.015);
        nd.charge *= 0.9;

        if (n < 6) {
          nd.charge = Math.max(nd.charge, this.amp * 0.8);
        }

        if (beat && this.rand() < 0.6) {
          nd.charge = Math.max(nd.charge, 0.6 + this.rand() * 0.4);
        }
      }

      const active = [];
      for (const sg of this.signals) {
        sg.p += sg.speed * (1 + this.amp * 0.5);

        if (sg.p >= 1) {
          this.nodes[sg.to].charge = Math.min(
            1,
            this.nodes[sg.to].charge + 0.45
          );
        } else {
          active.push(sg);
        }
      }

      this.signals = active;

      const launchCount = Math.min(
        4,
        Math.floor(this.amp * 2) + (beat ? 4 : 0)
      );

      for (let q = 0; q < launchCount; q++) {
        if (this.signals.length >= this.cfg.MAX_SIGNALS) break;

        const from = Math.floor(this.rand() * 6);
        const candidates = [];

        for (let j = 0; j < this.nodes.length; j++) {
          if (j === from) continue;
          candidates.push(j);
        }

        if (!candidates.length) continue;

        const to = candidates[
          Math.floor(this.rand() * candidates.length)
        ];

        this.signals.push({
          from,
          to,
          p: 0,
          speed: this.range(0.02, 0.05)
        });
      }

      for (let j = this.waves.length - 1; j >= 0; j--) {
        const w = this.waves[j];
        w.p += w.speed;
        if (w.p >= 1) this.waves.splice(j, 1);
      }

      this.time = i / FPS;
      this.f = i;

      if (i % 100 === 0) {
        this.cp.set(i, this.snap());
        if (this.cp.size > 24) {
          this.cp.delete(this.cp.keys().next().value);
        }
      }
    }

    draw(ctx, x, y, s) {
      const C = this.cfg;
      const col = this.col;
      const amp = this.amp;
      const time = this.time;

      s = Math.max(0.1, s || 1);

      const LW = Math.ceil(C.LAYER_W * s);
      const LH = Math.ceil(C.LAYER_H * s);

      if (this.gc.width !== LW || this.gc.height !== LH) {
        this.gc.width = this.sc.width = LW;
        this.gc.height = this.sc.height = LH;
        this.g = this.t = null;
      }

      if (!this.g) {
        this.g = this.gc.getContext('2d');
        this.t = this.sc.getContext('2d');
      }

      const g = this.g;
      const t = this.t;

      for (const c of [g, t]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, LW, LH);
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2);
        c.lineCap = 'round';
        c.lineJoin = 'round';
      }

      const rx = C.ORBIT_RX;
      const ry = C.ORBIT_RY;

      // Clean background
      const bg = g.createRadialGradient(0, 0, 5, 0, 0, 180);
      bg.addColorStop(0, `rgba(20,50,110,${0.08 + amp * 0.1})`);
      bg.addColorStop(1, 'rgba(0,0,0,0)');

      g.fillStyle = bg;
      g.fillRect(-200, -200, 400, 400);

      // --- CONCENTRIC VISIBLE NESTED RINGS ---
      const rings = [45, 75, 105, 135];
      for (let idx = 0; idx < rings.length; idx++) {
        const r = rings[idx] + Math.sin(time * 1.5 + idx) * 2;
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.25 + amp * 0.2;
        g.strokeStyle = css(idx % 2 === 0 ? col.cyan : col.violet);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }

      // Shockwaves
      for (const w of this.waves) {
        const p = w.p;
        const fade = Math.pow(1 - p, 1.5);
        const r = 0.5 + p * 1.1;

        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = fade * w.power * 0.3;
        g.strokeStyle = css(col.cyan);
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(0, 0, rx * r, ry * r, 0, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }

      const points = [];
      for (let i = 0; i < this.nodes.length; i++) {
        const nd = this.nodes[i];
        const a = nd.a + nd.tilt * Math.sin(time * 0.6 + i);
        const pulse = 1 + amp * 0.04 + Math.sin(time * 1.8 + i) * 0.01;
        const r = nd.radius * pulse;

        let px = Math.cos(a) * rx * r;
        let py = Math.sin(a) * ry * r;
        py += Math.sin(a * 2 + time * 0.5) * 4;

        points.push({ x: px, y: py, node: nd, index: i });
      }

      // --- THIN LINES CONNECTING ALL NEARBY NODES (NEURAL NET) ---
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j];
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const limit = 50;

          if (d > limit) continue;

          const near = 1 - d / limit;
          const charge = (a.node.charge + b.node.charge) * 0.5;
          const alpha = near * (0.2 + charge * 0.5);

          g.save();
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = alpha;
          g.strokeStyle = css(col.cyan);
          g.lineWidth = 0.8; // Bahut patli aur saaf line[cite: 5]
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
          g.restore();
        }
      }

      // Signals
      for (const sg of this.signals) {
        const a = points[sg.from];
        const b = points[sg.to];
        if (!a || !b) continue;

        const px = a.x + (b.x - a.x) * sg.p;
        const py = a.y + (b.y - a.y) * sg.p;

        dot(g, px, py, 3, css(col.gold));
        dot(t, px, py, 1.2, css(col.white));
      }

      // --- NODES WITH CLEAR FLOATING VISIBLE OUTER CIRCLES ---
      for (const p of points) {
        const nd = p.node;
        const charge = nd.charge;
        let color = col.cyan;
        if (nd.type === 'gold') color = col.gold;
        else if (nd.type === 'magenta') color = col.magenta;

        // Outer circle jo halke-halke move/float karta hai[cite: 5]
        const floatOffset = Math.sin(time * 2.5 + nd.ringOffset) * 2;
        const ringRadius = 15 + floatOffset + (nd.type === 'gold' ? 3 : 0);

        t.save();
        t.globalAlpha = 0.65 + charge * 0.35;
        t.strokeStyle = css(color);
        t.lineWidth = 1.2;
        t.beginPath();
        t.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
        t.stroke();
        t.restore();

        // Node center dot
        dot(t, p.x, p.y, nd.size + charge * 2, css(color));
        dot(t, p.x, p.y, 1.2, css(col.white));
      }

      // Center core reactor
      const coreR = C.CORE_R * (1 + amp * 0.2);
      dot(t, 0, 0, coreR + 4, css(col.violet));
      dot(t, 0, 0, coreR, css(col.cyan));
      dot(t, 0, 0, coreR * 0.4, css(col.white));

      // Composite and Draw
      const ox = x - LW / 2;
      const oy = y - LH / 2;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.95;

      if (HAS_FILTER) {
        ctx.filter = 'blur(' + (1.2 * s).toFixed(2) + 'px)';
        ctx.drawImage(this.gc, ox, oy);
        ctx.filter = 'none';
      } else {
        const sw = Math.max(8, Math.ceil(LW / 3));
        const sh = Math.max(8, Math.ceil(LH / 3));
        if (this.bc.width !== sw || this.bc.height !== sh) {
          this.bc.width = sw;
          this.bc.height = sh;
        }
        const b = this.bc.getContext('2d');
        b.clearRect(0, 0, sw, sh);
        b.drawImage(this.gc, 0, 0, sw, sh);
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

    register({ key: 'quantum_neural_reactor', py: 32,order: 12, name: 'Quantum Neural Reactor', tag: 'Test',
     defaults: { x: 640, y: 360, scale: 1 }, cls: QuantumNeuralReactor });
})();