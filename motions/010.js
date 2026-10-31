/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

{key:'m01', 
    name:'Slow Zoom In', 
    tag:'calm / shuruaat', 
    order:12,
    draw(c,img,p,t,W,H){
  MX.cover(c,img,W,H,{z:1+.14*p,x:-p*24}); MX.vig(c,W,H,'rgba(0,0,0,.9)',.35)}},




]);

})();