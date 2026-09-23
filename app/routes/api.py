import json
from sqlite3 import IntegrityError

from fastapi import APIRouter, HTTPException

from app.db import connection, now, proposal_from_row, task_from_row
from app.schemas import CardGenerationInput, DecisionInput, DraftInput, ProposalInput, TaskInput
from app.ai.service import AIServiceError, build_card, generate_questions

router = APIRouter(prefix="/api")


def fail(status: int, code: str, message: str):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def task_row(db, task_id):
    row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        fail(404, "NOT_FOUND", "Задача не найдена")
    return row


@router.post("/ai/questions")
async def questions(payload: DraftInput):
    try:
        return {"questions": await generate_questions(payload.draft, payload.topic)}
    except AIServiceError as exc:
        raise HTTPException(504 if exc.code == "AI_TIMEOUT" else 502 if exc.code == "AI_INVALID_OUTPUT" else 503,
                            {"code": exc.code, "message": exc.message}) from exc


@router.post("/ai/card")
async def card(payload: CardGenerationInput):
    try:
        return {"card": await build_card(payload.draft, payload.topic, [a.model_dump() for a in payload.answers]), "topic": payload.topic}
    except AIServiceError as exc:
        raise HTTPException(504 if exc.code == "AI_TIMEOUT" else 502 if exc.code == "AI_INVALID_OUTPUT" else 503,
                            {"code": exc.code, "message": exc.message}) from exc


@router.post("/tasks", status_code=201)
def create_task(payload: TaskInput):
    with connection() as db:
        cur = db.execute("INSERT INTO tasks(topic,card,confirmed_fields,status,created_at) VALUES(?,?,?,?,?)",
                         (payload.topic, payload.card.model_dump_json(), json.dumps(payload.confirmed_fields), "draft", now()))
        return task_from_row(db, task_row(db, cur.lastrowid))


@router.put("/tasks/{task_id}")
def update_task(task_id: int, payload: TaskInput):
    with connection() as db:
        task_row(db, task_id)
        db.execute("UPDATE tasks SET topic=?,card=?,confirmed_fields=? WHERE id=?",
                   (payload.topic, payload.card.model_dump_json(), json.dumps(payload.confirmed_fields), task_id))
        return task_from_row(db, task_row(db, task_id))


@router.post("/tasks/{task_id}/publish")
def publish_task(task_id: int):
    with connection() as db:
        row = task_row(db, task_id)
        if not json.loads(row["card"]).get("title", "").strip():
            fail(422, "VALIDATION_ERROR", "Для публикации заполните название задачи")
        db.execute("UPDATE tasks SET status='published' WHERE id=?", (task_id,))
        return task_from_row(db, task_row(db, task_id))


@router.get("/tasks")
def list_tasks(topic: str | None = None, level: str | None = None):
    if level and level not in ("draft", "working", "ready", "priority"):
        fail(422, "VALIDATION_ERROR", "Неизвестный уровень готовности")
    with connection() as db:
        rows = db.execute("SELECT * FROM tasks WHERE status='published'").fetchall()
        tasks = [task_from_row(db, row) for row in rows]
        tasks = [task for task in tasks if (not topic or task["topic"] == topic) and (not level or task["level"] == level)]
        tasks.sort(key=lambda task: (-task["score"], task["id"]))
        return {"tasks": tasks}


@router.get("/tasks/{task_id}")
def get_task(task_id: int):
    with connection() as db:
        return task_from_row(db, task_row(db, task_id))


@router.get("/teams")
def list_teams():
    with connection() as db:
        teams = []
        for row in db.execute("SELECT * FROM teams ORDER BY id"):
            team = dict(row)
            for key in ("interests", "skills", "technologies"):
                team[key] = json.loads(team[key])
            teams.append(team)
        return {"teams": teams}


@router.get("/tasks/{task_id}/proposals")
def list_proposals(task_id: int):
    with connection() as db:
        task_row(db, task_id)
        return {"proposals": [proposal_from_row(row) for row in db.execute("SELECT * FROM proposals WHERE task_id=? ORDER BY id DESC", (task_id,))]}


@router.post("/tasks/{task_id}/proposals", status_code=201)
def create_proposal(task_id: int, payload: ProposalInput):
    with connection() as db:
        row = task_row(db, task_id)
        if row["status"] != "published":
            fail(409, "CONFLICT", "Отклик доступен после публикации")
        if db.execute("SELECT 1 FROM teams WHERE id=?", (payload.team_id,)).fetchone() is None:
            fail(404, "NOT_FOUND", "Команда не найдена")
        cur = db.execute("INSERT INTO proposals(task_id,team_id,idea,plan,duration_days,prototype_url,created_at) VALUES(?,?,?,?,?,?,?)",
                         (task_id, payload.team_id, payload.idea, payload.plan, payload.duration_days, str(payload.prototype_url), now()))
        return proposal_from_row(db.execute("SELECT * FROM proposals WHERE id=?", (cur.lastrowid,)).fetchone())


@router.patch("/proposals/{proposal_id}")
def decide_proposal(proposal_id: int, payload: DecisionInput):
    with connection() as db:
        # Serialize decisions with milestone confirmation before reading state.
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
        if row is None:
            fail(404, "NOT_FOUND", "Предложение не найдено")
        if row["milestone_confirmed"] and payload.status != "selected":
            fail(409, "CONFLICT", "После подтверждения этапа решение изменить нельзя")
        db.execute("UPDATE proposals SET status=? WHERE id=?", (payload.status, proposal_id))
        return proposal_from_row(db.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone())


@router.post("/proposals/{proposal_id}/milestones/confirm")
def confirm_milestone(proposal_id: int):
    with connection() as db:
        # Lock before the read so concurrent retries cannot award twice.
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
        if row is None:
            fail(404, "NOT_FOUND", "Предложение не найдено")
        if row["status"] != "selected":
            fail(409, "CONFLICT", "Сначала выберите команду")
        if not row["milestone_confirmed"]:
            db.execute("UPDATE proposals SET milestone_confirmed=1, points=10 WHERE id=?", (proposal_id,))
            db.execute("UPDATE teams SET points=points+10 WHERE id=?", (row["team_id"],))
        return proposal_from_row(db.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone())
