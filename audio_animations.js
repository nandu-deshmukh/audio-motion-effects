/* audio_animations.js  -  Audio animation KIT + registry  (animations_registry.py ka JS version)
 *
 * Is file me sirf common helpers (window.AUDIO_KIT) hain. Har animation apni alag file me rehta hai:
 *
 *     audio_look/CyberneticNeuralSwarm.js
 *     audio_look/LiquidBlob.js        <- naya animation = naya file, page reload karo, bas
 *
 * motion_editor.py  audio_look/ folder ki saari .js files khud load karta hai (alphabetical order).
 * Kisi file me galti ho to baaki chalti rahengi; error toast + browser console me us file ka naam aata hai.
 *
 * Animation file ka dhancha (CyberneticNeuralSwarm.js dekho):
 *
 *   (function () {
 *     const { FPS, RNG, clamp, lerpC, scaleC, css, seg, dot, ring } = window.AUDIO_KIT;
 *     class MyAnim {
 *       constructor({ audio, t0, dur })   // audio = {pps, peaks[], rms[], zcr[], lows[], mids[], highs[], centroid[]}
 *       render(ctx, T, x, y, scale)       // T = animation ke start se seconds, (x,y) anchor, scale = size
 *     }
 *     AUDIO_KIT.register({ key:'my_anim', py:30, name:'My Anim', tag:'...', defaults:{x:640,y:360,scale:1}, cls:MyAnim });
 *   })();
 *
 * Class ka poora code render-cache key me judta hai: ek file badalne par sirf usi animation ka purana render invalidate hota hai.
 */
(function () {
  'use strict';
  const FPS = 25;
  const HAS_FILTER = (() => { try { return 'filter' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; } })();

  class RNG {                                   // mulberry32 (state save/restore ho sakti hai)
    constructor(seed) { this.s = seed >>> 0; }
    next() {
      this.s = (this.s + 0x6D2B79F5) >>> 0;
      let t = this.s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    rand() { return this.next(); }
    uniform(a, b) { return a + (b - a) * this.next(); }
    randint(a, b) { return a + Math.floor(this.next() * (b - a)); }      // [a, b)
    choice(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerpC = (c1, c2, t) => { t = clamp(t, 0, 1); return [Math.round(c1[0] + (c2[0] - c1[0]) * t), Math.round(c1[1] + (c2[1] - c1[1]) * t), Math.round(c1[2] + (c2[2] - c1[2]) * t)]; };
  const scaleC = (c, f) => { f = clamp(f, 0, 1); return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)]; };
  const css = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  const seg = (c, x1, y1, x2, y2, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
  const dot = (c, x, y, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, 6.2832); c.fill(); };
  const ring = (c, x, y, r, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.stroke(); };

  window.AUDIO_ANIMS = window.AUDIO_ANIMS || [];
  function register(entry) {
    entry.create = function (o) { return new this.cls(o); };
    window.AUDIO_ANIMS = window.AUDIO_ANIMS.filter(a => a.key !== entry.key);
    window.AUDIO_ANIMS.push(entry);
  }
  window.AUDIO_KIT = { FPS, HAS_FILTER, RNG, clamp, lerpC, scaleC, css, seg, dot, ring, register };
})();