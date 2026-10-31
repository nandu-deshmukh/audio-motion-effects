/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

//37
{key:'m14', 
    name:'Cinematic Light Sweep & Dust', 
    tag:'cinematic / light sweep', 
    order:8,
    draw(c,img,p,t,W,H){
  // 1. Smooth Camera Zoom & Parallax Drift
  const zoom = 1.06 + 0.015 * Math.sin(t * 0.35);
  const ox = 14 * Math.sin(t * 0.5);
  const oy = 6 * Math.cos(t * 0.42);
  
  MX.cover(c, img, W, H, { z: zoom, x: ox, y: oy });
  
  // 2. Light Sweep & Anamorphic Streak Timing (Python ke SLANT & SHINE_FRAMES jaisa)
  const cycleTime = 4.2;
  const phase = (t % cycleTime) / cycleTime;
  
  if (phase < 0.65) {
    const r = phase / 0.65;
    const ease = r * r * (3 - 2 * r);
    const sweepX = -W * 0.4 + ease * W * 1.8;
    const env = Math.sin(r * Math.PI); // Peak in the middle
    
    c.save();
    c.globalCompositeOperation = 'lighter';
    
    // Main Light Beam Sweep (Slanted gradient simulation)
    const grad = c.createLinearGradient(sweepX - 250, 0, sweepX + 250, H);
    grad.addColorStop(0, 'rgba(255, 242, 225, 0)');
    grad.addColorStop(0.4, `rgba(255, 242, 225, ${0.35 * env})`);
    grad.addColorStop(0.5, `rgba(255, 255, 255, ${0.55 * env})`);
    grad.addColorStop(0.6, `rgba(255, 242, 225, ${0.35 * env})`);
    grad.addColorStop(1, 'rgba(255, 242, 225, 0)');
    
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    
    // Anamorphic Horizontal Streak (Python ke wide horizontal blur jaisa)
    const streakGrad = c.createRadialGradient(sweepX, H * 0.45, 10, sweepX, H * 0.45, W * 0.6);
    streakGrad.addColorStop(0, `rgba(255, 205, 150, ${0.45 * env})`);
    streakGrad.addColorStop(0.3, `rgba(255, 242, 225, ${0.2 * env})`);
    streakGrad.addColorStop(1, 'rgba(255, 205, 150, 0)');
    
    c.fillStyle = streakGrad;
    c.scale(2.2, 0.35); // Horizontally stretched anamorphic look
    c.fillRect((sweepX / 2.2) - W, (H * 0.45 / 0.35) - H, W * 2, H * 2);
    
    c.restore();
  }
  
  // 3. Floating Dust Particles (Light beam me zyada chamakne wale particles)
  c.save();
  c.globalCompositeOperation = 'lighter';
  const rng = MX.rng(107);
  
  for (let i = 0; i < 50; i++) {
    const pz = 0.3 + rng() * 0.7;
    const pph = rng() * 6.28;
    
    let px = ((rng() * W + t * (45 * pz + 15)) % W);
    let py = ((rng() * H - t * (25 * pz) + Math.sin(t * 1.2 + pph) * 20) % H);
    if (py < 0) py += H;
    
    const alpha = 0.2 + 0.6 * Math.max(0, Math.sin(t * 1.8 + pph));
    
    c.fillStyle = `rgba(225, 242, 255, ${alpha * pz})`;
    c.beginPath();
    c.arc(px, py, pz < 0.6 ? 1.0 : 2.0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  
  // 4. Cinematic Vignette & Tone Darkening
  MX.vig(c, W, H, 'rgba(0, 0, 0, 0.92)', 0.45);
}}


]);

})();