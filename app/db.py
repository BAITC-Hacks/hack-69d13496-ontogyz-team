import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.scoring import readiness

ROOT = Path(__file__).resolve().parent.parent


def database_path() -> Path:
    setting = os.getenv("DATABASE_PATH", "data/hackalem.db")
    path = Path(setting)
    return path if path.is_absolute() else ROOT / path


@contextmanager
def connection():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    with connection() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY, topic TEXT NOT NULL, card TEXT NOT NULL,
                confirmed_fields TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS teams (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, interests TEXT NOT NULL,
                skills TEXT NOT NULL, technologies TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS proposals (
                id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id),
                team_id INTEGER NOT NULL REFERENCES teams(id), idea TEXT NOT NULL,
                plan TEXT NOT NULL, duration_days INTEGER NOT NULL, prototype_url TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', milestone_confirmed INTEGER NOT NULL DEFAULT 0,
                points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS draft_examples (
                id INTEGER PRIMARY KEY, text TEXT NOT NULL, topic TEXT NOT NULL
            );
        """)
        if db.execute("SELECT COUNT(*) FROM teams").fetchone()[0]:
            return
        examples = [
            ("Ритейл", "Снизить списания продуктов", "В магазине часто списывают продукты с истекшим сроком.", "Хотим уменьшить списания", "Менеджеры магазина", "Есть еженедельные отчёты о списаниях."),
            ("Образование", "Упростить запись на консультации", "Студенты записываются преподавателям через разные чаты.", "Нужен единый порядок записи", "Студенты и преподаватели", "Есть обезличенное расписание."),
            ("Экология", "Отслеживать заявки на вывоз отходов", "Заявки поступают по телефону и теряются.", "Хотим видеть статус заявок", "Жители и диспетчеры", "Есть архив заявок за месяц."),
            ("Здравоохранение", "Понять загруженность кабинетов", "В некоторых кабинетах бывают очереди.", "Нужно изучить распределение обращений", "Администраторы", "Данных пока нет."),
            ("Транспорт", "Упорядочить сообщения об остановках", "Пассажиры отправляют обращения в разных каналах.", "Нужен удобный учёт обращений", "Пассажиры и операторы", "Есть примеры обращений."),
        ]
        # Synthetic examples cover all readiness levels without changing an
        # existing database. They are acceptance scenarios, not measured results.
        extra_fields = {
            2: {
                "expected_result": "Форма записи на консультацию и общий список свободных слотов.",
                "constraints": "Использовать только обезличенное расписание; не собирать оценки студентов.",
            },
            3: {
                "expected_result": "Реестр заявок со статусами: получена, назначена, выполнена.",
                "success_criteria": "На 10 синтетических заявках диспетчер видит текущий статус каждой; закрытая заявка остаётся в истории.",
                "contact": "Тестовый контакт диспетчера: demo@example.org (синтетический адрес).",
                "interaction_format": "Демонстрационное условие: короткая консультация с диспетчером раз в неделю, вопросы к данным — в общем списке.",
            },
            5: {
                "expected_result": "Единый список обращений с названием остановки, темой и статусом рассмотрения.",
            },
        }
        team_profiles = [
            (["анализ данных", "визуализация"], ["Python", "pandas"]),
            (["UX", "веб-разработка"], ["JavaScript", "HTML", "CSS"]),
            (["процессы", "API", "базы данных"], ["Python", "FastAPI", "SQLite"]),
            (["исследование пользователей", "аналитика"], ["Python", "SQL"]),
            (["интерфейсы", "работа с геоданными"], ["JavaScript", "SQL"]),
        ]
        for i, (topic, title, context, need, users, data) in enumerate(examples, 1):
            card = dict.fromkeys(("title", "context", "need", "users", "data", "constraints", "expected_result", "success_criteria", "contact", "interaction_format"), "")
            card.update(title=title, context=context, need=need, users=users, data=data if i != 4 else "")
            card.update(extra_fields.get(i, {}))
            fields = [key for key, value in card.items() if key != "title" and value]
            db.execute("INSERT INTO tasks(topic,card,confirmed_fields,status,created_at) VALUES(?,?,?,?,?)", (topic, json.dumps(card, ensure_ascii=False), json.dumps(fields), "published", now()))
            draft_text = f"Нам нужно решить проблему: {need.lower()}."
            if i in (2, 3, 5):
                draft_text = " ".join([context, need + ".", data, card["expected_result"]])
            if i == 3:
                draft_text += " " + card["success_criteria"] + " " + card["interaction_format"]
            db.execute("INSERT INTO draft_examples(text,topic) VALUES(?,?)", (draft_text, topic))
            skills, technologies = team_profiles[i - 1]
            db.execute("INSERT INTO teams(name,interests,skills,technologies) VALUES(?,?,?,?)", (f"Команда {i}", json.dumps([topic], ensure_ascii=False), json.dumps(skills, ensure_ascii=False), json.dumps(technologies)))
            db.execute("INSERT INTO proposals(task_id,team_id,idea,plan,duration_days,prototype_url,created_at) VALUES(?,?,?,?,?,?,?)", (i, i, f"Исследовать проблему и сделать прототип для задачи {i}.", "Собрать требования, создать прототип и проверить его.", 14, f"https://example.org/prototype/{i}", now()))


def task_from_row(db: sqlite3.Connection, row: sqlite3.Row) -> dict:
    card = json.loads(row["card"])
    fields = json.loads(row["confirmed_fields"])
    count = db.execute("SELECT COUNT(*) FROM proposals WHERE task_id=?", (row["id"],)).fetchone()[0]
    return {"id": row["id"], "topic": row["topic"], "card": card, "confirmed_fields": fields,
            "status": row["status"], **readiness(card, fields), "proposals_count": count,
            "created_at": row["created_at"]}


def proposal_from_row(row: sqlite3.Row) -> dict:
    result = dict(row)
    result["milestone_confirmed"] = bool(result["milestone_confirmed"])
    return result
