/* motions/v01_parallax.js  -  naye effects yahan (ek file me jitne chaho).
   motion_kit.js ke helpers MKIT se lo. Aakhri number = order (1 sabse upar). */
(function(){
const {S,cov,mix,C,vg,M,add}=MKIT;
add([


M('005','Zoom Burst & Cinematic Atmosphere','impact / reveal',(c,im,p,t,W,H)=>{
  // Shuruat me ekdam strong zoom burst impact (sirf ek baar)
  const initialBurst = Math.exp(-t * 2.5);
  
  // Poori video ke liye organic, non-repeating breathing zoom aur drift
  const organicZoom = 1.05 + 0.03 * S(t * 0.25) + 0.02 * C(t * 0.12);
  const totalZoom = organicZoom * (1 + 0.1 * initialBurst);

  // Multi-layer zoom burst for initial impact
  for(let k = 0; k < 8; k++){
    c.globalAlpha = 1 / (k + 1);
    cov(c, im, W, H, { z: totalZoom * (1 + 0.06 * initialBurst * k) });
  }
  
  c.globalAlpha = 1;
  
  // Shuruat ka white flash
  const flashIntensity = 0.4 * initialBurst + 0.04 * Math.abs(S(t * 0.3));
  mix(c, W, H, '#fff', flashIntensity);

  // ✨ NAYA EFFECT: Zoom ke sath ek organic cinematic light/color aura jo poori video me float karega
  const lightX = W * (0.5 + 0.4 * S(t * 0.15));
  const lightY = H * (0.5 + 0.3 * C(t * 0.2));
  const gradR = W * (0.5 + 0.15 * Math.abs(S(t * 0.22)));
  
  const atmosGrad = c.createRadialGradient(lightX, lightY, 0, lightX, lightY, gradR);
  atmosGrad.addColorStop(0, 'rgba(130, 190, 255, 0.15)'); // Soft sci-fi blue glow
  atmosGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  c.save();
  c.globalCompositeOperation = 'screen';
  c.fillStyle = atmosGrad;
  c.fillRect(0, 0, W, H);
  c.restore();

  vg(c, W, H, 0.4);
},6),

]);


})();