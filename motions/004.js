/* motions/v01_parallax.js  -  naye effects yahan (ek file me jitne chaho).
   motion_kit.js ke helpers MKIT se lo. Aakhri number = order (1 sabse upar). */
(function(){
const {S,cov,mask,tealOrange,vg,M,ko,flare,C,add}=MKIT;
add([


M('004','Lens Flare Sweep','sun / sky',(c,im,p,t,W,H)=>{
  // Image me subtle breathing zoom aur organic motion add kiya hai
  cov(c,im,W,H,ko(p,{z0:1.02 + 0.03*S(t*0.2), z1:1.10 + 0.03*C(t*0.2)}));
  
  tealOrange(c,W,H,.35);

  // Multi-frequency waves se lens flare ko dynamic aur non-repeating banaya hai
  const fx = W * (0.5 + 0.65 * S(t * 0.18 + S(t * 0.08) * 2.0));
  const fy = H * (0.35 + 0.25 * C(t * 0.22 + S(t * 0.12) * 1.5));

  // Flare ki intensity aur glow time ke sath smoothly vary hoga
  const intensity = 0.45 + 0.25 * Math.abs(S(t * 0.25));

  flare(c,W,H, fx, fy, 'rgba(255,190,120,1)', intensity);
  vg(c,W,H,.35);
},5),


]);


})();



