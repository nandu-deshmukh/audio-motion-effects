


/* motions/.js  -  naye effects yahan (ek file me jitne chaho).
   motion_kit.js ke helpers MKIT se lo. Aakhri number = order (1 sabse upar). */
(function(){
const {S,cov,mix,bloom,parts,rays,ko,C,vg,M,add}=MKIT;
add([


M('m33','God Rays Reveal','reveal / hope',(c,im,p,t,W,H)=>{
  // Image me initial reveal ke sath-sath continuous organic breathing zoom add kiya hai
  const o = ko(p, {
    z0: 1.25 + 0.03 * S(t * 0.2),
    z1: 1.05 + 0.03 * C(t * 0.2)
  });
  
  cov(c, im, W, H, o);
  
  // Shuruat ka divine flash effect
  mix(c, W, H, '#fff', .8 * Math.exp(-t * 1.2));
  
  // God rays ka source ab organic tareeqe se sway karega (halka left-right movement)
  const rayX = W * (.5 + 0.12 * S(t * 0.25));
  const rayIntensity = .24 + 0.06 * Math.abs(C(t * 0.3));
  
  rays(c, W, H, rayX, -80, t, 'rgba(255,246,208,1)', rayIntensity);
  
  bloom(c, im, W, H, o, .3, 18);
  
  // Magical floating dust particles
  parts(c, W, H, t, 40, {col: '#fff6d0', vy: -20, sz: 2, seed: 2});
  
  vg(c, W, H, .35);
},7),

]);


})();