/* motions/filename.js  -  naye effects yahan (ek file me jitne chaho).
   motion_kit.js ke helpers MKIT se lo. Aakhri number = order (1 sabse upar). */

   (function(){
const {S,cov,mask,tealOrange,vg,M,add}=MKIT;

add([

  // 35 animation
{key:'002', name:'Organic Soft Pulse', 
    tag:'organic / soft pulse', 
    order:3,
    draw(c,img,p,t,W,H){
  // 1. Base Floating Motion
  MX.cover(c, img, W, H, { z: 1.06, x: Math.sin(t * 0.3) * 30, y: Math.cos(t * 0.25) * 10 });
  
  c.save();
  c.globalCompositeOperation = 'lighter';
  
  // 2. Dynamic Expanding Soft Pulses (Clear & Visible)
  const interval = 2.0; // har pulse ke spawn hone ka gap
  const currentPulseBatch = Math.floor(t / interval);
  
  for (let i = 0; i < 4; i++) {
    const pulseId = currentPulseBatch - i;
    if (pulseId < 0) continue;
    
    // Har pulse ke liye unique random values
    const r = MX.rng(pulseId * 43 + 7);
    const startTime = pulseId * interval + r() * 0.4;
    const age = t - startTime;
    const duration = 2.2; // pulse kitni der tak rahegi
    
    if (age >= 0 && age <= duration) {
      const progress = age / duration;
      
      // Random position across canvas
      const cx = W * (0.2 + r() * 0.6);
      const cy = H * (0.2 + r() * 0.6);
      
      // Circle radius expansion
      const maxRadius = 180 + r() * 280;
      const currentRadius = maxRadius * Math.pow(progress, 0.65);
      
      // Opacity curve (shuru me aana, baad me gayab hona)
      let opacity = progress < 0.3 ? (progress / 0.3) : (1.0 - ((progress - 0.3) / 0.7));
      opacity = Math.max(0, opacity);
      
      if (opacity > 0 && currentRadius > 10) {
        // Soft glowing radial gradient (Gaussian blur effect jaisa)
        const grad = c.createRadialGradient(cx, cy, 0, cx, cy, currentRadius);
        grad.addColorStop(0, `rgba(255, 255, 255, ${0.55 * opacity})`);
        grad.addColorStop(0.5, `rgba(255, 255, 255, ${0.25 * opacity})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        c.fillStyle = grad;
        c.beginPath();
        c.arc(cx, cy, currentRadius, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  
  c.restore();
  
  // 3. Cinematic Vignette
  MX.vig(c, W, H, 'rgba(0,0,0,.9)', .35);
}}

  
]);

})();