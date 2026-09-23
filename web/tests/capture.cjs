// Capture the real UI with seeded example data, without substituting API results.
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const phase = process.argv[2] || 'after';
  const directory = path.join(__dirname, 'screenshots', phase);
  fs.mkdirSync(directory, {recursive:true});
  const browser = await chromium.launch({headless:true, channel:'msedge'});
  const page = await browser.newPage({viewport:phase==='final'?{width:1280,height:720}:{width:1366,height:768}, reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:8001');
  await page.locator('#business-task-list article').first().waitFor({state:'attached'});
  async function shot(name) {await page.screenshot({path:path.join(directory, `${name}.png`)});}
  await shot('desktop-create');
  const saved = page.locator('#saved-tasks');
  if (await saved.count()) await saved.evaluate(node=>node.open=true);
  await page.locator('#business-task-list article').filter({hasText:'Упорядочить сообщения об остановках'}).getByRole('button',{name:'Продолжить редактирование'}).click();
  await page.locator('#field-title').waitFor();
  await page.locator('#editor').evaluate(node=>scrollTo(0,node.getBoundingClientRect().top+scrollY-72));
  await shot('desktop-editor');
  await page.locator('[data-view="catalog"]').click();
  await page.locator('#task-list article').first().waitFor();
  await page.evaluate(()=>scrollTo(0,0));
  await shot('desktop-catalog');
  await page.locator('[data-view="business"]').click();
  await page.locator('#proposal-list article').first().waitFor();
  await shot('desktop-proposals');
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:8001');
  await page.locator('#business-task-list article').first().waitFor({state:'attached'});
  await shot('mobile-create');
  if (await saved.count()) await saved.evaluate(node=>node.open=true);
  await page.locator('#business-task-list').scrollIntoViewIfNeeded();
  await shot('mobile-saved');
  console.log(JSON.stringify({phase, mobile:await page.evaluate(()=>({viewport:innerWidth, available:document.documentElement.clientWidth, content:document.documentElement.scrollWidth})), directory}));
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
