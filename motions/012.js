/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

{key:'m04', 
    name:'Heartbeat Pulse', 
    tag:'damage / heartbeat',
    order:12,
    draw(c,img,p,t,W,H){
  const q=t%.9,b=Math.exp(-q*9)+.65*Math.exp(-Math.pow((q-.3)*10,2));
  MX.cover(c,img,W,H,{z:1.04+.03*b}); MX.vig(c,W,H,'rgb(190,0,25)',.2+.5*b)}},


]);

})();