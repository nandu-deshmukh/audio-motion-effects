/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([

//36
{key:'m15', 
    name:'3D Card Flip & Dynamic BG', 
    tag:'3d / card flip', 
    order:9,
    draw(c,img,p,t,W,H){
  // 1. Vibrant Background Color Pool
  const bgColors = [
    [30, 30, 40],     // Dark Slate
    [120, 40, 80],    // Deep Purple / Magenta
    [20, 80, 120],    // Ocean Blue
    [80, 40, 20],     // Rich Brown / Bronze
    [10, 90, 90],     // Teal
    [60, 20, 60]      // Plum
  ];

  const cycleTime = 4.5;
  const cycle = t / cycleTime;
  const cycleIdx = Math.floor(cycle);
  const cycleProgress = cycle - cycleIdx;
  
  const rng1 = MX.rng(cycleIdx * 17 + 3);
  const rng2 = MX.rng(cycleIdx * 17 + 4);
  const color1Idx = Math.floor(rng1() * bgColors.length);
  let color2Idx = Math.floor(rng2() * bgColors.length);
  if (color2Idx === color1Idx) color2Idx = (color1Idx + 1) % bgColors.length;
  
  const c1 = bgColors[color1Idx];
  const c2 = bgColors[color2Idx];
  
  const flipDurationRatio = 0.35;
  let bgProgress = 1.0;
  let angle = 0.0;
  
  if (cycleProgress < flipDurationRatio) {
    const flipP = cycleProgress / flipDurationRatio;
    bgProgress = flipP;
    angle = flipP * Math.PI * 2.0; // 360-degree Y-axis 3D flip rotation
  } else {
    bgProgress = 1.0;
    angle = 0.0;
  }
  
  // Interpolate background color smoothly
  const rBg = Math.round(c1[0] + (c2[0] - c1[0]) * bgProgress);
  const gBg = Math.round(c1[1] + (c2[1] - c1[1]) * bgProgress);
  const bBg = Math.round(c1[2] + (c2[2] - c1[2]) * bgProgress);
  
  c.fillStyle = `rgb(${rBg}, ${gBg}, ${bBg})`;
  c.fillRect(0, 0, W, H);
  
  // 2. Floating Drift Effect & 3D Y-Axis Flip with Correct Cover Dimensions
  const driftX = 15 * Math.sin(t * 1.25);
  const driftY = 8 * Math.cos(t * 1.0);
  
  c.save();
  c.translate(W / 2 + driftX, H / 2 + driftY);
  
  const cosA = Math.cos(angle);
  c.scale(cosA, 1.0); // 3D Perspective width compression
  
  if (Math.abs(cosA) < 0.99) {
    c.globalAlpha = 0.85 + 0.15 * Math.abs(cosA);
  }
  
  // Proper Cover Aspect Ratio Calculation (MX.cover jaisa exact fit)
  const iw = img.width || W;
  const ih = img.height || H;
  const s = Math.max(W / iw, H / ih);
  const drawW = iw * s;
  const drawH = ih * s;
  
  c.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  
  c.restore();
  
  // 3. Cinematic Vignette
  MX.vig(c, W, H, 'rgba(0,0,0,.85)', 0.35);
}},


]);

})();