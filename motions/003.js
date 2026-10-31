/* motions/filename.js */
//order:1,
(function(){
const {S,cov,K,E,L,C,M,add}=MKIT;

add([

M('003','Spotlight Reveal','mystery / hero intro',(c,im,p,t,W,H)=>{
  
  // Aapka naya cover, flash aur vignette effect yaha add kar diya hai
  MX.cover(c,im,W,H,{z:1.3-.25*MX.oc(p)}); 
  MX.flash(c,W,H,'#fff',.5*Math.exp(-t*3)); 
  MX.vig(c,W,H,'rgba(0,0,0,.9)',.3);

  // Original spotlight overlay
  const x=W*(.5+.3*S(t*.5)),
        y=H*(.5+.2*C(t*.37)),
        R0=L(160,1100,E(K(t/4)));

  const g=c.createRadialGradient(x,y,R0*.25,x,y,R0);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(1,'rgba(0,0,0,'+L(.97,.35,K(t/8))+')');
  c.fillStyle=g;
  c.fillRect(0,0,W,H);

  // After 3 seconds: organic & variable-timing cinematic light sweep (3 to 8 sec range)
  if(t>3){
    const et = t - 3;
    
    // Multi-frequency modulation se timing aur speed ko dynamic banaya hai (3s se 8s ke beech organic feel)
    const sweepVal = Math.sin(et * 0.35 + Math.sin(et * 0.17) * 2.5);
    
    // Screen ke ek kone se dusre kone tak movement
    const sx = W * (0.5 + 1.0 * sweepVal);

    // Har sweep ke sath beam ki width aur opacity dynamic rahegi
    const beamWidth = W * (0.16 + 0.08 * Math.sin(et * 0.4));
    const opacityFactor = L(0.15, 0.30, Math.abs(Math.sin(et * 0.25)));

    const beam = c.createLinearGradient(sx - beamWidth, 0, sx + beamWidth, 0);
    beam.addColorStop(0, 'rgba(255,255,255,0)');
    beam.addColorStop(0.5, `rgba(190,220,255,${opacityFactor})`);
    beam.addColorStop(1, 'rgba(255,255,255,0)');

    c.save();
    c.globalCompositeOperation = 'screen';
    
    // Har sweep par angle bhi thoda change hoga taaki natural lage
    c.translate(W / 2, H / 2);
    c.rotate(0.07 * Math.sin(et * 0.2));
    c.translate(-W / 2, -H / 2);

    c.fillStyle = beam;
    c.fillRect(-W * 0.5, -H * 0.5, W * 2, H * 2);
    c.restore();
  }
},4),

]);

})();