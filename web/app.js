"use strict";

const FIELDS = {
  title: "Название", context: "Контекст", need: "Потребность",
  users: "Пользователи", data: "Данные и материалы", constraints: "Ограничения",
  expected_result: "Ожидаемый результат", success_criteria: "Критерии успеха",
  contact: "Контакт бизнеса", interaction_format: "Формат взаимодействия"
};
const LEVELS = {draft: "Начальная", working: "Рабочая", ready: "Готовая", priority: "Приоритетная"};
const FIELD_GROUPS = [
  ["Суть задачи", ["title", "context", "need", "users"]],
  ["Данные и результат", ["data", "expected_result", "success_criteria"]],
  ["Условия и связь", ["constraints", "contact", "interaction_format"]]
];
const $ = id => document.getElementById(id);
const state = {questions: [], card: null, taskId: null, tasks: [], businessTasks: [], teams: [], topics: [], dirty: false, sourceDirty: false, busy: false};

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function setStage(number, text) {
  $("stage-number").textContent = number;
  $("stage-text").textContent = text;
  const current = Number.parseInt(number, 10) || 3;
  document.querySelectorAll(".step-track li").forEach((step, index) => {
    step.classList.toggle("done", index + 1 < current);
    if (index + 1 === current) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
}
function message(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
  $("notice").setAttribute("role", error ? "alert" : "status");
}
function markDirty() {
  if ($("editor").hidden) return;
  state.dirty = true;
  $("unsaved").hidden = false;
  $("unsaved").textContent = state.taskId
    ? "Есть несохранённые изменения. Рейтинг относится к последней сохранённой версии."
    : "Есть несохранённые изменения. Рейтинг появится после первого сохранения.";
}
function markSaved() {
  state.dirty = false;
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
  const editorScope = button.closest("#create");
  const scope = editorScope || button.closest("form, article") || button;
  const editing = Boolean(editorScope);
  if (editing && state.busy) return;
  if (editing) state.busy = true;
  const controls = scope === button ? [button] : [...scope.querySelectorAll("button, input, textarea, select")];
  const disabledBefore = controls.map(control => control.disabled);
  const label = button.textContent;
  controls.forEach(control => { control.disabled = true; });
  button.setAttribute("aria-busy", "true");
  button.textContent = "Подождите…";
  try { await fn(); } catch (error) { message(error.message, true); }
  finally {
    if (editing) state.busy = false;
    controls.forEach((control, index) => { control.disabled = disabledBefore[index]; });
    button.removeAttribute("aria-busy"); button.textContent = label;
  }
}
function view(name) {
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== name;
  const role = name === "about" ? null : name === "catalog" ? "team" : "business";
  for (const button of document.querySelectorAll("nav button")) {
    button.classList.toggle("selected", button.dataset.view === name);
    if (button.dataset.role) button.setAttribute("aria-pressed", String(button.dataset.role === role));
  }
  message("");
  if (name === "create") loadBusinessTasks(true);
  if (name === "catalog") loadTasks(true);
  if (name === "business") loadBusiness();
}
for (const button of document.querySelectorAll("nav button")) button.addEventListener("click", () => view(button.dataset.view));
$("about-link").addEventListener("click", event => {
  event.preventDefault(); view("about"); reveal($("about").querySelector("h1"));
});
function reveal(node) {
  node.setAttribute("tabindex", "-1");
  node.focus({preventScroll:true});
  node.scrollIntoView({block:"start", behavior:"auto"});
}
function canReplaceWork() {
  return !(state.dirty || state.sourceDirty) || window.confirm("Есть несохранённые изменения. Продолжить и отбросить их?");
}
function clearSource() {
  state.questions = []; state.sourceDirty = false;
  $("draft").value = "";
  $("question-list").replaceChildren();
  $("questions").hidden = true;
}
$("new-task").addEventListener("click", () => {
  if (state.busy || !canReplaceWork()) return;
  clearSource(); state.taskId = null; state.card = null;
  $("topic-home").append($("topic-control")); $("topic").value = "Ритейл";
  $("editor").hidden = true; $("card-fields").replaceChildren();
  $("source").hidden = false; $("source").open = true;
  $("saved-tasks").open = false;
  resetScore(); markSaved(); setStage("01 / 03", "Описать задачу");
  message(""); $("draft").focus();
});

function showScore(task) {
  $("editor-kind").textContent = task.id
    ? (task.status === "published" ? "Опубликованная задача" : "Сохранённый черновик")
    : "Новая карточка от AI";
  $("editor-title").textContent = task.id ? "Редактирование задачи" : "Проверьте карточку";
  $("publish").hidden = task.status === "published";
  $("publication-hint").textContent = task.status === "published"
    ? "Сохранённые изменения появятся в опубликованной задаче."
    : "Публикация доступна при любом рейтинге.";
  $("score").textContent = task.score;
  $("score-fill").style.width = `${task.score}%`;
  $("score-fill").parentElement.setAttribute("aria-valuenow", String(task.score));
  $("level").textContent = `Уровень готовности: ${LEVELS[task.level].toLowerCase()}`;
  $("score-note").hidden = task.score !== 100;
  $("score-note").textContent = task.score === 100
    ? "Заполнены и подтверждены все поля. 100/100 — это оценка заполненности, а не проверка достоверности сведений."
    : "";
  $("task-state").textContent = `Статус: ${task.status === "published" ? "опубликовано" : "черновик"} · задача №${task.id}`;
  const nextField = task.missing_fields[0];
  $("next-edit").hidden = !nextField;
  $("next-edit").textContent = nextField ? `Уточнить: ${FIELDS[nextField]}` : "";
  $("next-edit").onclick = () => focusField(nextField);
  $("breakdown").replaceChildren(...Object.entries(task.score_breakdown).map(([field, points]) => {
    const item = el("li", `${FIELDS[field]}: ${points}`);
    if (points > 0) item.classList.add("earned");
    return item;
  }));
  $("missing").replaceChildren(...task.missing_fields.map(field => {
    const item = el("li"), button = el("button", `${FIELDS[field]} (+${({context:10,need:10,data:20,expected_result:15,success_criteria:15,constraints:10,users:10,contact:5,interaction_format:5})[field]})`, "missing-link");
    button.type = "button";
    button.addEventListener("click", () => {
      focusField(field);
    });
    item.append(button); return item;
  }));
  if (!task.missing_fields.length) $("missing").append(el("li", "Все поля рейтинга заполнены и подтверждены.", "hint"));
}
function focusField(field) {
  const input = $(`field-${field}`);
  if (input) { input.focus({preventScroll:true}); input.scrollIntoView({behavior:"auto", block:"center"}); }
}
function resetScore() {
  $("score").textContent = "—";
  $("score-fill").style.width = "0%";
  $("score-fill").parentElement.removeAttribute("aria-valuenow");
  $("level").textContent = "Готовность появится после сохранения";
  $("task-state").textContent = "Статус: не сохранено";
  $("editor-kind").textContent = "Новая карточка от AI";
  $("editor-title").textContent = "Проверьте карточку";
  $("score-note").hidden = true; $("score-note").textContent = "";
  $("breakdown").replaceChildren(); $("missing").replaceChildren();
  $("next-edit").hidden = true; $("publish").hidden = false;
  $("publication-hint").textContent = "Публикация доступна при любом рейтинге.";
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
  setStage("02 / 03", "Ответить на вопросы");
  message("Вопросы готовы. Ответьте на известные вам факты.");
  reveal($("questions").querySelector("h2"));
}));

function renderEditor(card, confirmedFields = [], dirty = true) {
  const target = $("card-fields"); target.replaceChildren();
  const groupTargets = {};
  for (const [title, keys] of FIELD_GROUPS) {
    const group = el("fieldset", null, "field-group"), grid = el("div", null, "field-grid");
    group.append(el("legend", title), grid); target.append(group);
    for (const key of keys) groupTargets[key] = grid;
  }
  for (const [key, title] of Object.entries(FIELDS)) {
    const area = el("div", null, key === "title" ? "title-field" : "");
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
      checkbox.checked = confirmedFields.includes(key);
      checkbox.addEventListener("change", markDirty);
      confirm.prepend(checkbox); area.append(confirm);
    }
    groupTargets[key].append(area);
  }
  $("editor").hidden = false;
  $("editor-topic").append($("topic-control"));
  if (window.matchMedia("(max-width: 680px)").matches) {
    for (const details of document.querySelectorAll(".score-details")) details.open = false;
  }
  $("source").open = false;
  $("saved-tasks").open = false;
  if (dirty) markDirty(); else markSaved();
  reveal($("editor-title"));
}
$("generate").addEventListener("click", event => action(event.currentTarget, async () => {
  if (state.dirty && !window.confirm("Есть несохранённые изменения. Создать новую карточку и отбросить их?")) return;
  const answers = state.questions.map(q => ({question_id: q.id, answer: $(`answer-${q.id}`).value.trim()}));
  message("AI готовит редактируемый черновик...");
  const data = await api("/api/ai/card", "POST", {draft: $("draft").value.trim(), topic: $("topic").value.trim(), answers}, 50000);
  state.card = data.card; state.taskId = null;
  state.sourceDirty = false;
  resetScore();
  renderEditor(data.card);
  setStage("03 / 03", "Проверить и сохранить");
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
  state.taskId = task.id; state.card = task.card; showScore(task); upsertBusinessTask(task);
  markSaved();
  setStage("03 / 03", task.status === "published" ? "Дополнить публикацию" : "Сохранено — можно публиковать");
  message(`Карточка сохранена. Рейтинг ${task.score}/100 (${LEVELS[task.level].toLowerCase()}).`);
  return task;
}
$("save").addEventListener("click", event => action(event.currentTarget, saveCard));
$("publish").addEventListener("click", event => action(event.currentTarget, async () => {
  await saveCard();
  const task = await api(`/api/tasks/${state.taskId}/publish`, "POST", {});
  showScore(task); upsertBusinessTask(task);
  setStage("Готово", "Опубликовано — можно дополнить");
  message(`Задача «${task.card.title}» опубликована. Она доступна всем командам, рейтинг ${task.score}/100.`);
}));

function renderBusinessTasks() {
  const list = $("business-task-list"); list.replaceChildren();
  $("saved-count").textContent = state.businessTasks.length ? String(state.businessTasks.length) : "";
  if (!state.businessTasks.length) { list.append(el("p", "Сохранённых задач пока нет.")); return; }
  for (const task of state.businessTasks) {
    const item = el("article", null, "saved-task"), text = el("div"), button = el("button", "Продолжить редактирование", "secondary");
    text.append(el("strong", task.card.title || "Без названия"), el("span", `${task.topic} · Готовность: ${task.score}/100`), el("span", `Статус: ${task.status === "published" ? "опубликовано" : "черновик"}`));
    button.type = "button";
    button.addEventListener("click", () => action(button, () => openSavedTask(task.id)));
    item.append(text, button); list.append(item);
  }
}
function upsertBusinessTask(task) {
  state.businessTasks = [task, ...state.businessTasks.filter(saved => saved.id !== task.id)].sort((a, b) => b.id - a.id);
  renderBusinessTasks();
}
async function loadBusinessTasks(quiet = false) {
  try {
    if (!quiet) message("Загружаем сохранённые задачи...");
    const data = await api("/api/business/tasks"); state.businessTasks = data.tasks;
    renderBusinessTasks();
    if (!quiet) message(`Сохранённые задачи загружены: ${data.tasks.length}.`);
  } catch (error) { message(error.message, true); }
}
async function openSavedTask(id) {
  if (!canReplaceWork()) return;
  message("Открываем сохранённую задачу...");
  const task = await api(`/api/tasks/${id}`);
  clearSource(); $("source").hidden = true;
  state.taskId = task.id; state.card = task.card;
  $("topic").value = task.topic;
  renderEditor(task.card, task.confirmed_fields, false);
  showScore(task);
  setStage("03 / 03", task.status === "published" ? "Продолжить публикацию" : "Продолжить черновик");
  message(`Задача №${task.id} открыта.`);
  reveal($("editor-title"));
}
$("refresh-business-tasks").addEventListener("click", event => action(event.currentTarget, () => loadBusinessTasks()));

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
    message(`Найдено задач: ${data.tasks.length}. Сортировка — по рейтингу.`);
  } catch (error) { message(error.message, true); }
}
function renderTasks() {
  const list = $("task-list"); list.replaceChildren();
  $("catalog-count").textContent = String(state.tasks.length);
  if (!state.tasks.length) { list.append(el("p", "Задач с такими параметрами пока нет. Попробуйте другую тему или готовность.", "empty-state")); return; }
  for (const task of state.tasks) {
    const box = el("article", null, "task-card"), top = el("div", null, "task-card-top");
    box.classList.add(`level-${task.level}`);
    const rating = el("div", null, "task-rating");
    rating.setAttribute("aria-label", `Готовность: ${task.score} из 100`);
    rating.append(el("strong", task.score), el("span", "/ 100"));
    top.append(el("span", task.topic, "chip"), rating);
    const open = el("button", "Посмотреть и откликнуться", "secondary");
    open.addEventListener("click", () => openTask(task.id));
    const footer = el("div", null, "task-card-footer");
    footer.append(el("span", `Готовность: ${LEVELS[task.level].toLowerCase()}`, `level-label level-${task.level}`), open);
    box.append(top, el("h2", task.card.title), el("p", task.card.need || task.card.context || "Описание ещё уточняется"), footer);
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
    detail.append(form); detail.hidden = false; reveal(detail);
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
      article.classList.toggle("selected", p.status === "selected");
      const profile = el("div", null, "team-profile");
      profile.append(el("span", `Навыки: ${team?.skills?.join(", ") || "не указаны"}`), el("span", `Технологии: ${team?.technologies?.join(", ") || "не указаны"}`));
      article.append(el("h3", team?.name || "Команда"), el("p", `${p.status === "selected" ? "Выбрана" : p.status === "rejected" ? "Отклонена" : "Ожидает решения"}${p.milestone_confirmed ? " · Этап подтверждён · +10 однократно" : ""}`, "proposal-status"), profile,
        el("p", p.idea), el("p", `План: ${p.plan}`), el("p", `Срок: ${p.duration_days} дн. · Баллы команды: ${team?.points ?? 0} · За этот этап: ${p.points}`, "proposal-meta"));
      const link = el("a", "Открыть прототип"); link.href = p.prototype_url; link.target = "_blank"; link.rel = "noopener noreferrer"; article.append(link);
      for (const [status, title] of [["selected","Выбрать"],["rejected","Отклонить"]]) {
        if (p.milestone_confirmed && status === "rejected") continue;
        const button = el("button", title, status === "selected" ? "primary" : "secondary");
        button.disabled = p.status === status;
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
$("source").addEventListener("input", () => { state.sourceDirty = true; });
$("topic").addEventListener("input", () => { if (!state.card) state.sourceDirty = true; });
view("create");
