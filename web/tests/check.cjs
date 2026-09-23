// Uses installed Playwright + Edge; no project dependencies are added.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1366,height:768}});
    await page.goto('http://127.0.0.1:8001/static/tests/ui.html');
    await page.waitForFunction(()=>/Завершено|ERROR/.test(document.getElementById('results').textContent),{},{timeout:30000});
    const results = await page.locator('#results').innerText();
    console.log(results);
    assert(!/FAIL|ERROR/.test(results));
    for(const width of [1366,390]) {
      await page.setViewportSize({width,height:768});
      await page.goto('http://127.0.0.1:8001');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.textContent),'К содержимому');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
      await page.locator('#saved-tasks > summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#saved-tasks').getAttribute('open'),'');
      await page.locator('#business-task-list button').first().focus();
      await page.keyboard.press('Enter');
      await page.locator('#editor-title').waitFor();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'editor-title');
      await page.locator('#field-title').focus();
      assert.equal(await page.locator('#field-title').evaluate(node=>getComputedStyle(node).outlineStyle),'solid');
      console.log('PASS',width,'keyboard: skip link, disclosure, resume, editor focus and visible outline');
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
