/* audio_look/CyberneticNeuralSwarm.js   (Python: audio_look/CyberneticNeuralSwarm.py, id 19)
 * Anchor ab dynamic hai: simulation local (0,0) ke around chalta hai, render time par (x, y) par rakha jata hai.
 */
(function () {
  'use strict';
  const { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register } = window.AUDIO_KIT;

  class CyberneticNeuralSwarm {
    constructor(o) {
      o = o || {};
      this.audio = o.audio || null;
      this.t0 = o.t0 || 0;
      this.dur = o.dur || 1;
      this.total = Math.max(1, Math.round(this.dur * FPS));
      this.cfg = {
        NUM_NODES: 26, FIELD_RX: 82, FIELD_RY: 72, CONNECT_DIST: 54, MAX_SIGNALS: 65,
        OSC_POINTS: 45, OSC_WIDTH: 150, GLOW: 0.32, LAYER_W: 360, LAYER_H: 320
      };
      // palette (Python me BGR tha, yahan RGB)
      this.col = { aqua: [50, 240, 255], deep: [20, 110, 230], violet: [195, 55, 245], gold: [255, 225, 55], white: [255, 255, 255] };
      this.buildEnvelope();
      this.cp = new Map();                       // checkpoints (har 100 frame) -> tez seek
      this.gc = document.createElement('canvas');
      this.sc = document.createElement('canvas');
      this.bc = null;
      this.reset();
    }

    /* ---- speech envelope (Python: _prepare_envelope) ---- */
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

    /* ---- state ---- */
    reset() {
      const C = this.cfg;
      this.rng = new RNG(55);
      const rng = this.rng;
      this.nodes = [];                           // [home_x, home_y, cur_x, cur_y, vx, vy, charge, tier]
      for (let i = 0; i < C.NUM_NODES; i++) {
        let ang, rx, ry, tier;
        if (i < 5) { ang = (i / 5) * 2 * Math.PI; rx = 18; ry = 16; tier = 0; }
        else { ang = rng.uniform(0, 2 * Math.PI); const dist = rng.uniform(0.38, 1.0); rx = dist * C.FIELD_RX; ry = dist * C.FIELD_RY; tier = 1; }
        const hx = rx * Math.cos(ang), hy = ry * Math.sin(ang);
        this.nodes.push([hx, hy, hx, hy, rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), 0, tier]);
      }
      this.signals = [];                         // [from, to, progress, speed, colorType]
      this.osc = new Float32Array(C.OSC_POINTS);
      this.smooth = 0; this.ampVel = 0; this.cool = 0;
      this.dEdges = []; this.dSig = [];
      this.f = -1;
    }
    snap() {
      return JSON.stringify({ n: this.nodes, sg: this.signals, o: Array.from(this.osc), sm: this.smooth, av: this.ampVel, cd: this.cool, r: this.rng.s, de: this.dEdges, ds: this.dSig, f: this.f });
    }
    restore(js) {
      const o = JSON.parse(js);
      this.nodes = o.n; this.signals = o.sg; this.osc = Float32Array.from(o.o); this.smooth = o.sm; this.ampVel = o.av;
      this.cool = o.cd; this.rng.s = o.r; this.dEdges = o.de; this.dSig = o.ds; this.f = o.f;
    }
    sync(k) {                                    // state ko frame k par le aao (seek-safe)
      if (k === this.f) return;
      if (k < this.f || k - this.f > 400) {
        let b = Math.floor(k / 100) * 100, s = null;
        while (b >= 0) { s = this.cp.get(b); if (s) break; b -= 100; }
        if (k < this.f || (s && b > this.f)) { if (s) this.restore(s); else this.reset(); }
      }
      for (let i = this.f + 1; i <= k; i++) this.step(i);
    }

    /* ---- one frame of physics (Python render loop steps 1-4 aur 7) ---- */
    step(i) {
      const C = this.cfg, N = C.NUM_NODES, rng = this.rng, nodes = this.nodes;
      const env = this.env[i] || 0, flux = this.flux[i] || 0;

      const stiff = env > this.smooth ? 0.52 : 0.28;
      this.ampVel = this.ampVel * 0.58 + (env - this.smooth) * stiff;
      this.smooth = clamp(this.smooth + this.ampVel, 0, 1.25);
      const sa = this.smooth;
      this.cool = Math.max(0, this.cool - 1);
      const beat = flux > 0.075 && this.cool === 0;
      if (beat) this.cool = 2;

      const osc = this.osc;
      for (let k = osc.length - 1; k > 0; k--) osc[k] = osc[k - 1];
      osc[0] = sa * Math.sin(i * 0.85);

      // neurons
      const ex = 1 + sa * 0.28;
      for (let n = 0; n < N; n++) {
        const nd = nodes[n];
        let cx = nd[2], cy = nd[3], vx = nd[4], vy = nd[5], charge = nd[6];
        let tx = nd[0] * ex, ty = nd[1] * ex;
        const sw = i * 0.03 + n * 0.7;
        tx += Math.cos(sw) * (5 + sa * 6);
        ty += Math.sin(sw) * (5 + sa * 6);
        vx = vx * 0.78 + (tx - cx) * 0.16;
        vy = vy * 0.78 + (ty - cy) * 0.16;
        cx += vx; cy += vy;
        charge *= 0.84;
        if (nd[7] === 0) charge = Math.max(charge, sa * 0.95);
        nd[2] = cx; nd[3] = cy; nd[4] = vx; nd[5] = vy; nd[6] = clamp(charge, 0, 1);
      }

      // proximity graph
      const edges = [], adj = [];
      for (let n = 0; n < N; n++) adj.push([]);
      const maxd = C.CONNECT_DIST * (1 + sa * 0.22);
      for (let a = 0; a < N; a++) {
        for (let b = a + 1; b < N; b++) {
          const d = Math.hypot(nodes[b][2] - nodes[a][2], nodes[b][3] - nodes[a][3]);
          if (d < maxd) { edges.push([a, b, 1 - d / maxd, (nodes[a][6] + nodes[b][6]) * 0.5]); adj[a].push(b); adj[b].push(a); }
        }
      }
      this.dEdges = edges;

      // spawn signals
      let nf = Math.floor(sa * 3.5) + (beat ? 5 : 0);
      nf = Math.min(nf, C.MAX_SIGNALS - this.signals.length);
      for (let q = 0; q < nf; q++) {
        const src = rng.randint(0, 5);
        if (adj[src].length > 0) {
          const dst = rng.choice(adj[src]);
          const spd = rng.uniform(0.12, 0.22) * (1 + 0.5 * sa);
          const ct = beat ? 1 : (rng.rand() < 0.35 ? 1 : 0);
          this.signals.push([src, dst, 0, spd, ct]);
        }
      }

      // travel + chain reaction
      const act = [], ds = [];
      for (const sg of this.signals) {
        const src = sg[0], dst = sg[1], spd = sg[3], ct = sg[4];
        const prog = sg[2] + spd;
        const x1 = nodes[src][2], y1 = nodes[src][3], x2 = nodes[dst][2], y2 = nodes[dst][3];
        if (prog >= 1) {
          nodes[dst][6] = Math.min(1, nodes[dst][6] + 0.75);
          if (sa > 0.25 && adj[dst].length > 0 && act.length < C.MAX_SIGNALS && rng.rand() < 0.35) {
            const nx = rng.choice(adj[dst]);
            if (nx !== src) act.push([dst, nx, 0, spd * 0.95, ct]);
          }
          continue;
        }
        act.push([src, dst, prog, spd, ct]);
        const tp = Math.max(0, prog - 0.22);
        ds.push([x1 + (x2 - x1) * tp, y1 + (y2 - y1) * tp, x1 + (x2 - x1) * prog, y1 + (y2 - y1) * prog, ct]);
      }
      this.signals = act; this.dSig = ds;

      this.f = i;
      if (i % 100 === 0) this.cp.set(i, this.snap());
    }

    /* ---- drawing (Python steps 5, 6, 7(draw), 8, 9) ---- */
    draw(ctx, x, y, s) {
      const C = this.cfg, col = this.col, sa = this.smooth, nodes = this.nodes;
      const LW = Math.ceil(C.LAYER_W * s), LH = Math.ceil(C.LAYER_H * s);
      if (this.gc.width !== LW || this.gc.height !== LH) { this.gc.width = this.sc.width = LW; this.gc.height = this.sc.height = LH; this.g = null; }
      if (!this.g) { this.g = this.gc.getContext('2d'); this.t = this.sc.getContext('2d'); }
      const g = this.g, t = this.t;
      for (const c of [g, t]) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, LW, LH);
        c.setTransform(s, 0, 0, s, LW / 2, LH / 2); c.lineCap = 'round'; c.lineJoin = 'round';
      }

      // voice-print oscilloscope
      const oc = css(scaleC(col.violet, 0.35 + 0.45 * sa)), OP = C.OSC_POINTS;
      for (const [c, w] of [[g, 3], [t, 1]]) {
        c.strokeStyle = oc; c.lineWidth = w; c.beginPath();
        for (let k = 0; k < OP; k++) {
          const fr = k / (OP - 1), ox = -C.OSC_WIDTH * 0.5 + fr * C.OSC_WIDTH, oy = this.osc[k] * 28 * Math.sin(fr * Math.PI);
          if (k) c.lineTo(ox, oy); else c.moveTo(ox, oy);
        }
        c.stroke();
      }

      // synapses
      for (const e of this.dEdges) {
        const a = nodes[e[0]], b = nodes[e[1]], ac = e[3];
        const base = lerpC(col.deep, col.aqua, ac), al = clamp(e[2] * (0.35 + 0.65 * ac), 0.15, 1), ec = css(scaleC(base, al));
        seg(g, a[2], a[3], b[2], b[3], ec, 2);
        seg(t, a[2], a[3], b[2], b[3], ec, 1);
      }

      // travelling action potentials
      for (const p of this.dSig) {
        seg(g, p[0], p[1], p[2], p[3], css(lerpC(col.aqua, col.gold, p[4])), 4);
        seg(t, p[0], p[1], p[2], p[3], 'rgb(255,255,255)', 2);
        dot(t, p[2], p[3], 2, 'rgb(255,255,255)');
      }

      // neurons
      for (const nd of nodes) {
        const cx = nd[2], cy = nd[3], ch = nd[6], base = nd[7] === 0 ? 4 : 2;
        const r = Math.round(base + ch * 4.5);
        let nc = lerpC(col.aqua, col.violet, ch);
        if (ch > 0.65) nc = lerpC(nc, col.gold, (ch - 0.65) * 2.5);
        const ncs = css(nc);
        dot(g, cx, cy, r + 3, ncs);
        dot(t, cx, cy, r, ncs);
        dot(t, cx, cy, Math.max(1, r - 2), 'rgb(255,255,255)');
        if (ch > 0.55) ring(t, cx, cy, r + Math.round(3 + ch * 4), css(scaleC(nc, ch * 0.8)), 1);
      }

      // additive composite: blurred glow * intensity + crisp strokes
      const inten = clamp(C.GLOW + 0.14 * sa, 0, 1), ox = x - LW / 2, oy = y - LH / 2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = inten;
      if (HAS_FILTER) {
        ctx.filter = 'blur(' + (3.2 * s).toFixed(2) + 'px)';
        ctx.drawImage(this.gc, ox, oy);
        ctx.filter = 'none';
      } else {                                   // Safari: chhota karke bada = halka blur
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

  register({ key: 'neural_swarm', py: 19,order: 5, name: 'Cybernetic Neural Swarm', tag: 'neurons · synapse signals · voice-print',
    defaults: { x: 185, y: 555, scale: 1 }, cls: CyberneticNeuralSwarm });
})();