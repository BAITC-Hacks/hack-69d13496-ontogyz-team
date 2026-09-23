"""Manual, two-phase live evaluation of six sequential AI conversations.

The first phase prints actual questions. Write answers to those exact question IDs
in a fixture JSON, then run the card phase. This script handles only test fixtures.
"""

import json
import sys
import time
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from openai.resources.chat.completions import AsyncCompletions

from app.main import app


CASES = [
    {"id": "weak_retail", "topic": "Ритейл",
     "draft": "В магазине много списаний. Хотим сократить их."},
    {"id": "education", "topic": "Образование",
     "draft": "Студенты записываются на консультации в разных чатах. Хотим единый порядок записи."},
    {"id": "business_feedback", "topic": "Здравоохранение",
     "draft": "Бизнесу нужен прототип сервиса записи к врачу."},
    {"id": "detailed_logistics", "topic": "Логистика",
     "draft": "Склад вручную распределяет 300 заявок в день между 12 курьерами по Excel. "
              "Есть адрес, временное окно и вес заказа. Нужно сократить подготовку маршрутов "
              "до 20 минут. Максимальная смена курьера — восемь часов."},
    {"id": "unknown_information", "topic": "Здравоохранение",
     "draft": "Пациенты долго ждут на приём. Хотим улучшить запись, но данные и целевой "
              "показатель пока неизвестны."},
    {"id": "contradictions", "topic": "HR",
     "draft": "Хотим полностью автоматизировать отбор кандидатов, но финальное решение "
              "рекрутер принимает вручную. Нельзя менять текущий процесс в этом году; "
              "результат нужен через неделю."},
]


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"questions", "cards"}:
        raise SystemExit("Usage: python -m app.ai.conversation_eval questions | cards QUESTIONS_JSON ANSWERS_JSON")
    phase = sys.argv[1]
    previous = {}
    answers_by_case = {}
    if phase == "cards":
        if len(sys.argv) != 4:
            raise SystemExit("Card phase requires question and answer fixture JSON paths")
        previous = {item["id"]: item for item in json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["cases"]}
        answers_by_case = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))

    observations = []
    original_create = AsyncCompletions.create

    async def observed_create(client, *args, **kwargs):
        response = await original_create(client, *args, **kwargs)
        observations.append({
            "model": response.model,
            "input": json.loads(kwargs["messages"][1]["content"]),
            "content": response.choices[0].message.content,
            "input_tokens": response.usage.prompt_tokens,
            "output_tokens": response.usage.completion_tokens,
        })
        return response

    results = []
    with patch.object(AsyncCompletions, "create", observed_create):
        with TestClient(app) as client:
            for case in CASES:
                record = dict(case)
                if phase == "cards":
                    questions = previous[case["id"]]["questions"]
                    answers = answers_by_case[case["id"]]
                    expected_ids = {question["id"] for question in questions}
                    assert len(answers) == len(expected_ids)
                    assert {answer["question_id"] for answer in answers} == expected_ids
                    record["questions"] = questions
                    record["answers"] = answers
                    path = "/api/ai/card"
                    payload = {**{key: case[key] for key in ("draft", "topic")}, "answers": answers}
                else:
                    path = "/api/ai/questions"
                    payload = {key: case[key] for key in ("draft", "topic")}
                start = len(observations)
                started = time.perf_counter()
                response = client.post(path, json=payload)
                record["latency_ms"] = round((time.perf_counter() - started) * 1000)
                record["http_status"] = response.status_code
                record["model_responses"] = observations[start:]
                record["http_response"] = response.json()
                if phase == "questions" and response.status_code == 200:
                    record["questions"] = record["http_response"]["questions"]
                results.append(record)

    print(json.dumps({"phase": phase, "cases": results, "total_usage": {
        "input_tokens": sum(item["input_tokens"] for item in observations),
        "output_tokens": sum(item["output_tokens"] for item in observations),
    }}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
