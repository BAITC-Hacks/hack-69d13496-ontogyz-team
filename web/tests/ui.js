/* Isolated browser regression tests. Never loaded by the production page. */
(async () => {
  const output = document.getElementById("results");
  const frame = document.getElementById("preview");
  const html = await (await fetch("/", {cache:"no-store"})).text();
  const app = await (await fetch("/static/app.js", {cache:"no-store"})).text();
  frame.srcdoc = html.replace('<script defer src="/static/app.js"></script>', '');
  await new Promise(resolve => frame.addEventListener("load", resolve, {once:true}));
  const win = frame.contentWindow, doc = win.document;
  const byId = id => doc.getElementById(id);
  const requests = [];
  let failCard = true, failSave = false, saved = null, testRace = false;
  const card = {title:"Тестовая карточка",context:"В магазине остаются продукты",need:"Снизить списания",users:"Менеджеры",data:"",constraints:"",expected_result:"",success_criteria:"",contact:"",interaction_format:""};
  win.fetch = async (path, options = {}) => {
    const method = options.method || "GET";
    requests.push({path, method});
    await new Promise(resolve => setTimeout(resolve, path === "/api/tasks/1/proposals" ? 300 : 150));
    let status = 200, body;
    if (path === "/api/ai/questions") body = {questions:[{id:"q1",field:"users",text:"Кто пользуется решением?"},{id:"q2",field:"data",text:"Какие данные доступны?"},{id:"q3",field:"expected_result",text:"Что ожидаете?"}]};
    else if (path === "/api/ai/card") {
      if (failCard) {status=503; body={error:{message:"Тестовая ошибка AI"}};}
      else body={card,topic:"Ритейл"};
    } else if (path.startsWith("/api/tasks") && ["POST","PUT"].includes(method)) {
      if (failSave) {status=503; body={error:{message:"Тестовая ошибка сохранения"}};}
      else {
        const payload=JSON.parse(options.body);
        const weights={context:10,need:10,users:10,data:20,constraints:10,expected_result:15,success_criteria:15,contact:5,interaction_format:5};
        const breakdown=Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,payload.confirmed_fields.includes(k)&&payload.card[k]?v:0]));
        saved={...payload,id:91,status:"draft",score:Object.values(breakdown).reduce((a,b)=>a+b,0),level:"draft",score_breakdown:breakdown,missing_fields:Object.keys(breakdown).filter(k=>!breakdown[k])};
        body=saved;
      }
    } else if (path === "/api/business/tasks") body={tasks:saved?[saved]:[]};
    else if (path === "/api/tasks/91" && method === "GET") body=saved;
    else if (path.endsWith("/proposals")) body={proposals:[{id:1,team_id:1,idea:path.includes('/1/')?'СТАРАЯ ЗАДАЧА':'НОВАЯ ЗАДАЧА',plan:'План проверки',duration_days:14,points:0,status:'pending',prototype_url:'https://example.org/test'}]};
    else if (path === "/api/tasks") body={tasks:testRace?[{id:1,card,topic:"Ритейл",score:30,level:"draft"},{id:2,card,topic:"Ритейл",score:30,level:"draft"},{id:3,card,topic:"Экология",score:95,level:"priority"}]:[]};
    else if (path === "/api/teams") body={teams:[{id:1,name:"Команда 1",points:0,skills:["Аналитика","UX"],technologies:["Python","FastAPI"]}]};
    else throw new Error(`Unexpected test request: ${method} ${path}`);
    return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
  };
  const script=doc.createElement("script"); script.textContent=app; doc.body.append(script);
  const lines=[];
  function check(ok,text) {lines.push(`${ok?"PASS":"FAIL"} ${text}`); output.textContent=lines.join("\n");}
  async function idle() {await new Promise(resolve=>setTimeout(resolve,400));}
  byId("draft").value="В магазине много списаний. Хотим их сократить.";
  byId("ask").click();
  check(byId("ask").disabled && byId("ask").textContent.includes("Подождите"),"Видимое ожидание AI и блокировка кнопки");
  await idle();
  byId("answer-q1").value="Менеджеры магазина";
  byId("generate").click(); await idle();
  check(byId("answer-q1").value==="Менеджеры магазина" && !byId("generate").disabled && byId("notice").textContent.includes("Тестовая ошибка"),"Ответы сохранены после ошибки; повтор доступен");
  failCard=false;
  byId("generate").click(); await idle();
  check(byId("stage-number").textContent==="03 / 03" && byId("stage-text").textContent.includes("Проверить"),"Этапы меняются после вопросов и AI-карточки");
  byId("field-title").value="Ручная правка сохранена";
  for(const key of ["context","need","users"]) byId(`confirm-${key}`).checked=true;
  for(const name of ["catalog","business","create"]) {doc.querySelector(`[data-view="${name}"]`).click(); await idle();}
  check(byId("field-title").value==="Ручная правка сохранена" && byId("confirm-context").checked && byId("confirm-users").checked && byId("unsaved").textContent.includes("Есть несохранённые изменения"),"Правки и подтверждения переживают три переключения ролей");
  byId("save").click();
  check(byId("publish").disabled,"Публикация заблокирована во время первого сохранения (защита от дубликата)");
  await idle();
  byId("field-title").value="Обновление той же задачи";
  byId("save").click(); await idle();
  check(requests.filter(r=>r.path==="/api/tasks"&&r.method==="POST").length===1 && requests.some(r=>r.path==="/api/tasks/91"&&r.method==="PUT") && saved.card.title==="Обновление той же задачи","Повторное сохранение: один POST, затем PUT текущего ID");
  failSave=true; byId("field-data").value="Несохранённые данные";
  byId("save").click(); await idle();
  check(byId("field-data").value==="Несохранённые данные" && !byId("save").disabled && !byId("publish").disabled,"Ошибка сохранения сохраняет правки и разблокирует действия");
  check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth,"Нет горизонтальной прокрутки редактора");
  failSave=false;
  byId("field-context").value="Изменённый подтверждённый контекст";
  byId("field-context").dispatchEvent(new win.Event("input"));
  const scoreBeforeSave=byId("score").textContent;
  const dirtyExplainsScore=byId("unsaved").textContent.includes("последней сохранённой версии");
  const confirmationRemoved=!byId("confirm-context").checked;
  byId("save").click(); await idle();
  const scoreAfterRemoval=byId("score").textContent;
  [...byId("missing").querySelectorAll("button")].find(button=>button.textContent.includes("Контекст")).click();
  check(doc.activeElement===byId("field-context"),"Подсказка рейтинга переводит к нужному полю");
  byId("confirm-context").click(); byId("save").click(); await idle();
  check(confirmationRemoved && scoreBeforeSave==="30" && dirtyExplainsScore && scoreAfterRemoval==="20" && byId("score").textContent==="30","Изменение снимает подтверждение: рейтинг 30 → 20 → 30 после повторного подтверждения");
  for(const key of ["context","need","users","data","constraints","expected_result","success_criteria","contact","interaction_format"]) {
    byId(`field-${key}`).value=`Подтверждённое значение ${key}`;
    byId(`field-${key}`).dispatchEvent(new win.Event("input"));
    if(!byId(`confirm-${key}`).checked) byId(`confirm-${key}`).click();
  }
  byId("save").click(); await idle();
  check(byId("score").textContent==="100" && byId("score-note").textContent.includes("не проверка достоверности"),"При 100/100 показано ограничение рейтинга");
  byId("field-title").value="Несохранённая правка";
  byId("field-title").dispatchEvent(new win.Event("input"));
  win.confirm=()=>false;
  byId("business-task-list").querySelector("button").click(); await idle();
  check(byId("field-title").value==="Несохранённая правка" && !byId("unsaved").hidden,"Отмена переключения сохраняет несохранённый текст");
  win.confirm=()=>true;
  byId("business-task-list").querySelector("button").click();
  check(byId("field-title").disabled && byId("new-task").disabled && byId("save").disabled,"Во время перехода к задаче редактор защищён от параллельных правок");
  await idle();
  byId("field-title").value="После продолжения";
  byId("field-title").dispatchEvent(new win.Event("input"));
  byId("save").click(); await idle();
  check(byId("task-state").textContent.includes("№91") && requests.at(-1).path==="/api/tasks/91" && requests.at(-1).method==="PUT","Продолжение восстанавливает ID и сохраняет через PUT");
  check(byId("draft").value==="" && byId("question-list").children.length===0 && byId("source").hidden && byId("editor-kind").textContent==="Сохранённый черновик","Открытие другой задачи очищает описание и вопросы, восстанавливает тип карточки");
  byId("new-task").click();
  byId("draft").value="В магазине много списаний. Хотим их сократить.";
  byId("ask").click(); await idle();
  byId("generate").click(); await idle();
  check(byId("score").textContent==="0" && byId("task-state").textContent==="Не сохранено","Новая AI-карточка сбрасывает старые рейтинг и статус");
  testRace=true;
  doc.querySelector('[data-view="business"]').click();
  await new Promise(resolve=>setTimeout(resolve,200));
  byId("business-task").value="2";
  byId("business-task").dispatchEvent(new win.Event("change"));
  await new Promise(resolve=>setTimeout(resolve,500));
  check(byId("proposal-list").textContent.includes("НОВАЯ ЗАДАЧА") && !byId("proposal-list").textContent.includes("СТАРАЯ ЗАДАЧА") && byId("proposal-list").textContent.includes("Аналитика") && byId("proposal-list").textContent.includes("FastAPI"),"Поздний ответ не смешивает отклики; навыки и технологии видны");
  doc.querySelector('[data-view="create"]').click();
  await idle();
  byId("saved-tasks").open=true;
  for (const width of [390,375]) {
    frame.style.width=width+"px";
    await idle();
    const buttons=[...byId("business-task-list").querySelectorAll("button")];
    check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth && buttons.length>0 && buttons.every(button=>button.getBoundingClientRect().right<=doc.documentElement.clientWidth),`Список сохранённых задач и кнопки не выходят за ${width} px`);
  }
  frame.style.width="100%";
  output.textContent += "\nЗавершено. Это тестовые ответы, а не реальный AI-прогон.";
})().catch(error=>{document.getElementById("results").textContent += `\nERROR ${error.message}`;});
