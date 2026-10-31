/* motion_kit.js  -  image effects ke common helpers (window.MKIT)
 *
 * Har effect file (motions/*.js) me ye helpers dobara copy karne ki zarurat nahi, bas:
 *
 *   (function(){
 *     const {S,C,PI,E,K,cov,mask,vg,tealOrange,M,add}=MKIT;
 *     add([
 *       M('v1','Parallax Depth of Field','portrait / depth',(c,im,p,t,W,H)=>{ ... },  1),   // <- aakhri number = ORDER
 *       M('v2','Naya Effect','tag',(c,im,p,t,W,H)=>{ ... }),                               // order nahi = list ke end me
 *     ]);
 *   })();
 *
 * ORDER: chhota number upar. 1 wale sabse upar, phir 2, phir 3 ... Same number ho to jo pehle load hua wo pehle.
 *        Order na ho to wo effects ordered wale effects ke neeche aate hain (load order me).
 *        Ek saath numbering chahiye to:  add([...], 100)  -> bina order wale effects ko 100,101,102... mil jata hai.
 * Same key dobara aaye to naya purane ko replace karta hai (duplicate nahi banta).
 */
(function(){
const L=MX.lerp,E=MX.io,O=MX.oc,K=MX.clamp,R=MX.rng,S=Math.sin,C=Math.cos,PI=Math.PI,cov=MX.cover;
const T=document.createElement('canvas');T.width=1280;T.height=720;const tc=T.getContext('2d');
const GL=[...'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789'];

const ko=(p,a)=>{a=Object.assign({z0:1,z1:1.15,x0:0,x1:0,y0:0,y1:0,r0:0,r1:0},a);const q=E(K(p));return{z:L(a.z0,a.z1,q),x:L(a.x0,a.x1,q),y:L(a.y0,a.y1,q),r:L(a.r0,a.r1,q)}};
const vg=(c,W,H,a)=>MX.vig(c,W,H,'rgba(0,0,0,.95)',a);
const mix=(c,W,H,col,a,mode)=>{c.globalCompositeOperation=mode||'source-over';c.globalAlpha=K(a);c.fillStyle=col;c.fillRect(0,0,W,H);c.globalAlpha=1;c.globalCompositeOperation='source-over'};
const gradMix=(c,W,H,c0,c1,a,mode)=>{const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,c0);g.addColorStop(1,c1);c.globalCompositeOperation=mode||'source-over';c.globalAlpha=K(a);c.fillStyle=g;c.fillRect(0,0,W,H);c.globalAlpha=1;c.globalCompositeOperation='source-over'};
const tealOrange=(c,W,H,a)=>gradMix(c,W,H,'#1f6f8b','#ff9b54',a,'soft-light');
const desat=(c,W,H,a)=>mix(c,W,H,'#808080',a,'saturation');
const grain=(c,W,H,t,a)=>{const r=R(Math.floor(t*24)+7);c.globalAlpha=a;for(let k=0;k<500;k++){c.fillStyle=r()<.5?'#fff':'#000';c.fillRect(r()*W,r()*H,2,2)}c.globalAlpha=1};
const bars=(c,W,H,h)=>{c.fillStyle='#000';c.fillRect(0,0,W,h);c.fillRect(0,H-h,W,h)};
const scan=(c,W,H,a)=>{c.fillStyle='rgba(0,0,0,'+a+')';for(let y=0;y<H;y+=4)c.fillRect(0,y,W,2)};
const shake=(t,a,s)=>[a*(S(t*3.1+s)+S(t*7.3+s*2)*.5),a*(S(t*2.7+s*3)+S(t*6.1+s)*.5)];
const parts=(c,W,H,t,n,o)=>{o=Object.assign({col:'#fff',vx:0,vy:-60,sz:2,a:.6,seed:1,tw:3,add:1},o);const r=R(o.seed);
  c.globalCompositeOperation=o.add?'lighter':'source-over';c.fillStyle=o.col;
  for(let k=0;k<n;k++){const x0=r()*W,y0=r()*H,q=.5+r(),ph=r()*6.28,x=((x0+o.vx*q*t)%W+W)%W,y=((y0+o.vy*q*t)%H+H)%H;
    c.globalAlpha=K(o.a*(.5+.5*S(t*o.tw+ph)));c.beginPath();c.arc(x+S(t*.7+ph)*12,y,o.sz*(.4+q*.6),0,7);c.fill()}
  c.globalAlpha=1;c.globalCompositeOperation='source-over'};
const bokeh=(c,W,H,t,n,col,seed)=>{const r=R(seed||3);c.globalCompositeOperation='lighter';c.fillStyle=col;c.strokeStyle=col;c.lineWidth=2;
  for(let k=0;k<n;k++){const x=((r()*W+t*(8+r()*20))%(W+200))-100,y=(r()*H+S(t*.3+k)*30)%H,rad=20+r()*60,a=.05+.1*r()*(.6+.4*S(t*.8+k));
    c.globalAlpha=a;c.beginPath();c.arc(x,y,rad,0,7);c.fill();c.globalAlpha=a*1.6;c.stroke()}
  c.globalAlpha=1;c.globalCompositeOperation='source-over'};
const fog=(c,W,H,t,col,a,seed)=>{const r=R(seed||5);for(let k=0;k<7;k++){const x=((r()*W*1.5+t*(12+r()*18))%(W*1.5))-W*.25,y=H*(.4+r()*.6),rad=260+r()*220;MX.glow(c,x,y,rad,col,a)}};
const rays=(c,W,H,x,y,t,col,a,n=14)=>{c.save();c.translate(x,y);c.globalCompositeOperation='lighter';const r=R(11);
  for(let k=0;k<n;k++){const an=.55+(k/n)*1.5+S(t*.15+k)*.05,w=.03+r()*.04,g=c.createLinearGradient(0,0,C(an)*1400,S(an)*1400);
    g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');c.globalAlpha=K(a*(.5+.5*S(t*.6+k*1.7)));c.fillStyle=g;
    c.beginPath();c.moveTo(0,0);c.lineTo(C(an-w)*1400,S(an-w)*1400);c.lineTo(C(an+w)*1400,S(an+w)*1400);c.fill()}
  c.restore()};
const flare=(c,W,H,x,y,col,a)=>{MX.glow(c,x,y,170,col,a);c.globalCompositeOperation='lighter';const g=c.createLinearGradient(x-W*.45,0,x+W*.45,0);
  g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(.5,col);g.addColorStop(1,'rgba(0,0,0,0)');c.globalAlpha=K(a*.9);c.fillStyle=g;c.fillRect(x-W*.45,y-2.5,W*.9,5);
  c.globalAlpha=1;c.globalCompositeOperation='source-over';
  [.4,.7,1.2,-.5].forEach((q,k)=>MX.glow(c,W/2-(x-W/2)*q,H/2-(y-H/2)*q,30+k*18,col,a*.35))};
const bloom=(c,im,W,H,o,a,px)=>{c.save();c.filter='blur('+px+'px)';c.globalCompositeOperation='lighter';c.globalAlpha=K(a);cov(c,im,W,H,o);c.restore()};
const chroma=(c,im,W,H,o,off)=>{c.fillStyle='#000';c.fillRect(0,0,W,H);
  [['#f00',-off],['#0f0',0],['#00f',off]].forEach(([col,dx])=>{tc.setTransform(1,0,0,1,0,0);tc.globalCompositeOperation='source-over';tc.clearRect(0,0,W,H);
    cov(tc,im,W,H,Object.assign({},o,{x:(o.x||0)+dx}));tc.globalCompositeOperation='multiply';tc.fillStyle=col;tc.fillRect(0,0,W,H);
    c.globalCompositeOperation='lighter';c.drawImage(T,0,0)});c.globalCompositeOperation='source-over'};
const rain=(c,W,H,t,n,a,seed)=>{const r=R(seed||2);c.strokeStyle='rgba(200,220,255,'+a+')';c.lineWidth=1.2;c.beginPath();
  for(let k=0;k<n;k++){const sp=900+r()*600,x0=r()*W,y=((r()*H+t*sp)%(H+80))-40,x=x0-y*.18;c.moveTo(x,y);c.lineTo(x-4,y+26)}c.stroke()};
const strips=(c,im,W,H,o,amp,fr,t,h)=>{h=h||12;for(let y=0;y<H;y+=h){c.save();c.beginPath();c.rect(0,y,W,h);c.clip();
  cov(c,im,W,H,Object.assign({},o,{x:(o.x||0)+S(y*fr+t*3)*amp}));c.restore()}};
const mask=(c,W,H,draw,mk)=>{tc.setTransform(1,0,0,1,0,0);tc.globalCompositeOperation='source-over';tc.clearRect(0,0,W,H);draw(tc);
  tc.globalCompositeOperation='destination-in';tc.fillStyle=mk(tc);tc.fillRect(0,0,W,H);tc.globalCompositeOperation='source-over';c.drawImage(T,0,0)};
const bolt=(c,r,W,H)=>{const x=W*(.2+.6*r()),pts=MX.bolt(r,x,0,x+(r()-.5)*300,H,14,120);c.strokeStyle='#8fd8ff';c.lineWidth=14;MX.path(c,pts);c.strokeStyle='#fff';c.lineWidth=3;MX.path(c,pts)};

/* M(key,name,tag,draw,order)  -  order optional */
const M=(key,name,tag,draw,order)=>{const o={key,name,tag,draw};if(order!=null)o.order=order;return o};
/* add(list, startOrder)  -  window.MOTIONS me jodo (same key = replace) */
const add=(list,start)=>{
  if(start!=null)list.forEach((m,i)=>{if(m.order==null)m.order=start+i});
  window.MOTIONS=(window.MOTIONS||[]).filter(m=>!list.some(n=>n.key===m.key)).concat(list);
};

window.MKIT={L,E,O,K,R,S,C,PI,cov,T,tc,GL,ko,vg,mix,gradMix,tealOrange,desat,grain,bars,scan,shake,parts,bokeh,fog,rays,flare,bloom,chroma,rain,strips,mask,bolt,M,add};
})();