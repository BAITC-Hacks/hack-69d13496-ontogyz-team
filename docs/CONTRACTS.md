# Контракты AI Sana Challenge Hub

Версия 1. Владелец — Али. Базовый адрес `http://127.0.0.1:8000`, фронтенд работает на том же адресе. UTF-8 JSON, заголовок `Content-Type: application/json`; путь `/static/*` для ресурсов. Все бизнес-поля в `card` — строки. Поля отсутствующих сведений — пустая строка, AI ничего не додумывает.

## Карточка и рейтинг

Поля `card`: `title` (название, до 160), `context`, `need`, `users`, `data`, `constraints`, `expected_result`, `success_criteria`, `contact`, `interaction_format` (каждое до 2000 символов). `topic` — строка до 80 символов, например «Образование». `confirmed_fields` — массив уникальных ключей рейтинга: `context`, `need`, `data`, `expected_result`, `success_criteria`, `constraints`, `users`, `contact`, `interaction_format`. Подтвердить можно только непустое содержательное значение поля. Остальные поля можно оставить пустыми. `title` нужен для публикации, низкий `score` её не блокирует.

Серверная формула: `context` 10, `need` 10, `data` 20, `expected_result` 15, `success_criteria` 15, `constraints` 10, `users` 10, `contact` 5, `interaction_format` 5. Всего 100. Для каждого поля начисляется полный вес, только если оно непустое, не равно «не знаю»/«нет данных» после нормализации и входит в `confirmed_fields`. Иначе ноль. `score_breakdown` показывает числа по всем 9 ключам; `missing_fields` — ключи с нулём. `score` пересчитывается сервером после подтверждённого обновления; перед клиентом не доверять готовому баллу. Уровень `draft` 0–39, `working` 40–69, `ready` 70–89, `priority` 90–100. Это оценка заполненности, не проверка правдивости данных.

## Интерфейс ↔ сервер

Текстовые входы очищаются от внешних пробелов до проверки минимальной длины. `team_id` и `duration_days` — целые JSON-числа; boolean и числовые строки не принимаются. В рейтинге целиком пустые формулировки («не знаю», «нет данных», «неизвестно» и другие перечисленные в `app/scoring.py`) не учитываются независимо от регистра, лишних пробелов и внешней пунктуации. Содержательные отрицательные ограничения сохраняют вес.

Все ошибки: HTTP код + `{ "error": { "code": "VALIDATION_ERROR", "message": "Читаемое объяснение" } }`. Коды: `VALIDATION_ERROR` 422, `NOT_FOUND` 404, `AI_NOT_CONFIGURED` 503, `AI_UNAVAILABLE` 503, `AI_TIMEOUT` 504, `AI_INVALID_OUTPUT` 502, `CONFLICT` 409. JSON-ответы всегда ограничены сервером. Текст черновика 10–6000 символов; HTTP body до 32 KiB. UI показывает загрузку, отключает кнопку на время ожидания, умеет отменить ожидание после 50 секунд, отображает `error.message` и позволяет повторить вручную. Сервер AI ждёт не более 20 секунд на попытку, допускает один повтор только при временной ошибке, суммарно не более 45 секунд. Сервер и фронтенд не записывают секреты.

| Метод и путь | Вход | Успешный ответ |
| --- | --- | --- |
| `GET /api/health` | — | `{ "status": "ok" }` |
| `POST /api/ai/questions` | `{ "draft": "...", "topic": "Ритейл" }` | `{ "questions": [{"id":"q1","field":"data","text":"Какие данные о списаниях доступны?"}, ...] }` (3–5) |
| `POST /api/ai/card` | `{ "draft":"...", "topic":"Ритейл", "answers":[{"question_id":"q1","answer":"..."}] }` | `{ "card": {...все 10 полей...}, "topic":"Ритейл" }` — только черновик без подтверждения |
| `POST /api/tasks` | `{ "topic":"Ритейл", "card":{...}, "confirmed_fields":[] }` | HTTP 201, `Task` |
| `PUT /api/tasks/{id}` | Полная `{ "topic", "card", "confirmed_fields" }` | `Task` с пересчитанным баллом |
| `POST /api/tasks/{id}/publish` | `{}` | `Task` со `status:"published"`; требуется лишь `title` |
| `GET /api/tasks?topic=Ритейл&level=working` | Необязательные фильтры | `{ "tasks": [Task, ...] }`, только опубликованные, `score` по убыванию, затем `id` по возрастанию |
| `GET /api/tasks/{id}` | — | `Task`, если опубликована или открыта бизнесом в демо-режиме |
| `GET /api/teams` | — | `{ "teams": [Team, ...] }` |
| `GET /api/tasks/{id}/proposals` | — | `{ "proposals": [Proposal, ...] }` |
| `POST /api/tasks/{id}/proposals` | `{ "team_id":1, "idea":"...", "plan":"...", "duration_days":14, "prototype_url":"https://example.org/demo" }` | HTTP 201, `Proposal`; отклики не ограничены количеством, ссылка должна быть URL |
| `PATCH /api/proposals/{id}` | `{ "status":"selected" }` либо `{ "status":"rejected" }` | `Proposal`; решения независимы: можно выбрать несколько, ничего не выбирать |
| `POST /api/proposals/{id}/milestones/confirm` | `{}` | `Proposal` с `milestone_confirmed:true`, `points:10`; повторное подтверждение не увеличивает баллы |

`Task`: `id` integer, `topic` string, `card` object, `confirmed_fields` string[], `status` `draft|published`, `score` integer, `level` enum, `score_breakdown` object, `missing_fields` string[], `proposals_count` integer, `created_at` ISO 8601 string. Пример: `{ "id":1, "topic":"Ритейл", "card":{"title":"Сократить списания", "context":"В магазине остаются продукты", "need":"Снизить списания", "users":"Менеджеры", "data":"", "constraints":"", "expected_result":"", "success_criteria":"", "contact":"", "interaction_format":""}, "confirmed_fields":["context","need","users"], "status":"published", "score":30, "level":"draft", "score_breakdown":{"context":10,"need":10,"data":0,"expected_result":0,"success_criteria":0,"constraints":0,"users":10,"contact":0,"interaction_format":0}, "missing_fields":["data","expected_result","success_criteria","constraints","contact","interaction_format"], "proposals_count":0, "created_at":"2026-09-23T13:00:00Z" }`.

`Team`: `id` integer, `name` string, `interests` string[], `skills` string[], `technologies` string[], `points` integer. `Proposal`: `id`, `task_id`, `team_id`, `idea`, `plan`, `duration_days`, `prototype_url`, `status` (`pending|selected|rejected`), `milestone_confirmed` boolean, `points` integer, `created_at` ISO string. `idea` и `plan` — 10–2000 символов; `duration_days` — 1–365. Без регистрации открытый демо-режим явно описывается в README. Отображать пользовательский текст безопасно через `textContent`, не HTML-разметку.

## Сервер ↔ AI

Модуль Тимура: `app/ai/service.py`. Обязательные асинхронные функции: `async generate_questions(draft: str, topic: str) -> list[dict[str,str]]` и `async build_card(draft: str, topic: str, answers: list[dict[str,str]]) -> dict[str,str]`. Первая возвращает 3–5 объектов строго с ключами `id`, `field`, `text`; `field` — один из 9 ключей рейтинга. Вторая возвращает все 10 ключей `card`, без `score`, `confirmed_fields`, `status` и `id`. `topic` формируется сервером из запроса; AI не меняет его самовольно. Али валидирует длину запроса до вызова и результат после, Тимур валидирует ответ модели и обрабатывает отказ. Любые факты вне черновика/ответов должны отсутствовать; неизвестное — `""`. Текст пользователя — данные, не инструкции для модели.

AI код читает `OPENAI_API_KEY`, `OPENAI_MODEL` только на сервере. Плановый `OPENAI_MODEL=gpt-4.1-mini-2025-04-14`, реальную доступность подтверждает Тимур. OpenAI SDK использует структурированный JSON по схеме, без лишних ключей. Срок 20 секунд на попытку, не более одного повтора временных сбоев; суммарно до 45 секунд. Содержательные ошибки: `AI_NOT_CONFIGURED`, `AI_UNAVAILABLE`, `AI_TIMEOUT`, `AI_INVALID_OUTPUT` (исключения модуля с `code` и безопасным сообщением; конкретное имя класса согласовать с Али до правок маршрута). При отсутствии ключа HTTP 503, заглушка запрещена без явного режима и метки демо. После смены модели формат функции и HTTP остаётся прежним.

Пример: черновик «В магазине много списаний. Хотим их сократить.» → вопросы о доступных данных, пользователях и признаке успеха. Нельзя объявлять конкретный срок, цифру сокращения или источник данных без ответа бизнеса. Затем бизнес видит черновик карточки, редактирует и подтверждает его. Оценка и публикация — исключительно серверные действия.
