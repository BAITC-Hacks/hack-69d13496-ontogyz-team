"use strict";

const FIELDS = {
  title: "Название", context: "Контекст", need: "Потребность",
  users: "Пользователи", data: "Данные и материалы", constraints: "Ограничения",
  expected_result: "Ожидаемый результат", success_criteria: "Критерии успеха",
  contact: "Контакт бизнеса", interaction_format: "Формат взаимодействия"
};
const LEVELS = {draft: "Черновик", working: "Рабочая", ready: "Готовая", priority: "Приоритетная"};
const $ = id => document.getElementById(id);
const state = {questions: [], card: null, taskId: null, tasks: [], teams: []};

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function message(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
  if (text) window.scrollTo({top: 0, behavior: "smooth"});
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
    throw error;
  } finally { clearTimeout(timer); }
}
async function action(button, fn) {
  button.disabled = true;
  try { await fn(); } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
}
function view(name) {
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== name;
  for (const button of document.querySelectorAll("nav button")) button.classList.toggle("selected", button.dataset.view === name);
  message("");
  if (name === "catalog") loadTasks();
  if (name === "business") loadBusiness();
}
for (const button of document.querySelectorAll("nav button")) button.addEventListener("click", () => view(button.dataset.view));

function showScore(task) {
  $("score").textContent = task.score;
  $("score-fill").style.width = `${task.score}%`;
  $("level").textContent = `${LEVELS[task.level]} · ${task.status === "published" ? "опубликовано" : "не опубликовано"}`;
  $("task-state").textContent = task.status === "published" ? "Опубликовано" : "Не опубликовано";
  $("breakdown").replaceChildren(...Object.entries(task.score_breakdown).map(([field, points]) => el("li", `${FIELDS[field]}: ${points}`)));
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
    area.append(label, input);
    if (key !== "title") {
      const confirm = el("label", "Подтверждаю эти сведения", "check");
      const checkbox = el("input"); checkbox.type = "checkbox"; checkbox.id = `confirm-${key}`;
      confirm.prepend(checkbox); area.append(confirm);
    }
    target.append(area);
  }
  $("editor").hidden = false;
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

async function loadTasks() {
  try {
    const data = await api("/api/tasks"); state.tasks = data.tasks;
    const filter = $("topic-filter"), chosen = filter.value;
    filter.replaceChildren(new Option("Все темы", ""), ...[...new Set(data.tasks.map(task => task.topic))].map(t => new Option(t, t)));
    filter.value = chosen;
    renderTasks();
  } catch (error) { message(error.message, true); }
}
function renderTasks() {
  const topic = $("topic-filter").value, level = $("level-filter").value;
  const tasks = state.tasks.filter(task => (!topic || task.topic === topic) && (!level || task.level === level));
  const list = $("task-list"); list.replaceChildren();
  if (!tasks.length) { list.append(el("p", "Задач с такими параметрами пока нет.")); return; }
  for (const task of tasks) {
    const box = el("article", null, "task-card"), chips = el("div", null, "chips");
    chips.append(el("span", task.topic, "chip"), el("span", `${LEVELS[task.level]} · ${task.score}/100`, "chip"));
    const open = el("button", "Посмотреть и откликнуться", "secondary");
    open.addEventListener("click", () => openTask(task.id));
    box.append(chips, el("h2", task.card.title), el("p", task.card.need || task.card.context || "Описание ещё уточняется"), open);
    list.append(box);
  }
}
$("topic-filter").addEventListener("change", renderTasks);
$("level-filter").addEventListener("change", renderTasks);
$("refresh").addEventListener("click", loadTasks);

async function openTask(id) {
  try {
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
    teamSelect.required = true;
    const teams = await api("/api/teams"); state.teams = teams.teams;
    for (const team of teams.teams) teamSelect.add(new Option(team.name, team.id));
    teamLabel.append(teamSelect); form.append(teamLabel);
    const inputs = {};
    for (const [key, labelText, tag] of [["idea","Идея решения","textarea"],["plan","План","textarea"],["duration_days","Срок в днях","input"],["prototype_url","Ссылка на прототип","input"]]) {
      const label = el("label", labelText), input = el(tag); inputs[key] = input;
      if (key === "duration_days") { input.type = "number"; input.min = "1"; input.max = "365"; }
      if (key === "prototype_url") { input.type = "url"; input.placeholder = "https://example.org/prototype"; }
      input.required = true; label.append(input); form.append(label);
    }
    const submit = el("button", "Отправить предложение", "primary"); submit.type = "submit"; form.append(submit);
    form.addEventListener("submit", event => {event.preventDefault(); action(submit, async () => {
      await api(`/api/tasks/${id}/proposals`, "POST", {team_id: Number(teamSelect.value),
        idea: inputs.idea.value.trim(), plan: inputs.plan.value.trim(),
        duration_days: Number(inputs.duration_days.value), prototype_url: inputs.prototype_url.value.trim()});
      message("Предложение отправлено. Решение примет бизнес."); form.reset();
    });});
    detail.append(form); detail.hidden = false; detail.scrollIntoView({behavior: "smooth"});
  } catch (error) { message(error.message, true); }
}

async function loadBusiness() {
  try {
    const data = await api("/api/tasks"); state.tasks = data.tasks;
    const select = $("business-task"), previous = select.value;
    select.replaceChildren(...data.tasks.map(task => new Option(`${task.card.title} · ${task.score}/100`, task.id)));
    if (data.tasks.some(task => String(task.id) === previous)) select.value = previous;
    else if (state.taskId && data.tasks.some(task => task.id === state.taskId)) select.value = String(state.taskId);
    await loadProposals();
  } catch (error) { message(error.message, true); }
}
async function loadProposals() {
  const list = $("proposal-list"), taskId = $("business-task").value;
  list.replaceChildren();
  if (!taskId) { list.append(el("p", "Сначала опубликуйте задачу.")); return; }
  try {
    const [{proposals}, {teams}] = await Promise.all([api(`/api/tasks/${taskId}/proposals`), api("/api/teams")]);
    if (!proposals.length) { list.append(el("p", "Пока нет предложений.")); return; }
    for (const p of proposals) {
      const article = el("article"), team = teams.find(t => t.id === p.team_id), actions = el("div", null, "actions");
      article.append(el("h3", `${team?.name || "Команда"} · ${p.status === "selected" ? "Выбрана" : p.status === "rejected" ? "Отклонена" : "Ожидает решения"}`),
        el("p", p.idea), el("p", `План: ${p.plan}`), el("p", `Срок: ${p.duration_days} дн. · Баллы за этап: ${p.points}`, "proposal-meta"));
      const link = el("a", "Открыть прототип"); link.href = p.prototype_url; link.target = "_blank"; link.rel = "noopener noreferrer"; article.append(link);
      for (const [status, title] of [["selected","Выбрать"],["rejected","Отклонить"]]) {
        if (p.milestone_confirmed && status === "rejected") continue;
        const button = el("button", title, status === "selected" ? "primary" : "secondary");
        button.addEventListener("click", () => action(button, async () => {
          await api(`/api/proposals/${p.id}`, "PATCH", {status});
          message("Решение сохранено вручную."); await loadProposals();
        })); actions.append(button);
      }
      if (p.status === "selected") {
        const button = el("button", p.milestone_confirmed ? "Этап подтверждён" : "Подтвердить этап +10", "secondary");
        button.disabled = p.milestone_confirmed;
        button.addEventListener("click", () => action(button, async () => {
          await api(`/api/proposals/${p.id}/milestones/confirm`, "POST", {});
          message("Этап подтверждён, команда получила 10 баллов."); await loadProposals();
        })); actions.append(button);
      }
      article.append(actions); list.append(article);
    }
  } catch (error) { message(error.message, true); }
}
$("business-task").addEventListener("change", loadProposals);
