/* motions/v01_parallax.js  -  naye effects yahan (ek file me jitne chaho).
   motion_kit.js ke helpers MKIT se lo. Aakhri number = order (1 sabse upar). */
(function(){
const {S,cov,mask,tealOrange,vg,M,add}=MKIT;
add([


M('v1','Parallax Depth of Field','portrait / depth',(c,im,p,t,W,H)=>{
  const sx=S(t*.3)*30;c.save();c.filter='blur(10px)';cov(c,im,W,H,{z:1.3,x:-sx*.8});c.restore();
  mask(c,W,H,x=>cov(x,im,W,H,{z:1.08,x:sx}),x=>{const g=x.createRadialGradient(W/2,H/2,H*.25,W/2,H/2,H*.7);g.addColorStop(0,'#000');g.addColorStop(1,'rgba(0,0,0,0)');return g});
  tealOrange(c,W,H,.3);vg(c,W,H,.35)},1),


]);


})();