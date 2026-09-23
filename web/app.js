"use strict";

const FIELDS = {
  title: "Название", context: "Контекст", need: "Потребность",
  users: "Пользователи", data: "Данные и материалы", constraints: "Ограничения",
  expected_result: "Ожидаемый результат", success_criteria: "Критерии успеха",
  contact: "Контакт бизнеса", interaction_format: "Формат взаимодействия"
};
const LEVELS = {draft: "Черновик", working: "Рабочая", ready: "Готовая", priority: "Приоритетная"};
const $ = id => document.getElementById(id);
const state = {questions: [], card: null, taskId: null, tasks: [], teams: [], topics: []};

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function message(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
  $("notice").setAttribute("role", error ? "alert" : "status");
  if (text) window.scrollTo({top: 0, behavior: "smooth"});
}
function markDirty() {
  if ($("editor").hidden) return;
  $("unsaved").hidden = false;
  $("unsaved").textContent = state.taskId
    ? "Есть несохранённые изменения. Рейтинг относится к последней сохранённой версии."
    : "Есть несохранённые изменения. Рейтинг появится после первого сохранения.";
}
function markSaved() {
  $("unsaved").hidden = true;
  $("unsaved").textContent = "";
}
async function api(path, method = "GET", body = null, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {method, headers: body ? {"Content-Type": "application/json"} : {},
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Ошибка ${response.status}`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Время ожидания истекло. Попробуйте ещё раз.");
    if (error instanceof TypeError) throw new Error("Сервер недоступен. Проверьте запуск приложения и попробуйте ещё раз.");
    throw error;
  } finally { clearTimeout(timer); }
}
async function action(button, fn) {
  if (button.disabled) return;
  const scope = button.closest("#create, form, article") || button;
  const controls = scope === button ? [button] : [...scope.querySelectorAll("button")];
  const disabledBefore = controls.map(control => control.disabled);
  const label = button.textContent;
  controls.forEach(control => { control.disabled = true; });
  button.setAttribute("aria-busy", "true");
  button.textContent = "Подождите…";
  try { await fn(); } catch (error) { message(error.message, true); }
  finally {
    controls.forEach((control, index) => { control.disabled = disabledBefore[index]; });
    button.removeAttribute("aria-busy"); button.textContent = label;
  }
}
function view(name) {
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== name;
  const role = name === "catalog" ? "team" : "business";
  for (const button of document.querySelectorAll("nav button")) {
    button.classList.toggle("selected", button.dataset.view === name || (name === "business" && button.dataset.view === "create"));
    if (button.dataset.role) button.setAttribute("aria-pressed", String(button.dataset.role === role));
  }
  message("");
  if (name === "catalog") loadTasks(true);
  if (name === "business") loadBusiness();
}
for (const button of document.querySelectorAll("nav button")) button.addEventListener("click", () => view(button.dataset.view));

function showScore(task) {
  $("score").textContent = task.score;
  $("score-fill").style.width = `${task.score}%`;
  $("score-fill").parentElement.setAttribute("aria-valuenow", String(task.score));
  $("level").textContent = `${LEVELS[task.level]} · ${task.status === "published" ? "опубликовано" : "не опубликовано"}`;
  $("score-note").hidden = task.score !== 100;
  $("score-note").textContent = task.score === 100
    ? "Заполнены и подтверждены все поля. 100/100 — это оценка заполненности, а не проверка достоверности сведений."
    : "";
  $("task-state").textContent = task.status === "published" ? "Опубликовано" : "Не опубликовано";
  $("breakdown").replaceChildren(...Object.entries(task.score_breakdown).map(([field, points]) => {
    const item = el("li", `${FIELDS[field]}: ${points}`);
    if (points > 0) item.classList.add("earned");
    return item;
  }));
  $("missing").replaceChildren(...task.missing_fields.map(field => el("li", `${FIELDS[field]} (+${({context:10,need:10,data:20,expected_result:15,success_criteria:15,constraints:10,users:10,contact:5,interaction_format:5})[field]})`)));
}
$("ask").addEventListener("click", event => action(event.currentTarget, async () => {
  const draft = $("draft").value.trim(), topic = $("topic").value.trim();
  if (draft.length < 10 || !topic) throw new Error("Добавьте тему и описание не короче 10 символов");
  message("AI изучает описание и составляет вопросы...");
  const data = await api("/api/ai/questions", "POST", {draft, topic}, 50000);
  state.questions = data.questions;
  const list = $("question-list"); list.replaceChildren();
  for (const q of state.questions) {
    const label = el("label", q.text); label.htmlFor = `answer-${q.id}`;
    const input = el("textarea"); input.id = `answer-${q.id}`; input.maxLength = 2000; input.rows = 2;
    input.placeholder = "Если сведений нет, оставьте поле пустым";
    list.append(label, input);
  }
  $("questions").hidden = false;
  message("Ответьте на вопросы и проверьте карточку перед публикацией.");
}));

function renderEditor(card) {
  const target = $("card-fields"); target.replaceChildren();
  for (const [key, title] of Object.entries(FIELDS)) {
    const area = el("div");
    const label = el("label", title); label.htmlFor = `field-${key}`;
    const input = key === "title" ? el("input") : el("textarea");
    input.id = `field-${key}`; input.value = card[key] || "";
    input.maxLength = key === "title" ? 160 : 2000;
    if (key !== "title") input.rows = 3;
    input.addEventListener("input", () => {
      if (key !== "title") {
        const checkbox = $(`confirm-${key}`);
        if (checkbox?.checked) checkbox.checked = false;
      }
      markDirty();
    });
    area.append(label, input);
    if (key !== "title") {
      const confirm = el("label", "Подтверждаю эти сведения", "check");
      const checkbox = el("input"); checkbox.type = "checkbox"; checkbox.id = `confirm-${key}`;
      checkbox.addEventListener("change", markDirty);
      confirm.prepend(checkbox); area.append(confirm);
    }
    target.append(area);
  }
  $("editor").hidden = false;
  markDirty();
  $("editor").scrollIntoView({behavior: "smooth"});
}
$("generate").addEventListener("click", event => action(event.currentTarget, async () => {
  const answers = state.questions.map(q => ({question_id: q.id, answer: $(`answer-${q.id}`).value.trim()}));
  message("AI готовит редактируемый черновик...");
  const data = await api("/api/ai/card", "POST", {draft: $("draft").value.trim(), topic: $("topic").value.trim(), answers}, 50000);
  state.card = data.card; state.taskId = null;
  renderEditor(data.card);
  message("Проверьте карточку: AI может ошибаться. Подтвердите только известные вам сведения.");
}));

function readEditor() {
  const card = {}, confirmed_fields = [];
  for (const key of Object.keys(FIELDS)) {
    card[key] = $(`field-${key}`).value.trim();
    if (key !== "title" && $(`confirm-${key}`).checked) confirmed_fields.push(key);
  }
  return {topic: $("topic").value.trim(), card, confirmed_fields};
}
async function saveCard() {
  const payload = readEditor();
  if (!payload.topic) throw new Error("Укажите тему задачи");
  const task = state.taskId
    ? await api(`/api/tasks/${state.taskId}`, "PUT", payload)
    : await api("/api/tasks", "POST", payload);
  state.taskId = task.id; state.card = task.card; showScore(task);
  markSaved();
  message(`Карточка сохранена. Рейтинг ${task.score}/100 (${LEVELS[task.level].toLowerCase()}).`);
  return task;
}
$("save").addEventListener("click", event => action(event.currentTarget, saveCard));
$("publish").addEventListener("click", event => action(event.currentTarget, async () => {
  await saveCard();
  const task = await api(`/api/tasks/${state.taskId}/publish`, "POST", {});
  showScore(task);
  message(`Задача «${task.card.title}» опубликована. Она доступна всем командам, рейтинг ${task.score}/100.`);
}));

async function loadTasks(refreshTopics = false) {
  try {
    message("Загружаем каталог...");
    $("task-detail").hidden = true;
    $("task-detail").replaceChildren();
    const topic = $("topic-filter").value, level = $("level-filter").value;
    const params = new URLSearchParams();
    if (topic) params.set("topic", topic);
    if (level) params.set("level", level);
    const suffix = params.toString() ? `?${params}` : "";
    const data = await api(`/api/tasks${suffix}`); state.tasks = data.tasks;
    if (refreshTopics || !state.topics.length) {
      const allTasks = suffix ? (await api("/api/tasks")).tasks : data.tasks;
      state.topics = [...new Set(allTasks.map(task => task.topic))];
      const filter = $("topic-filter"), chosen = filter.value;
      filter.replaceChildren(new Option("Все темы", ""), ...state.topics.map(t => new Option(t, t)));
      filter.value = state.topics.includes(chosen) ? chosen : "";
    }
    renderTasks();
    message(`Каталог загружен: ${data.tasks.length} задач. Сортировка — по рейтингу.`);
  } catch (error) { message(error.message, true); }
}
function renderTasks() {
  const list = $("task-list"); list.replaceChildren();
  if (!state.tasks.length) { list.append(el("p", "Задач с такими параметрами пока нет.")); return; }
  for (const task of state.tasks) {
    const box = el("article", null, "task-card"), chips = el("div", null, "chips");
    chips.append(el("span", task.topic, "chip"), el("span", `${LEVELS[task.level]} · ${task.score}/100`, "chip"));
    const open = el("button", "Посмотреть и откликнуться", "secondary");
    open.addEventListener("click", () => openTask(task.id));
    box.append(chips, el("h2", task.card.title), el("p", task.card.need || task.card.context || "Описание ещё уточняется"), open);
    list.append(box);
  }
}
$("topic-filter").addEventListener("change", () => loadTasks());
$("level-filter").addEventListener("change", () => loadTasks());
$("refresh").addEventListener("click", () => loadTasks(true));

async function openTask(id) {
  try {
    message("Загружаем задачу и список команд...");
    const task = await api(`/api/tasks/${id}`);
    const detail = $("task-detail"); detail.replaceChildren();
    detail.append(el("span", `${task.topic} · ${LEVELS[task.level]} · ${task.score}/100`, "eyebrow"), el("h2", task.card.title));
    const fields = el("div", null, "detail-grid");
    for (const [key, title] of Object.entries(FIELDS)) {
      if (key === "title") continue;
      const cell = el("div"); cell.append(el("b", title), el("span", task.card[key] || "Не указано")); fields.append(cell);
    }
    detail.append(fields, el("h2", "Предложить решение"));
    const form = el("form"), teamLabel = el("label", "Команда"), teamSelect = el("select");
    form.noValidate = true;
    teamSelect.required = true;
    const teams = await api("/api/teams"); state.teams = teams.teams;
    for (const team of teams.teams) teamSelect.add(new Option(`${team.name} · ${team.points} баллов`, team.id));
    teamLabel.append(teamSelect); form.append(teamLabel);
    const inputs = {};
    for (const [key, labelText, tag] of [["idea","Идея решения","textarea"],["plan","План","textarea"],["duration_days","Срок в днях","input"],["prototype_url","Ссылка на прототип","input"]]) {
      const label = el("label", labelText), input = el(tag); inputs[key] = input;
      if (key === "duration_days") { input.type = "number"; input.min = "1"; input.max = "365"; }
      if (key === "prototype_url") { input.type = "url"; input.placeholder = "https://example.org/prototype"; }
      if (key === "idea" || key === "plan") { input.minLength = 10; input.maxLength = 2000; }
      input.required = true; label.append(input); form.append(label);
    }
    const submit = el("button", "Отправить предложение", "primary"); submit.type = "submit"; form.append(submit);
    form.addEventListener("submit", event => {event.preventDefault(); action(submit, async () => {
      if (inputs.idea.value.trim().length < 10 || inputs.plan.value.trim().length < 10) throw new Error("Идея и план должны содержать не менее 10 символов");
      const duration = Number(inputs.duration_days.value);
      if (!Number.isInteger(duration) || duration < 1 || duration > 365) throw new Error("Укажите срок от 1 до 365 дней");
      let prototypeUrl;
      try { prototypeUrl = new URL(inputs.prototype_url.value.trim()); } catch { throw new Error("Укажите полный URL прототипа, например https://example.org/demo"); }
      if (!["http:", "https:"].includes(prototypeUrl.protocol)) throw new Error("URL прототипа должен начинаться с http:// или https://");
      await api(`/api/tasks/${id}/proposals`, "POST", {team_id: Number(teamSelect.value),
        idea: inputs.idea.value.trim(), plan: inputs.plan.value.trim(),
        duration_days: duration, prototype_url: inputs.prototype_url.value.trim()});
      message("Предложение отправлено. Решение примет бизнес."); form.reset();
    });});
    detail.append(form); detail.hidden = false; detail.scrollIntoView({behavior: "smooth"});
    message("Задача загружена. Заполните все поля отклика.");
  } catch (error) { message(error.message, true); }
}

async function loadBusiness() {
  try {
    message("Загружаем задачи бизнеса и отклики...");
    const data = await api("/api/tasks"); state.tasks = data.tasks;
    const select = $("business-task"), previous = select.value;
    select.replaceChildren(...data.tasks.map(task => new Option(`${task.card.title} · ${task.score}/100`, task.id)));
    if (data.tasks.some(task => String(task.id) === previous)) select.value = previous;
    else if (state.taskId && data.tasks.some(task => task.id === state.taskId)) select.value = String(state.taskId);
    await loadProposals();
  } catch (error) { message(error.message, true); }
}
let proposalRequest = 0;
async function loadProposals(successMessage = "") {
  const request = ++proposalRequest;
  const list = $("proposal-list"), taskId = $("business-task").value;
  list.replaceChildren();
  if (!taskId) { list.append(el("p", "Сначала опубликуйте задачу.")); message("Опубликованных задач пока нет."); return; }
  try {
    const [{proposals}, {teams}] = await Promise.all([api(`/api/tasks/${taskId}/proposals`), api("/api/teams")]);
    if (request !== proposalRequest || $("business-task").value !== taskId) return;
    list.replaceChildren();
    if (!proposals.length) { list.append(el("p", "Пока нет предложений.")); message("Отклики загружены: пока ни одного."); return; }
    for (const p of proposals) {
      const article = el("article"), team = teams.find(t => t.id === p.team_id), actions = el("div", null, "actions");
      article.append(el("h3", `${team?.name || "Команда"} · ${p.status === "selected" ? "Выбрана" : p.status === "rejected" ? "Отклонена" : "Ожидает решения"}`),
        el("p", p.idea), el("p", `План: ${p.plan}`), el("p", `Срок: ${p.duration_days} дн. · Баллы команды: ${team?.points ?? 0} · За этот этап: ${p.points}`, "proposal-meta"));
      const link = el("a", "Открыть прототип"); link.href = p.prototype_url; link.target = "_blank"; link.rel = "noopener noreferrer"; article.append(link);
      for (const [status, title] of [["selected","Выбрать"],["rejected","Отклонить"]]) {
        if (p.milestone_confirmed && status === "rejected") continue;
        const button = el("button", title, status === "selected" ? "primary" : "secondary");
        button.addEventListener("click", () => action(button, async () => {
          await api(`/api/proposals/${p.id}`, "PATCH", {status});
          await loadProposals("Решение сохранено вручную. Остальные отклики не изменены.");
        })); actions.append(button);
      }
      if (p.status === "selected") {
        const button = el("button", p.milestone_confirmed ? "Этап подтверждён" : "Подтвердить этап +10", "secondary");
        button.disabled = p.milestone_confirmed;
        button.addEventListener("click", () => action(button, async () => {
          await api(`/api/proposals/${p.id}/milestones/confirm`, "POST", {});
          await loadProposals("Этап подтверждён: за этот этап начислено 10 баллов однократно.");
        })); actions.append(button);
      }
      article.append(actions); list.append(article);
    }
    message(successMessage || `Отклики загружены: ${proposals.length}. Каждое решение принимается независимо.`);
  } catch (error) { if (request === proposalRequest) message(error.message, true); }
}
$("business-task").addEventListener("change", () => loadProposals());
$("topic").addEventListener("input", markDirty);
view("create");
