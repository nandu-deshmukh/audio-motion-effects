/* motions/019.js */
//
(function(){
const {add}=MKIT;

add([


{key:'m10', name:'Dust & Wind',
     tag:'wind / delay', 
     order:20,
     draw(c,img,p,t,W,H){
  MX.cover(c,img,W,H,{z:1.08,x:Math.sin(t*.6)*14});
  const r=MX.rng(4);c.strokeStyle='#fff';c.lineWidth=1.5;
  for(let i=0;i<60;i++){const y=r()*H,l=120+r()*220,x=((r()*W*2+t*(900+r()*600))%(W+400))-200;c.globalAlpha=.2;c.beginPath();c.moveTo(x,y);c.lineTo(x+l,y);c.stroke()}
  c.globalAlpha=1;MX.vig(c,W,H,'rgba(60,40,20,.9)',.3)}},


]);

})();
