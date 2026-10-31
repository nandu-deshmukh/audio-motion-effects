/* motions/018.js */
//order:19,
(function(){
const {add}=MKIT;

add([

{key:'m09', name:'Glitch Teleport',
    order:19,
    tag:'teleport / portal', draw(c,img,p,t,W,H){
  const a=t%2.2,on=a<.4,r=MX.rng(Math.floor(t*24));
  if(!on){MX.cover(c,img,W,H,{z:1.03});return}
  const s=Math.sin(a/.4*Math.PI);
  for(let y=0;y<H;y+=36){const h=36,dx=(r()-.5)*160*s;c.save();c.beginPath();c.rect(0,y,W,h);c.clip();MX.cover(c,img,W,H,{z:1.03,x:dx});c.restore()}
  for(let i=0;i<6;i++){c.fillStyle=r()<.5?`rgba(61,220,255,${.3*s})`:`rgba(255,60,200,${.3*s})`;c.fillRect(0,r()*H,W,4+r()*20)}
  MX.glow(c,W/2,H/2,300*s,'#9cf',.5)}},



]);

})();
