/* motions/filename.js */
//order:1,
(function(){
const {add}=MKIT;

add([


// 34
{
key:'m16',
name:'CSS Shine',
tag:'shine / floating',
order:10,
draw(c,img,p,t,W,H){

  // 1. Base Normal Floating Motion
  const driftX = 30 * Math.sin(t * 25 / 100);
  const driftY = 10 * Math.cos(t * 25 / 120);

  // Image ko cover karke floating motion apply karna
  c.save();
  c.translate(driftX * W / 1920, driftY * H / 1080);
  MX.cover(c,img,W,H);

  // 2. Shine Animation
  const shineDuration = 1.0; // 25 frames at 25 FPS
  const shineWidth = W * 0.4;

  // Random intervals ko deterministic rakhna,
  // taaki same time par render hone par animation stable rahe
  const cycle = Math.floor(t / 3);
  let seed = cycle * 127.1 + 311.7;
  const rand = Math.abs(Math.sin(seed) * 43758.5453) % 1;

  const shineStart = 2 + rand * 2;
  const localT = t % (shineStart + 3);

  if(localT < shineDuration){

    const progress = localT / shineDuration;
    const sineVal = Math.sin(progress * Math.PI);

    const direction = Math.floor(Math.abs(Math.sin(cycle * 78.233)) * 100) % 2 === 0 ? 1 : -1;

    const centerX = direction === 1
      ? W * progress * 1.5 - W * 0.25
      : W * (1 - progress * 1.5) + W * 0.25;

    const x1 = Math.max(0, centerX - shineWidth / 2);
    const x2 = Math.min(W, centerX + shineWidth / 2);

    if(x1 < x2){

      c.save();

      // Shine beam ki boundaries
      c.beginPath();
      c.rect(x1, 0, x2 - x1, H);
      c.clip();

      // Soft gradient shine
      const gradient = c.createLinearGradient(
        centerX - shineWidth / 2, 0,
        centerX + shineWidth / 2, 0
      );

      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.5, `rgba(255,255,255,${0.6 * sineVal})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');

      c.globalCompositeOperation = 'screen';
      c.fillStyle = gradient;
      c.fillRect(x1, 0, x2 - x1, H);

      c.restore();
    }
  }

  c.restore();
}},



]);

})();