/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

{key:'m07', 
    name:'Energy Aura', 
    tag:'power-up / charging', 
    order:16,
    draw(c,img,p,t,W,H){
  const E=x=>x*x*(3-2*x), cx=W/2, cy=H/2, diag=Math.hypot(W,H);

  // ===== SCHEDULE: har cycle = CHARGE (dheere build) -> BURST (blast) -> AFTERGLOW. Power har baar alag =====
  const S=MX._ea||(MX._ea={ev:[],r:MX.rng(55),cur:.4,n:0}), R=S.r;
  while(!S.ev.length||S.ev[S.ev.length-1].end<t+10){
    const n=S.n++, big=n%4===3||R()<.15;                 // kabhi kabhi mega power-up
    const I=big?.85+R()*.15:.3+R()*.45;
    const ch=(big?2.6:1.3)+R()*1.2+I*.8;                 // charge time
    const bu=.5+I*.5, af=1.4+I*1.4;
    const hue=R()<.22?[255,150,60]:R()<.3?[190,120,255]:[60,220,255]; // kabhi orange / purple aura
    const s=S.cur, burst=s+ch;
    S.ev.push({s,burst,ch,bu,af,end:burst+af,I,hue,fx:.4+R()*.2,fy:.45+R()*.15,seed:n*19+4});
    S.cur=burst+af*.55+(R()<.35?1.8+R()*2.5:.3+R()*.9);   // kabhi lamba sannata
  }
  const act=[];
  for(let i=S.ev.length-1;i>=0;i--){const e=S.ev[i]; if(e.end<t-4)break; if(t>=e.s&&t<e.end)act.push(e)}

  // ===== envelopes =====
  let en=0,burstE=0,glowE=0,hue=[60,220,255],hi=-1;
  for(const e of act){
    const u=t-e.s;
    e.chp=Math.min(1,u/e.ch);                               // 0..1 charge progress
    e.chE=u<e.ch?Math.pow(e.chp,2.2):0;                     // slow build, tez peak
    const d=t-e.burst; e.d=d;
    e.bE=d>=0?Math.exp(-d*(3+ (1-e.I)*2))*E(Math.min(1,d/.05)):0;
    e.aE=d>=0?Math.exp(-d*1.6):0;
    const v=Math.max(e.chE*e.I,e.bE*e.I);
    if(v>en){en=v;hue=e.hue}
    burstE=Math.max(burstE,e.bE*e.I);
    glowE=Math.max(glowE,(e.chE*.8+e.aE*.5)*e.I);
  }
  const [hr,hg,hb]=hue, col=a=>`rgba(${hr},${hg},${hb},${a})`;

  // ===== camera: charge me slow push + tremble, burst pe punch =====
  let z=1.05+.01*Math.sin(t*.8), x=Math.sin(t*.6)*4, y=Math.cos(t*.5)*3, rot=0;
  for(const e of act){
    const I=e.I;
    if(e.d<0){const c2=e.chE; z+=.05*I*c2; x+=Math.sin(t*53)*2.2*I*c2*c2; y+=Math.cos(t*61)*2.2*I*c2*c2}
    else{const d=e.d,dec=Math.exp(-d*4.5); z+=.12*I*Math.exp(-d*5)-.01*I*Math.sin(Math.min(d*4,3.14)); x+=Math.sin(d*21)*14*I*dec; y+=Math.sin(d*27+1)*11*I*dec; rot+=Math.sin(d*18)*.006*I*dec}
  }
  MX.cover(c,img,W,H,{z:z,x:x,y:y,r:rot});

  // grade: idle me thoda dark, power ke saath color wash
  c.save();c.globalCompositeOperation='multiply';
  const dk=.82+.18*glowE; c.fillStyle=`rgb(${255*dk*(.85+.15*hr/255)|0},${255*dk*(.88+.12*hg/255)|0},${255*dk|0})`;c.fillRect(0,0,W,H);c.restore();

  // ===== idle: halke floating dust (sirf shant mood) =====
  c.save();c.globalCompositeOperation='lighter';
  {const r=MX.rng(9);
   for(let i=0;i<34;i++){const px=r()*W,sp=18+r()*40,py=H-((r()*H+t*sp)%H),a=.12*Math.sin(Math.PI*(1-py/H));
     c.fillStyle=`rgba(180,230,255,${a})`;c.beginPath();c.arc(px+Math.sin(t*.7+i)*14,py,1+r()*2,0,7);c.fill()}}

  // ===== effects per event =====
  for(const e of act){
    const I=e.I, r=MX.rng(e.seed), ex=e.fx*W, ey=e.fy*H, ec=`rgba(${e.hue[0]},${e.hue[1]},${e.hue[2]},`;

    if(e.d<0){ // ---------- CHARGE ----------
      const k=e.chE, u=t-e.s;
      // ground se upar uthti aura flames (taller as charge badhta hai)
      const nf=(10+26*I*k)|0;
      for(let i=0;i<nf;i++){
        const bx=cx+(r()-.5)*W*(.18+.3*k), sp=.5+r()*.9, ph=(u*sp*.9+r())%1, h=H*(.25+.55*k)*(.4+r()*.6);
        const px=bx+Math.sin(u*3+i)*22*(1-ph)+(r()-.5)*20, py=H*.98-ph*h, w=(8+r()*24)*(1-ph)*(.5+k);
        const g=c.createRadialGradient(px,py,0,px,py,w*2);
        g.addColorStop(0,ec+(.5*k*I*Math.sin(Math.PI*ph))+')');g.addColorStop(1,ec+'0)');
        c.fillStyle=g;c.fillRect(px-w*2,py-w*2,w*4,w*4);
      }
      // andar ki taraf sikudte (converging) energy particles
      const np=(14+60*I*k)|0;
      for(let i=0;i<np;i++){
        const an=r()*6.283, sp=.6+r()*.8, ph=1-((u*sp*.55+r())%1), rad=diag*.5*ph*(1.1-.5*k)+30;
        const px=cx+Math.cos(an+u*.5*(1-ph))*rad, py=cy*1.05+Math.sin(an+u*.5*(1-ph))*rad*.7;
        const a=(.2+.6*k)*Math.sin(Math.PI*(1-ph))*I;
        c.fillStyle=ec+a+')';c.beginPath();c.arc(px,py,1+r()*2.6*(.5+k),0,7);c.fill();
        if(k>.4){c.strokeStyle=ec+a*.5+')';c.lineWidth=1;c.beginPath();c.moveTo(px,py);c.lineTo(cx+Math.cos(an)*(rad+14+30*k),cy*1.05+Math.sin(an)*(rad+14+30*k)*.7);c.stroke()}
      }
      // core glow + chhoti electric arcs, peak ke paas
      const gr=120+380*k*(.6+.4*I)+14*Math.sin(u*9);
      let g=c.createRadialGradient(cx,cy,0,cx,cy,gr);
      g.addColorStop(0,ec+.5*k*I+')');g.addColorStop(.5,ec+.16*k*I+')');g.addColorStop(1,ec+'0)');
      c.fillStyle=g;c.fillRect(0,0,W,H);
      if(k>.55){
        const na=(2+6*I*k)|0, fl=Math.floor(u*18), rr=MX.rng(e.seed+fl);
        c.strokeStyle=`rgba(255,255,255,${.35+.5*k})`;c.lineWidth=1.4;
        for(let a2=0;a2<na;a2++){
          let px=cx+(rr()-.5)*80,py=cy+(rr()-.5)*80,an=rr()*6.283;c.beginPath();c.moveTo(px,py);
          for(let s=0;s<6;s++){an+=(rr()-.5)*1.3;px+=Math.cos(an)*(26+rr()*50)*(.6+k);py+=Math.sin(an)*(26+rr()*50)*(.6+k);c.lineTo(px,py)}
          c.stroke();
        }
      }
    }else{ // ---------- BURST + AFTERGLOW ----------
      const d=e.d, bE=e.bE, aE=e.aE;
      // energy wave (soft glow band, hard circle line nahi)
      const wr=diag*(.2+.5*I)*(1-Math.exp(-d*3.2)), wa=Math.max(0,1-d/(.7+.8*I));
      let g=c.createRadialGradient(cx,cy,Math.max(0,wr*.55),cx,cy,wr+30);
      g.addColorStop(0,ec+'0)');g.addColorStop(.75,ec+.4*wa*I+')');g.addColorStop(1,ec+'0)');
      c.fillStyle=g;c.fillRect(0,0,W,H);
      // core flash-glow
      g=c.createRadialGradient(cx,cy,0,cx,cy,(180+520*I)*(1-Math.exp(-d*4))+40);
      g.addColorStop(0,`rgba(255,255,255,${.7*bE})`);g.addColorStop(.3,ec+.5*bE+')');g.addColorStop(1,ec+'0)');
      c.fillStyle=g;c.fillRect(0,0,W,H);
      // light rays
      if(I>.4&&d<1){
        const nr=(8+14*I)|0,rot2=r()*6.283;
        for(let i=0;i<nr;i++){const an=rot2+i/nr*6.283+d*.3,L=diag*(.25+.5*I)*(1-Math.exp(-d*5)),w=.025+.02*r();
          const g2=c.createLinearGradient(cx,cy,cx+Math.cos(an)*L,cy+Math.sin(an)*L);
          g2.addColorStop(0,`rgba(255,255,255,${.4*bE})`);g2.addColorStop(1,ec+'0)');
          c.fillStyle=g2;c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+Math.cos(an-w)*L,cy+Math.sin(an-w)*L);c.lineTo(cx+Math.cos(an+w)*L,cy+Math.sin(an+w)*L);c.closePath();c.fill()}
      }
      // sparks bahar ki taraf + gravity-free float
      const ns=(12+50*I)|0;
      for(let i=0;i<ns;i++){
        const an=r()*6.283,sp=(150+r()*800)*(.5+.7*I),life=.7+r()*1.3,q=1-d/life;if(q<=0)continue;
        const k2=1-Math.exp(-d*3.2),px=cx+Math.cos(an)*sp*k2*.4,py=cy+Math.sin(an)*sp*k2*.4-30*d;
        c.fillStyle=ec+q*.9+')';c.beginPath();c.arc(px,py,(1+r()*3)*q,0,7);c.fill();
      }
      // afterglow: halka aura jo dheere bujhta hai
      g=c.createRadialGradient(cx,cy,0,cx,cy,300+240*I);
      g.addColorStop(0,ec+.22*aE*I+')');g.addColorStop(1,ec+'0)');
      c.fillStyle=g;c.fillRect(0,0,W,H);
    }
  }
  c.restore();

  // burst flash
  if(burstE>.02)MX.flash(c,W,H,'#fff',.45*burstE);

  // ===== bars + vignette (power ke saath tight) =====
  const bar=H*.05*E(Math.min(1,en*1.4));
  c.fillStyle='#000';c.fillRect(0,0,W,bar);c.fillRect(0,H-bar,W,bar);
  MX.vig(c,W,H,`rgba(${hr>>3},${hg>>3},${hb>>2},.9)`,.35+.3*en);
}},


]);

})();