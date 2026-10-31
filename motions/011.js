/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

{key:'m03',
     name:'Drift + Light Sweep', 
     tag:'journey / emotional',
     order:12,
     draw(c,img,p,t,W,H){
  MX.cover(c,img,W,H,{z:1.12,x:Math.sin(t*.35)*40,y:Math.cos(t*.27)*22,r:Math.sin(t*.2)*.008});
  const x=((t*160)%(W+600))-300,g=c.createLinearGradient(x-200,0,x+200,0);
  g.addColorStop(0,'rgba(255,230,170,0)');g.addColorStop(.5,'rgba(255,230,170,.22)');g.addColorStop(1,'rgba(255,230,170,0)');
  c.globalCompositeOperation='lighter';c.fillStyle=g;c.fillRect(0,0,W,H);c.globalCompositeOperation='source-over';
  MX.vig(c,W,H,'rgba(0,0,0,.9)',.35)}},


]);

})();