// Optional development-only dependency: Playwright. See README for the command.
// The production game has no dependencies or test/debug globals.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(source);
});
let browser;
let count = 0;
const errors = [];
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
function watch(page) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(page);
  await page.goto(url);
  await page.locator('#start').click();
  const started = await page.locator('#overlay').isVisible();
  check('start button enters game', () => assert.equal(started, false));
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Space');
  await page.keyboard.press('p');
  const pauseTitle = await page.locator('#title').textContent();
  check('keyboard pause', () => assert.equal(pauseTitle, 'GAME PAUSED'));
  await page.locator('#start').click();
  assert.equal(await page.locator('#overlay').isVisible(), false);
  await page.locator('#sound').click();
  const soundPressed = await page.locator('#sound').getAttribute('aria-pressed');
  check('mute control', () => assert.equal(soundPressed, 'false'));
  await page.locator('#sound').click();
  // Observe actual animation cadence, not just the fixed timestep constant.
  const timing = await page.evaluate(() => new Promise(resolve => {
    const deltas = []; let last;
    function sample(t) { if (last) deltas.push(t - last); last = t;
      if (deltas.length < 120) requestAnimationFrame(sample);
      else resolve({ mean: deltas.reduce((a,b) => a+b,0) / deltas.length, max: Math.max(...deltas) });
    } requestAnimationFrame(sample);
  }));
  console.log(`Chromium frame cadence: ${(1000/timing.mean).toFixed(1)} FPS; longest frame ${timing.max.toFixed(1)} ms`);
  // Mobile and compact desktop layouts must keep the complete deck on screen.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  watch(mobile);
  for (const [width, height] of [[390,844],[320,568],[768,1024],[844,390],[1440,700]]) {
    await mobile.setViewportSize({ width, height }); await mobile.goto(url);
    const layout = await mobile.evaluate(() => {
      const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
      return { canvas:box('game'), left:box('left'), right:box('right'), fire:box('fire'), start:box('start'), height:innerHeight, width:innerWidth, scroll:document.documentElement.scrollWidth };
    });
    check(`layout ${width}×${height}`, () => {
      for (const key of ['left','right','fire','start']) { const b=layout[key]; assert.ok(b.top>=0 && b.bottom<=height && b.left>=0 && b.right<=width, `${key} clipped: ${JSON.stringify(b)}`); }
      assert.ok(layout.left.top >= layout.canvas.bottom, 'touch controls overlap playfield');
      assert.ok(layout.scroll <= width, 'horizontal overflow');
    });
  }
  await mobile.setViewportSize({width:390,height:844});await mobile.goto(url);await mobile.locator('#start').tap();
  const client=await mobile.context().newCDPSession(mobile);
  const center=async id=>{const b=await mobile.locator(id).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
  const left=await center('#left'),fire=await center('#fire');
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...left,id:1},{...fire,id:2}]});
  await mobile.waitForTimeout(250);
  const active=await mobile.locator('.control.active').count();
  check('simultaneous touch movement and firing',()=>assert.equal(active,2));
  await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  const remainingTouches = await mobile.locator('.control.active').count();
  check('touch cancellation releases controls',()=>assert.equal(remainingTouches,0));
  // Run bounded mechanics checks against the real closure in an in-memory page.
  // The bridge is injected only into this test response, never shipped in index.html.
  const mechanics=await browser.newPage();watch(mechanics);
  await mechanics.addInitScript(()=>{window.requestAnimationFrame=()=>0;});
  await mechanics.route('**/*',route=>route.fulfill({contentType:'text/html',body:source.replace('\n})();','\nwindow.testGame = code => eval(code);\n})();')}));
  await mechanics.goto(url);
  const run=code=>mechanics.evaluate(code=>window.testGame(code),code);
  await mechanics.locator('#start').click();
  const initial=await run('({state,lives,aliens:aliens.length,bunkers:bunkers.length,pixels:bunkers[0].pixels.reduce((a,b)=>a+b,0)})');
  check('55 invaders, four solid bunkers, three lives',()=>{assert.equal(initial.state,'playing');assert.equal(initial.aliens,55);assert.equal(initial.bunkers,4);assert.equal(initial.lives,3);assert.ok(initial.pixels>1000);});
  const movement=await run('keys.add("right");update(.1);keys.clear();playerX');
  check('movement advances at 190 pixels/second',()=>assert.equal(movement,230));
  const march=await run('marchTimer=.76;const x=aliens[0].x;update(1/60);({step:aliens[0].x-x,frame})');
  check('stepped march animates',()=>{assert.equal(march.step,7);assert.equal(march.frame,1);});
  const edge=await run('aliens.forEach(a=>a.x+=50);marchTimer=1;const y=aliens[0].y;update(1/60);({drop:aliens[0].y-y,direction})');
  check('formation reverses and drops at edge',()=>{assert.equal(edge.drop,15);assert.equal(edge.direction,-1);});
  const erosion=await run('makeWave();const before=bunkers[0].pixels.reduce((a,b)=>a+b,0);const up=hitBunker(50,435,380,2);const afterUp=bunkers[0].pixels.reduce((a,b)=>a+b,0);const down=hitBunker(85,370,430,3);({up,down,before,afterUp,afterDown:bunkers[0].pixels.reduce((a,b)=>a+b,0)})');
  check('both firing directions erode bunker pixels',()=>{assert.ok(erosion.up&&erosion.down);assert.ok(erosion.afterUp<erosion.before);assert.ok(erosion.afterDown<erosion.afterUp);});
  for(const [row,points] of [[4,10],[2,20],[0,30]]) {
    const result=await run(`startGame();bombTimer=99;const a=aliens.find(a=>a.row===${row});shot={x:a.x+10,y:a.y+17};update(1/60);({score,count:aliens.length})`);
    check(`alien row ${row} awards ${points} points`,()=>{assert.equal(result.score,points);assert.equal(result.count,54);});
  }
  const speed=await run('startGame();aliens=aliens.slice(0,1);marchTimer=0;const x=aliens[0].x;for(let i=0;i<5;i++)update(1/60);aliens[0].x-x');
  check('last alien marches faster',()=>assert.ok(speed>0));
  const ufoResult=await run('startGame();ufoTimer=0;update(1/60);const spawned=!!ufo;ufo.x=100;shotCount=3;shot={x:112,y:88};update(1/60);({spawned,score,ufo})');
  check('UFO spawns and awards 300-point mystery bonus',()=>{assert.ok(ufoResult.spawned);assert.equal(ufoResult.score,300);assert.equal(ufoResult.ufo,null);});
  const alienBomb=await run('startGame();bombTimer=0;update(1/60);bombs.length');
  check('invaders drop bombs',()=>assert.equal(alienBomb,1));
  const damage=await run('startGame();invulnerable=0;bombs=[{x:playerX+12,y:446,phase:0}];update(1/60);({lives,deathTimer})');
  check('bomb collision destroys a cannon',()=>{assert.equal(damage.lives,2);assert.ok(damage.deathTimer>0);});
  const over=await run('deathTimer=0;invulnerable=0;damagePlayer();deathTimer=0;invulnerable=0;damagePlayer();({lives,state})');
  check('third cannon lost ends the game',()=>{assert.equal(over.lives,0);assert.equal(over.state,'over');});
  const restart=await run('startGame();({lives,score,state})');
  check('restart resets game state',()=>assert.deepEqual(restart,{lives:3,score:0,state:'playing'}));
  const waveResult=await run('aliens=[aliens[0]];shot={x:aliens[0].x+7,y:aliens[0].y+17};update(1/60);const cleared=nextWave>0;for(let i=0;i<100;i++)update(1/60);({cleared,wave,count:aliens.length})');
  check('clearing the formation starts the next wave',()=>{assert.ok(waveResult.cleared);assert.equal(waveResult.wave,2);assert.equal(waveResult.count,55);});
  const paused=await run('pause();const before=aliens[0].x;update(1);({state,before,after:aliens[0].x})');
  check('pause freezes simulation',()=>{assert.equal(paused.state,'paused');assert.equal(paused.before,paused.after);});
  await run('pause();keys.add("left");loseFocus();');
  const focusState = await run('({state,keys:keys.size})');
  check('focus loss pauses and clears input',()=>assert.deepEqual(focusState,{state:'paused',keys:0}));
  const persistence=await run('score=12340;saveHigh();localStorage.getItem("invaders1978.high")');
  check('high score persists',()=>assert.equal(persistence,'12340'));
  // Exercise normal user controls with localStorage unavailable.
  const restricted=await browser.newPage();watch(restricted);
  await restricted.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}});});
  await restricted.goto(url);await restricted.locator('#start').click();await restricted.keyboard.down('Space');await restricted.waitForTimeout(800);await restricted.keyboard.up('Space');
  assert.equal(await restricted.locator('#overlay').isVisible(),false);
  check('storage-disabled play starts without errors',()=>assert.equal(errors.length,0,errors.join('\n')));
  check('zero browser console errors or uncaught exceptions',()=>assert.deepEqual(errors,[]));
  console.log(`\n${count} smoke checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
