// Browser flow on a real disposable API database. Only the two AI endpoints
// are test fixtures, clearly marked in screenshots; this is NOT a live AI eval.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:8001';
const card = {title:'Сократить списания — UI проверка',context:'В магазине остаются продукты',need:'Снизить списания',users:'Менеджеры магазина',data:'',constraints:'',expected_result:'',success_criteria:'',contact:'',interaction_format:''};
const questions = [
  {id:'q1',field:'users',text:'Кто будет пользоваться решением?'},
  {id:'q2',field:'data',text:'Какие данные доступны?'},
  {id:'q3',field:'expected_result',text:'Какой результат нужен?'}
];
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const directory=path.join(__dirname,'screenshots','flow');
  fs.mkdirSync(directory,{recursive:true});
  try {
    for (const width of [1366,390]) {
      const taskTitle=card.title+' '+width+' / '+new Date().toISOString().slice(11,19);
      const page=await browser.newPage({viewport:{width,height:768},reducedMotion:'reduce'});
      const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      let failAI=true;
      await page.route('**/api/ai/questions',route=>route.fulfill({json:failAI
        ? {error:{message:'Ключ AI на сервере не настроен'}} : {questions},status:failAI?503:200}));
      await page.route('**/api/ai/card',route=>route.fulfill({json:{card,topic:'Ритейл'}}));
      async function checkLayout(name) {
        const sizes=await page.evaluate(()=>({viewport:innerWidth,available:document.documentElement.clientWidth,content:document.documentElement.scrollWidth}));
        assert(sizes.content<=sizes.available,`${name}: ${JSON.stringify(sizes)}`);
        // Inspect every visible control's bounding box, not just the root width.
        const clipped=await page.locator('button,input,textarea,select').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).filter(n=>{const r=n.getBoundingClientRect();return r.left<0||r.right>document.documentElement.clientWidth+1;}).map(n=>n.id||n.textContent));
        assert.deepEqual(clipped,[],name+' controls');
        console.log('PASS',width,name,sizes);
      }
      async function shot(name) {
        await checkLayout(name);
        // A visible QA caption makes the AI fixture explicit in every flow image.
        await page.evaluate(()=>{
          let note=document.getElementById('qa-caption');
          if(!note){note=document.createElement('div');note.id='qa-caption';document.body.append(note);}
          note.textContent='UI-проверка: ответы AI — тестовые; остальные действия — локальный API';
          note.style.cssText='position:fixed;bottom:0;left:0;right:0;padding:5px 12px;background:#fff4cf;color:#513b06;font:12px Arial;z-index:99';
        });
        await page.screenshot({path:path.join(directory,`${width}-${name}.png`)});
      }
      await page.goto(base);
      await page.locator('#business-task-list article').first().waitFor({state:'attached'});
      await checkLayout('create');
      assert.equal(await page.locator('#saved-tasks').getAttribute('open'),null);
      await page.locator('#new-task').click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'draft');
      await page.locator('#ask').click();
      await page.locator('#notice').filter({hasText:'не короче'}).waitFor();
      await page.locator('#draft').fill('В магазине много списаний. Хотим их сократить.');
      await page.locator('#ask').click();
      await page.locator('#notice').filter({hasText:'Ключ AI'}).waitFor();
      assert.equal(await page.locator('#draft').inputValue(),'В магазине много списаний. Хотим их сократить.');
      failAI=false;
      await page.locator('#ask').click();
      await page.locator('#answer-q1').waitFor();
      await page.locator('#answer-q1').fill('Менеджеры магазина');
      await page.locator('#answer-q2').fill('Есть CSV со списаниями');
      await page.locator('#answer-q3').fill('Отчёт о причинах списаний');
      await shot('questions');
      await page.locator('#generate').click();
      await page.locator('#field-title').waitFor();
      assert.equal(await page.locator('#editor-kind').textContent(),'Новая карточка от AI');
      await shot('new-editor');
      await page.locator('#field-title').fill(taskTitle);
      await page.locator('#save').click();
      await page.locator('#notice').filter({hasText:'Карточка сохранена'}).waitFor();
      assert.equal(await page.locator('#score').innerText(),'0');
      assert.equal(await page.locator('#editor-kind').textContent(),'Сохранённый черновик');
      for(const key of ['context','need','users']) await page.locator('#confirm-'+key).check();
      await page.locator('#save').click();
      await page.locator('#score').filter({hasText:'30'}).waitFor();
      const status=await page.locator('#task-state').innerText();
      const id=Number(status.match(/№(\d+)/)[1]);
      const count=(await (await page.request.get(base+'/api/business/tasks')).json()).tasks.length;
      await page.reload();
      await page.locator('#saved-tasks > summary').click();
      await page.locator('#business-task-list article').filter({hasText:taskTitle}).getByRole('button').click();
      await page.locator('#field-title').waitFor();
      assert((await page.locator('#task-state').innerText()).includes('№'+id));
      assert.equal(await page.locator('#draft').inputValue(),'');
      assert.equal(await page.locator('#question-list textarea').count(),0);
      await page.locator('#field-context').fill('В магазине остаются непроданные продукты');
      assert.equal(await page.locator('#confirm-context').isChecked(),false);
      await page.locator('#saved-tasks > summary').click();
      page.once('dialog',dialog=>dialog.dismiss());
      await page.locator('#business-task-list button').last().click();
      assert.equal(await page.locator('#field-context').inputValue(),'В магазине остаются непроданные продукты');
      await page.locator('#saved-tasks > summary').click();
      await page.locator('#save').click();
      await page.locator('#score').filter({hasText:'20'}).waitFor();
      await page.locator('#confirm-context').check();
      await page.locator('#save').click();
      await page.locator('#score').filter({hasText:'30'}).waitFor();
      assert.equal((await (await page.request.get(base+'/api/business/tasks')).json()).tasks.length,count);
      await page.locator('#publish').click();
      await page.locator('#editor-kind').filter({hasText:'Опубликованная задача'}).waitFor();
      await page.locator('#editor-title').evaluate(node=>node.scrollIntoView());
      await shot('published-editor');
      await page.locator('[data-view="catalog"]').click();
      await page.locator('#task-list article').first().waitFor();
      await page.locator('#topic-filter').selectOption('Ритейл');
      await page.locator('#level-filter').selectOption('draft');
      await page.locator('#task-list article').filter({hasText:taskTitle}).waitFor();
      await shot('catalog');
      await page.locator('#task-list article').filter({hasText:taskTitle}).getByRole('button').click();
      await page.locator('#task-detail form').waitFor();
      for(const team of ['1','2']) {
        await page.locator('#task-detail select').selectOption(team);
        await page.getByLabel('Идея решения').fill('Панель анализа списаний '+team);
        await page.getByLabel('План',{exact:true}).fill('Собрать отчёты и проверить прототип');
        await page.getByLabel('Срок в днях').fill('14');
        await page.getByLabel('Ссылка на прототип').fill('не-ссылка');
        await page.getByRole('button',{name:'Отправить предложение'}).click();
        await page.locator('#notice').filter({hasText:'полный URL'}).waitFor();
        await page.getByLabel('Ссылка на прототип').fill('https://example.org/ui-check');
        await page.getByRole('button',{name:'Отправить предложение'}).click();
        await page.locator('#notice').filter({hasText:'Предложение отправлено'}).waitFor();
      }
      await page.locator('[data-view="business"]').click();
      await page.locator('#business-task option').first().waitFor({state:'attached'});
      await page.locator('#business-task').selectOption(String(id));
      await page.locator('#proposal-list article').nth(1).waitFor();
      for(let index=0;index<2;index++){
        await page.locator('#proposal-list article').nth(index).getByRole('button',{name:'Выбрать',exact:true}).click();
        await page.locator('#proposal-list article').nth(index).getByRole('button',{name:'Подтвердить этап +10'}).waitFor();
      }
      for(let index=0;index<2;index++){
        await page.locator('#proposal-list article').nth(index).getByRole('button',{name:'Подтвердить этап +10'}).click();
        await page.locator('#proposal-list article').nth(index).getByRole('button',{name:'Этап подтверждён',exact:true}).waitFor();
        assert(await page.locator('#proposal-list article').nth(index).getByRole('button',{name:'Этап подтверждён',exact:true}).isDisabled());
      }
      const teamsBefore=await (await page.request.get(base+'/api/teams')).json();
      const proposals=(await (await page.request.get(base+`/api/tasks/${id}/proposals`)).json()).proposals;
      for(const proposal of proposals) await page.request.post(base+`/api/proposals/${proposal.id}/milestones/confirm`,{data:{}});
      assert.deepEqual(await (await page.request.get(base+'/api/teams')).json(),teamsBefore);
      await page.evaluate(()=>scrollTo(0,0)); await shot('selected-teams');
      await page.locator('[data-view="about"]').click();
      await checkLayout('about');
      assert((await page.locator('#about').innerText()).includes('без авторизации'));
      await page.locator('[data-view="create"]').click();
      assert((await page.locator('#task-state').innerText()).includes('№'+id));
      await page.locator('#saved-tasks > summary').click();
      await checkLayout('saved-list');
      assert.deepEqual(errors,[]);
      console.log('PASS',width,'reload → same ID; 0→30→20→30; publish 30; two proposals and selected teams; milestones once; no JS errors');
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
