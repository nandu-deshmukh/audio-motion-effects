/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

{key:'m05', name:'Impact Shake', 
    tag:'rock / impact / hit', 
    order:14,
    draw(c,img,p,t,W,H){
  const E=x=>x*x*(3-2*x), cx=W/2, cy=H/2, diag=Math.hypot(W,H);

  // ===== SCHEDULE: pehla dhamaka sabse BADA, phir har agla ~half (aftershock), random location =====
  const S=MX._imp2||(MX._imp2={ev:[],r:MX.rng(77),cur:-.8,I:.1,fx:.5,fy:.5}), R=S.r;
  while(!S.ev.length||S.ev[S.ev.length-1].hit<t+8){
    let I=S.I*(.5+R()*.13), quiet=0;
    if(I<.2){I=.88+R()*.12; quiet=1.4+R()*2.4}      // sequence khatam -> sannata -> phir naya bada dhamaka
    S.I=I;
    let fx,fy,tries=0;
    do{fx=.15+R()*.7; fy=.25+R()*.5; tries++}while(tries<6&&Math.hypot(fx-S.fx,fy-S.fy)<.25);
    S.fx=fx; S.fy=fy;
    const s=S.cur+quiet, hit=s+.15+.4*I;
    S.ev.push({s,hit,I,fx,fy,dur:1.1+1.6*I,seed:S.ev.length*17+3});
    S.cur=hit+.5+R()*1.0+I*.5;
  }
  const act=[];
  for(let i=S.ev.length-1;i>=0;i--){const e=S.ev[i]; if(e.hit+e.dur<t-3)break; if(t>=e.s&&t<e.hit+e.dur)act.push(e)}

  // ===== CAMERA (smooth: attack + damped low-freq sines, koi random jitter nahi) =====
  let z=1.06, x=Math.sin(t*.8)*5, y=Math.cos(t*.6)*4, rot=0, en=0;
  for(const e of act){
    const I=e.I, ex=e.fx*W, ey=e.fy*H;
    if(t<e.hit){
      const pp=E((t-e.s)/(e.hit-e.s));
      z+=.045*I*pp; x+=Math.sin(t*37)*2.5*I*pp*pp; y+=Math.cos(t*41)*2.5*I*pp*pp;
      en=Math.max(en,pp*pp*I*.6);
    }else{
      const d=t-e.hit, att=E(Math.min(1,d/.06)), dec=Math.exp(-d*(3.6+(1-I)*3));
      z+=(.15*I*Math.exp(-d*5.5))*att;
      x+=(Math.sin(d*19)+.6*Math.sin(d*31+1.3))*26*I*dec*att+(cx-ex)*.06*I*Math.exp(-d*6)*att;
      y+=(Math.sin(d*23+.8)+.5*Math.sin(d*37))*20*I*dec*att+(cy-ey)*.06*I*Math.exp(-d*6)*att;
      rot+=Math.sin(d*22)*.012*I*dec*att*(e.fx<.5?1:-1);
      en=Math.max(en,I*Math.exp(-d*2.2));
    }
  }
  MX.cover(c,img,W,H,{z:z,x:x,y:y,r:rot});

  // ===== GRADE =====
  c.save();c.globalCompositeOperation='multiply';
  c.fillStyle=`rgb(${255-35*en|0},${248-45*en|0},${236-65*en|0})`;c.fillRect(0,0,W,H);c.restore();

  // ===== EFFECTS (circle/ring hata diya) =====
  for(const e of act){
    if(t<e.hit)continue;
    const d=t-e.hit, I=e.I, ex=e.fx*W, ey=e.fy*H, r=MX.rng(e.seed);
    const att=E(Math.min(1,d/.04));

    MX.flash(c,W,H,I>.8?'#fff':'#ffe9c8',(.1+.5*I)*Math.exp(-d*16)*att);
    if(I>.5)MX.flash(c,W,H,'#ff9a3c',.18*I*Math.exp(-d*5)*att);

    c.save();c.globalCompositeOperation='lighter';
    // blast glow (epicenter se)
    const gr=(140+460*I)*(1-Math.exp(-d*4.5))+40;
    let g=c.createRadialGradient(ex,ey,0,ex,ey,gr);
    g.addColorStop(0,`rgba(255,225,160,${.85*I*Math.exp(-d*6)*att})`);
    g.addColorStop(.35,`rgba(255,120,40,${.35*I*Math.exp(-d*5.5)*att})`);
    g.addColorStop(1,'rgba(255,80,0,0)');
    c.fillStyle=g;c.fillRect(0,0,W,H);

    // speed lines sirf bade hit pe
    if(I>.45&&d<.3){
      const q=1-d/.3,n=10+34*I|0;c.strokeStyle=`rgba(255,255,255,${.45*q*I})`;
      for(let i=0;i<n;i++){
        const an=r()*6.283,r0=diag*(.12+r()*.2)+d*800,r1=r0+diag*(.08+r()*.2*I);
        c.lineWidth=1+r()*2.5*I;c.beginPath();
        c.moveTo(ex+Math.cos(an)*r0,ey+Math.sin(an)*r0);c.lineTo(ex+Math.cos(an)*r1,ey+Math.sin(an)*r1);c.stroke();
      }
    }
    // sparks (streaks)
    const ns=8+42*I|0;
    for(let i=0;i<ns;i++){
      const an=r()*6.283,sp=(200+r()*900)*(.45+.75*I),life=.45+r()*.8,q=1-d/life;if(q<=0)continue;
      const k=1-Math.exp(-d*4),px=ex+Math.cos(an)*sp*k*.25,py=ey+Math.sin(an)*sp*k*.25+480*d*d;
      const vx=Math.cos(an)*sp*Math.exp(-d*4),vy=Math.sin(an)*sp*Math.exp(-d*4)+960*d;
      c.strokeStyle=`rgba(255,${150+r()*90|0},60,${q})`;c.lineWidth=1+r()*2.2*q;
      c.beginPath();c.moveTo(px,py);c.lineTo(px-vx*.03,py-vy*.03);c.stroke();
    }
    c.restore();

    // cracks (bade hit pe zameen/deewar phatne jaisa)
    if(I>.5){
      const q=Math.max(0,1-d/(.8+.8*I)),gro=1-Math.exp(-d*9),nb=5+(I*5|0);
      for(let b=0;b<nb;b++){
        let px=ex,py=ey,an=r()*6.283;const segs=5+(r()*4|0),L=(60+r()*160)*I*gro;
        const pts=[[px,py]];
        for(let s=0;s<segs;s++){an+=(r()-.5)*.9;px+=Math.cos(an)*L/segs*1.8;py+=Math.sin(an)*L/segs*1.8;pts.push([px,py])}
        for(const [col,lw] of [['rgba(255,170,80,'+.5*q+')',3.5],['rgba(10,6,4,'+.9*q+')',1.6]]){
          c.strokeStyle=col;c.lineWidth=lw;c.beginPath();c.moveTo(pts[0][0],pts[0][1]);
          for(let s=1;s<pts.length;s++)c.lineTo(pts[s][0],pts[s][1]);c.stroke();
        }
      }
    }

    // rock debris
    const nd=5+25*I|0;
    for(let i=0;i<nd;i++){
      const an=-Math.PI/2+(r()-.5)*3.6,sp=(200+r()*700)*(.45+.65*I),s=(4+r()*13)*(.55+.65*I),life=1+r()*.9;
      const q=1-d/life,spin=(r()-.5)*12,sh=.35+r()*.3,ph=r()*6.28;if(q<=0)continue;
      const k=1-Math.exp(-d*3),px=ex+Math.cos(an)*sp*k*.33,py=ey+Math.sin(an)*sp*k*.33+1200*d*d;
      c.save();c.translate(px,py);c.rotate(ph+spin*d);c.globalAlpha=Math.min(1,q*1.6);
      c.fillStyle=`rgb(${95+sh*120|0},${80+sh*100|0},${62+sh*80|0})`;
      c.beginPath();c.moveTo(-s,-s*.5);c.lineTo(s*.2,-s);c.lineTo(s,s*.3);c.lineTo(-s*.4,s*.8);c.closePath();c.fill();c.restore();
    }
    c.globalAlpha=1;

    // dust
    const nu=2+8*I|0;
    for(let i=0;i<nu;i++){
      const an=r()*6.283,sp=100+r()*380*I,rad=(70+r()*120*(.5+I))*(1+d*1.5);
      const al=.28*I*Math.max(0,1-d/(1+1.4*I))*Math.min(1,d*6);
      const px=ex+Math.cos(an)*sp*Math.sqrt(d)*1.1,py=ey+Math.sin(an)*sp*Math.sqrt(d)*.8-30*d;
      const gg=c.createRadialGradient(px,py,0,px,py,rad);
      gg.addColorStop(0,`rgba(200,175,135,${al})`);gg.addColorStop(1,'rgba(200,175,135,0)');
      c.fillStyle=gg;c.fillRect(px-rad,py-rad,rad*2,rad*2);
    }
  }

  // ===== BARS + VIGNETTE =====
  const bar=H*.055*E(Math.min(1,en*1.5));
  c.fillStyle='#000';c.fillRect(0,0,W,bar);c.fillRect(0,H-bar,W,bar);
  MX.vig(c,W,H,'rgba(0,0,0,.9)',.3+.35*en);
}},

]);

})();