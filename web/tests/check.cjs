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
    for(const width of [1280,1366,390,375]) {
      await page.setViewportSize({width,height:width===1280?720:768});
      await page.goto('http://127.0.0.1:8001');
      if(width>=1280) {
        for(const id of ['topic','draft','ask']) {
          const rect=await page.locator('#'+id).boundingBox();
          assert(rect.y>=0 && rect.y+rect.height<=page.viewportSize().height, id+' must fit the first screen');
        }
        console.log('PASS',width,'theme, draft and questions button fully visible without scrolling');
      }
      assert.equal(await page.locator('#new-task').innerText(),'Новая задача');
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
      assert.equal(await page.locator('#card-fields fieldset').count(),3);
      assert.equal(await page.locator('#card-fields input:not([type=checkbox]), #card-fields textarea').count(),10);
      assert.equal(await page.locator('#card-fields input[type=checkbox]').count(),9);
      assert((await page.locator('#task-state').innerText()).startsWith('Статус:'));
      assert(!(await page.locator('#level').innerText()).includes('опубликовано'));
      const before=await page.locator('#field-title').inputValue();
      await page.locator('#field-title').fill(before+' — правка');
      page.once('dialog',dialog=>dialog.dismiss());
      await page.locator('#new-task').click();
      assert.equal(await page.locator('#field-title').inputValue(),before+' — правка');
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await page.locator('#new-task').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
      await page.emulateMedia({reducedMotion:'no-preference'});
      assert.equal(await page.locator('#new-task').evaluate(node=>getComputedStyle(node).transitionDuration.split(',')[0]),'0.15s');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
      console.log('PASS',width,'keyboard: skip link, disclosure, resume, editor focus and visible outline');
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
