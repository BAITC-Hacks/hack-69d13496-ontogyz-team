"""Explicit live evaluation fixtures for the 16:30 independent review.

Calls the real SDK through HTTP routes and prints unedited model/HTTP responses.
No production request logging; the observer is active only in this manual test.
"""

import json
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from openai.resources.chat.completions import AsyncCompletions

from app.main import app


CASES = [
    {"id": "future_csv", "draft": "Нужна таблица списаний магазина. CSV появится через месяц, когда начнём собирать записи."},
    {"id": "future_paraphrase", "draft": "Требуется сводка возвратов. Выгрузка будет доступна после запуска учёта."},
    {"id": "existing_csv", "draft": "Нужна таблица списаний магазина. Есть CSV со списаниями за месяц."},
    {"id": "known_facts", "draft": "Магазин ведёт списания в Excel. Нужен отчёт по товарам.", "answers": [
        {"question_id": "q1", "answer": "Управляющий должен просматривать отчёт каждый день."},
        {"question_id": "q2", "answer": "Управляющий отвечает на вопросы команды на еженедельном созвоне."},
        {"question_id": "q3", "answer": "Суммы списаний в отчёте должны совпадать с Excel."},
    ]},
    {"id": "known_facts_paraphrase", "draft": "Выгрузка уже доступна в Excel. Требуется сводка возвратов.", "answers": [
        {"question_id": "q1", "answer": "Руководитель смены обязан ежедневно пользоваться сводкой."},
        {"question_id": "q2", "answer": "Итоговые значения должны соответствовать исходной таблице."},
        {"question_id": "q3", "answer": "Нельзя менять кассовую систему."},
    ]},
    {"id": "prohibited_prototype", "draft": "Прототип создавать нельзя. Нужен только аналитический отчёт.", "questions": True},
    {"id": "prohibited_prototype_paraphrase", "draft": "Разработка прототипа запрещена. Требуется аналитическая записка.", "questions": True},
    {"id": "requested_prototype", "draft": "Требуется прототип сервиса записи к врачу.", "questions_only": True},
]


def main():
    observations = []
    original_create = AsyncCompletions.create

    async def observe(client, *args, **kwargs):
        response = await original_create(client, *args, **kwargs)
        observations.append({
            "model": response.model,
            "input": json.loads(kwargs["messages"][1]["content"]),
            "content": response.choices[0].message.content,
            "input_tokens": response.usage.prompt_tokens,
            "output_tokens": response.usage.completion_tokens,
        })
        return response

    records = []
    with tempfile.TemporaryDirectory() as directory:
        with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "evaluation.db")}):
            with patch.object(AsyncCompletions, "create", observe), TestClient(app) as client:
                for case in CASES:
                    endpoints = ["questions"] if case.get("questions_only") else ["card"]
                    if case.get("questions"):
                        endpoints.insert(0, "questions")
                    for endpoint in endpoints:
                        payload = {"draft": case["draft"], "topic": "Ритейл" if "prototype" not in case["id"] else "Сервис"}
                        if endpoint == "card":
                            payload["answers"] = case.get("answers", [])
                        start = len(observations)
                        started = time.perf_counter()
                        response = client.post("/api/ai/" + endpoint, json=payload)
                        records.append({
                            "id": case["id"], "endpoint": endpoint, "request": payload,
                            "latency_ms": round((time.perf_counter() - started) * 1000),
                            "http_status": response.status_code,
                            "model_responses": observations[start:], "http_response": response.json(),
                        })
    print(json.dumps({"cases": records, "total_usage": {
        "input_tokens": sum(item["input_tokens"] for item in observations),
        "output_tokens": sum(item["output_tokens"] for item in observations),
    }}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
