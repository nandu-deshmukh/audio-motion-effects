/* motions/020.js */
//order:21,
(function(){
const {add}=MKIT;

add([

{key:'020', 
    name:'Horror Flicker', 
    tag:'suspense / danger', 
    order:21,
    draw(c,img,p,t,W,H){
  const r=MX.rng(Math.floor(t*14));
  MX.cover(c,img,W,H,{z:1.05,x:(r()-.5)*4,y:(r()-.5)*4});
  MX.vig(c,W,H,'rgb(0,0,0)',.8+.15*r());MX.vig(c,W,H,'rgb(110,0,10)',.2+.2*Math.sin(t*4));
  if(r()<.05)MX.flash(c,W,H,'#000',.6)}},



]);

})();
