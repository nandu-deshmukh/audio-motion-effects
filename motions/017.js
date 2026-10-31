/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

{key:'m08', name:'Lightning Storm', 
    tag:'thunder / lightting', 
    order:17,
    draw(c,img,p,t,W,H){
  const E=x=>x*x*(3-2*x), cx=W/2, cy=H/2, diag=Math.hypot(W,H);
  const PX=q=>Array.isArray(q)?q[0]:q.x, PY=q=>Array.isArray(q)?q[1]:q.y;

  // ===== SCHEDULE: sheet (door ki bijli ka halka flicker), strike (asli bolt), double (bolt + restrikes) =====
  const S=MX._ls||(MX._ls={ev:[],r:MX.rng(88),cur:.6,last:''}), R=S.r;
  while(!S.ev.length||S.ev[S.ev.length-1].s<t+8){
    const q=R(); let type=q<.38?'sheet':q<.7?'strike':'double';
    if(type===S.last&&type!=='sheet'&&R()<.7)type='sheet';
    S.last=type;
    const I=type==='sheet'?.25+R()*.3:type==='strike'?.55+R()*.35:.8+R()*.2;
    const pulses=type==='sheet'?[[0,.7],[.14,.45],[.31,.6]]
      :type==='strike'?[[0,1],[.1,.55],[.24,.8]]
      :[[0,1],[.08,.5],[.19,.9],[.33,.6],[.5,.75]];
    const dur=pulses[pulses.length-1][0]+1.1;
    S.ev.push({s:S.cur,dur,I,type,pulses,fx:.15+R()*.7,gy:.72+R()*.22,lean:(R()-.5)*.35,delay:.1+(1-I)*.35,seed:S.ev.length*23+7});
    S.cur+=dur*.55+(R()<.35?2.2+R()*3.5:.5+R()*1.5);   // kabhi lamba sannata, kabhi jaldi
  }
  const act=[];
  for(let i=S.ev.length-1;i>=0;i--){const e=S.ev[i]; if(e.s+e.dur<t-4)break; if(t>=e.s&&t<e.s+e.dur)act.push(e)}

  // ===== light envelope + thunder shake =====
  let L=0, sx=0, sy=0, sr=0, rumble=0;
  for(const e of act){
    const u=t-e.s; e.u=u; e.pl=0;
    for(const [t0,a] of e.pulses){const d=u-t0; if(d>=0)e.pl=Math.max(e.pl,a*E(Math.min(1,d/.015))*Math.exp(-d*(e.type==='sheet'?7:10)))}
    L=Math.max(L,e.pl*e.I);
    if(e.type!=='sheet'){
      const d=u-e.delay;                       // bijli pehle, awaaz baad me
      if(d>0){const att=E(Math.min(1,d/.05)),dec=Math.exp(-d*3.2);
        sx+=(Math.sin(d*19)+.6*Math.sin(d*33+1))*20*e.I*dec*att;
        sy+=(Math.sin(d*23+.8)+.5*Math.sin(d*41))*15*e.I*dec*att;
        sr+=Math.sin(d*17)*.007*e.I*dec*att; rumble=Math.max(rumble,e.I*dec*att)}
    }
  }
  const storm=.5+.5*Math.sin(t*.35), gust=Math.sin(t*.6)*.5+Math.sin(t*1.7)*.3;

  // ===== camera: halka drift, flash pe thoda push =====
  MX.cover(c,img,W,H,{z:1.07+.012*Math.sin(t*.7)+.02*L,x:Math.sin(t*.8)*5+sx,y:Math.cos(t*.6)*4+sy,r:sr});

  // ===== grade: andhera + neela tint, bijli pe scene roshan =====
  c.save();c.globalCompositeOperation='multiply';
  const dk=.5+.5*L;c.fillStyle=`rgb(${150+105*dk|0},${165+90*dk|0},${215+40*dk|0})`;c.fillRect(0,0,W,H);c.restore();

  // ===== badal (upar se dark clouds, bijli se andar se glow) =====
  {let g=c.createLinearGradient(0,0,0,H*.55);
   g.addColorStop(0,`rgba(5,10,30,${.55-.3*L})`);g.addColorStop(1,'rgba(5,10,30,0)');c.fillStyle=g;c.fillRect(0,0,W,H)}

  c.save();c.globalCompositeOperation='lighter';
  for(const e of act){
    if(e.pl<.01)continue;
    const r=MX.rng(e.seed), I=e.I, a=e.pl*I, bx=e.fx*W;
    // cloud glow upar
    let g=c.createRadialGradient(bx,0,0,bx,0,diag*(.45+.4*I));
    g.addColorStop(0,`rgba(170,200,255,${.55*a})`);g.addColorStop(1,'rgba(90,120,220,0)');
    c.fillStyle=g;c.fillRect(0,0,W,H);
    // poore frame pe cold wash
    c.fillStyle=`rgba(110,140,220,${.16*a})`;c.fillRect(0,0,W,H);

    if(e.type==='sheet')continue;
    // ---- main bolt: upar se neeche ugta hai (0.07s me) ----
    const x0=bx, y1=H*e.gy, x1=bx+e.lean*W*.4;
    const pts=MX.bolt(r,x0,-20,x1,y1,16,110*(.6+.6*I));
    const gro=E(Math.min(1,e.u/.07)), n=Math.max(2,Math.ceil(pts.length*gro)), part=pts.slice(0,n);
    c.lineCap='round';c.lineJoin='round';
    for(const [lw,col] of [[34*I+8,`rgba(80,130,255,${.18*a})`],[14*I+4,`rgba(140,205,255,${.5*a})`],[4,`rgba(255,255,255,${Math.min(1,a*1.3)})`]]){
      c.strokeStyle=col;c.lineWidth=lw;MX.path(c,part);
    }
    // ---- branches ----
    const nb=(2+4*I)|0;
    for(let b=0;b<nb;b++){
      const j=2+(r()*(pts.length-5)|0); if(j>=n)continue;
      const bx0=PX(pts[j]), by0=PY(pts[j]), dir=r()<.5?-1:1, len=(120+r()*260)*(.5+I);
      const bp=MX.bolt(r,bx0,by0,bx0+dir*len*(.5+r()*.5),by0+len*(.5+r()*.8),7,45);
      for(const [lw,col] of [[7,`rgba(110,170,255,${.3*a})`],[1.8,`rgba(235,245,255,${.85*a})`]]){
        c.strokeStyle=col;c.lineWidth=lw*(.6+.5*I);MX.path(c,bp);
      }
    }
    // ---- zameen pe impact glow + chingariyan ----
    if(gro>=1){
      const gg=c.createRadialGradient(x1,y1,0,x1,y1,120+260*I);
      gg.addColorStop(0,`rgba(255,255,255,${.7*a})`);gg.addColorStop(.3,`rgba(140,190,255,${.4*a})`);gg.addColorStop(1,'rgba(80,120,255,0)');
      c.fillStyle=gg;c.fillRect(0,0,W,H);
      const d=Math.max(0,e.u), ns=(6+22*I)|0;
      for(let i=0;i<ns;i++){
        const an=-Math.PI/2+(r()-.5)*2.8, sp=(120+r()*500)*(.5+I), q=1-d/(.35+r()*.5); if(q<=0)continue;
        const k=1-Math.exp(-d*5);
        c.fillStyle=`rgba(190,225,255,${q})`;c.beginPath();c.arc(x1+Math.cos(an)*sp*k*.3,y1+Math.sin(an)*sp*k*.3+420*d*d,1+r()*2*q,0,7);c.fill();
      }
    }
  }
  c.restore();

  // ===== barish (idle me bhi chalti hai, toofan me tez) =====
  {const r=MX.rng(4),n=150+80*(storm+L)|0,wind=.22+.14*gust;
   c.lineCap='round';
   for(let i=0;i<n;i++){
     const sp=1.1+r()*1.1, len=18+r()*34, ph=(t*sp*1.3+r())%1, y=ph*(H+len)-len, x=r()*W*1.4-ph*H*wind-W*.1;
     c.strokeStyle=`rgba(190,215,255,${.07+.1*storm+.28*L})`;c.lineWidth=.8+r()*1.1;
     c.beginPath();c.moveTo(x,y);c.lineTo(x-len*wind,y+len);c.stroke();
   }}

  // ===== flash (bijli ke saath) =====
  if(L>.02)MX.flash(c,W,H,'#dfeaff',.5*L);

  // ===== bars (thunder pe thode tight) + vignette =====
  const bar=H*.05*E(Math.min(1,rumble*1.6+.15*storm));
  c.fillStyle='#000';c.fillRect(0,0,W,bar);c.fillRect(0,H-bar,W,bar);
  MX.vig(c,W,H,'rgba(0,0,15,.9)',.4+.2*storm-.12*L+.12*rumble);
}},


]);

})();