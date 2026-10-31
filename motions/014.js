/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

{key:'m06', 
    name:'Speed Lines Whoosh', 
    tag:'whoosh / attack', 
    order:15,
    draw(c,img,p,t,W,H){
  const E=x=>x*x*(3-2*x), cx=W/2, cy=H/2, diag=Math.hypot(W,H);

  // ===== SCHEDULE: rush (radial), slash (achanak hamla), fade (halka aata-jaata whoosh) =====
  const S=MX._wh||(MX._wh={ev:[],r:MX.rng(31),cur:.5,last:''}), R=S.r;
  while(!S.ev.length||S.ev[S.ev.length-1].s<t+8){
    let q=R(), type=q<.45?'rush':q<.72?'slash':'fade';
    if(type===S.last&&R()<.6)type=type==='slash'?'rush':'slash';   // repeat kam
    S.last=type;
    const I=type==='fade'?.3+R()*.3:.45+R()*.55;
    const dur=type==='slash'?.7+R()*.4:type==='rush'?1.1+R()*.9:1.8+R()*1.2;
    const ang=(R()<.5?-1:1)*(.15+R()*.6)+(R()<.5?0:Math.PI);        // slash direction
    S.ev.push({s:S.cur,dur,I,type,ang,fx:.3+R()*.4,fy:.35+R()*.3,seed:S.ev.length*11+2});
    S.cur+=dur*.75+(R()<.3?1.8+R()*2:.4+R()*1.1);                  // kabhi lamba sannata, kabhi jaldi
  }
  const act=[];
  for(let i=S.ev.length-1;i>=0;i--){const e=S.ev[i]; if(e.s+e.dur<t-4)break; if(t>=e.s&&t<e.s+e.dur)act.push(e)}

  // ===== envelope + camera =====
  let z=1.08+.015*Math.sin(t*.9), x=Math.sin(t*.7)*5, y=Math.cos(t*.5)*4, rot=Math.sin(t*.4)*.002, zb=0, en=0;
  for(const e of act){
    const u=t-e.s, pr=u/e.dur, I=e.I, dx=Math.cos(e.ang), dy=Math.sin(e.ang);
    e.pr=pr;
    e.env=e.type==='slash'?(pr<.08?E(pr/.08):Math.exp(-(pr-.08)*6))
         :e.type==='rush'?(pr<.25?E(pr/.25):Math.exp(-(pr-.25)*3))
         :Math.pow(Math.sin(Math.PI*pr),2)*.65;
    const v=e.env*I;
    if(e.type==='rush'){z+=.13*v; zb+=v}
    else if(e.type==='slash'){x+=dx*38*v; y+=dy*38*v; rot+=dx*.012*v; z+=.05*v; zb+=v*.5}
    else{z-=.025*v; zb+=v*.4}
    en=Math.max(en,v);
  }
  // zoom-blur: image ko thoda multiple zoom me blend
  MX.cover(c,img,W,H,{z:z,x:x,y:y,r:rot});
  if(zb>.12){for(let k=1;k<=3;k++){c.globalAlpha=Math.min(.22,.1*zb*(1.2-k*.2));MX.cover(c,img,W,H,{z:z+k*.03*Math.min(1,zb),x:x,y:y,r:rot})}c.globalAlpha=1}

  // ===== idle faint streaks (frame kabhi dead nahi) =====
  {const r=MX.rng(9);c.strokeStyle='#fff';c.lineWidth=1.2;
   for(let i=0;i<16;i++){const an=r()*6.283,ph=(t*.18+r())%1,r0=diag*.2+ph*diag*.5,l=60+r()*120;
     c.globalAlpha=.1*Math.sin(Math.PI*ph);c.beginPath();
     c.moveTo(cx+Math.cos(an)*r0,cy+Math.sin(an)*r0);c.lineTo(cx+Math.cos(an)*(r0+l),cy+Math.sin(an)*(r0+l));c.stroke()}
   c.globalAlpha=1}

  // ===== effects =====
  c.save();c.globalCompositeOperation='lighter';c.lineCap='round';
  for(const e of act){
    const I=e.I, env=e.env, pr=e.pr, u=t-e.s, r=MX.rng(e.seed), ex=e.fx*W, ey=e.fy*H;
    const dx=Math.cos(e.ang), dy=Math.sin(e.ang), nx=-dy, ny=dx;

    if(e.type==='rush'||e.type==='fade'){
      const n=(e.type==='rush'?26+80*I:14+30*I)|0, mv=1-Math.exp(-u*(e.type==='rush'?2.6:1.4));
      for(let i=0;i<n;i++){
        const an=r()*6.283, r0=diag*(.06+r()*.22), sp=.5+r()*.9, l=diag*(.05+r()*.2)*(.4+env);
        const o=mv*diag*.65*sp, a0=r0+o, a1=a0+l;
        const al=(e.type==='rush'?.7:.4)*env*(.5+.5*I);
        c.strokeStyle=`rgba(255,255,255,${al*.35})`;c.lineWidth=(3+r()*4)*(.5+I);
        c.beginPath();c.moveTo(ex+Math.cos(an)*a0,ey+Math.sin(an)*a0);c.lineTo(ex+Math.cos(an)*a1,ey+Math.sin(an)*a1);c.stroke();
        c.strokeStyle=`rgba(255,255,255,${al})`;c.lineWidth=.8+r()*1.6;
        c.beginPath();c.moveTo(ex+Math.cos(an)*a0,ey+Math.sin(an)*a0);c.lineTo(ex+Math.cos(an)*a1,ey+Math.sin(an)*a1);c.stroke();
      }
      if(e.type==='rush'){ // center se halki glow (energy build)
        const g=c.createRadialGradient(ex,ey,0,ex,ey,diag*.45);
        g.addColorStop(0,`rgba(255,240,215,${.22*env*I})`);g.addColorStop(1,'rgba(255,200,150,0)');
        c.fillStyle=g;c.fillRect(0,0,W,H);
      }
    }else{ // SLASH: hamla - parallel streaks + ek bright cut line
      const sw=E(Math.min(1,pr/.32)), head=(-.7+1.7*sw)*diag, n=(16+36*I)|0;
      for(let i=0;i<n;i++){
        const off=(r()-.5)*diag*.9, l=diag*(.25+r()*.5), h=head-r()*diag*.25;
        const px=cx+nx*off+dx*h, py=cy+ny*off+dy*h;
        c.strokeStyle=`rgba(255,255,255,${.6*env*(.4+.6*I)})`;c.lineWidth=.8+r()*2.4;
        c.beginPath();c.moveTo(px-dx*l,py-dy*l);c.lineTo(px,py);c.stroke();
      }
      const fade=Math.max(0,1-pr/.55), off0=(.5-ex/W)*60, L=diag*1.2;
      for(const [lw,col] of [[26*I,`rgba(255,170,90,${.35*fade})`],[9*I,`rgba(255,235,200,${.7*fade})`],[2.5,`rgba(255,255,255,${fade})`]]){
        c.strokeStyle=col;c.lineWidth=Math.max(1,lw*(1-pr*.8));c.beginPath();
        c.moveTo(cx+nx*off0-dx*L/2+dx*(1-sw)*-80,cy+ny*off0-dy*L/2);c.lineTo(cx+nx*off0+dx*L/2,cy+ny*off0+dy*L/2);c.stroke();
      }
    }
  }
  c.restore();

  // slash ke start pe halka flash
  for(const e of act)if(e.type==='slash'&&e.pr<.15)MX.flash(c,W,H,'#fff',.35*e.I*Math.exp(-e.pr*30));

  // ===== cinematic bars + vignette =====
  const bar=H*.045*E(Math.min(1,en*1.6));
  c.fillStyle='#000';c.fillRect(0,0,W,bar);c.fillRect(0,H-bar,W,bar);
  MX.vig(c,W,H,'rgba(0,0,0,.9)',.28+.3*en);
}},


]);

})();