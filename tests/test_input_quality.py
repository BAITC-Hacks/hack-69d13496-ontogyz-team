import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.scoring import WEIGHTS, readiness


class InputQualityTests(unittest.TestCase):
    def test_fresh_seed_covers_readiness_levels_and_is_not_repeated(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "test.db")}):
                with TestClient(app) as client:
                    tasks = client.get("/api/tasks").json()["tasks"]
                    self.assertEqual(len(tasks), 5)
                    self.assertEqual({task["level"] for task in tasks}, {"draft", "working", "ready", "priority"})
                    self.assertEqual([task["score"] for task in tasks], sorted([task["score"] for task in tasks], reverse=True))
                    teams = client.get("/api/teams").json()["teams"]
                    self.assertEqual(len(teams), 5)
                    self.assertEqual(len({tuple(team["skills"]) for team in teams}), 5)
                    self.assertTrue(all(team["points"] == 0 for team in teams))
                with TestClient(app) as restarted:
                    self.assertEqual(restarted.get("/api/tasks").json()["tasks"], tasks)

    def test_placeholder_punctuation_does_not_award_points(self):
        for text in ("Не знаю.", "Нет данных!", "неизвестно", "  нет   данных  ",
                     "…", "?", "—", "«Не указано»", "UNKNOWN."):
            with self.subTest(text=text):
                result = readiness(dict.fromkeys(WEIGHTS, text), list(WEIGHTS))
                self.assertEqual(result["score"], 0)
                self.assertEqual(set(result["missing_fields"]), set(WEIGHTS))
        self.assertEqual(readiness(
            {"constraints": "Нет доступа к персональным данным."},
            ["constraints"],
        )["score"], 10)

    def test_whitespace_and_boolean_payloads_are_rejected_before_processing(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "test.db")}):
                with patch("app.routes.api.generate_questions", new_callable=AsyncMock) as ai:
                    with TestClient(app) as client:
                        proposal = {"team_id": 1, "idea": "Проверить причины списаний",
                                    "plan": "Изучить синтетическую выгрузку", "duration_days": 14,
                                    "prototype_url": "https://example.org/demo"}
                        invalid = [
                            ("/api/tasks", {"topic": "   ", "card": {"title": "Проверка"}}),
                            ("/api/ai/questions", {"topic": "Ритейл", "draft": " " * 12}),
                            ("/api/tasks/1/proposals", {**proposal, "idea": " " * 12}),
                            ("/api/tasks/1/proposals", {**proposal, "plan": " " * 12}),
                            ("/api/tasks/1/proposals", {**proposal, "duration_days": True}),
                            ("/api/tasks/1/proposals", {**proposal, "team_id": True}),
                        ]
                        for url, payload in invalid:
                            with self.subTest(url=url, payload=payload):
                                response = client.post(url, json=payload)
                                self.assertEqual(response.status_code, 422, response.text)
                                self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")
                        self.assertEqual(len(client.get("/api/tasks/1/proposals").json()["proposals"]), 1)
                    ai.assert_not_awaited()

    def test_normalized_task_and_score_survive_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "test.db")}):
                with TestClient(app) as client:
                    response = client.post("/api/tasks", json={
                        "topic": "  Ритейл  ",
                        "card": {"title": "  Аудит  ", "context": "  Нет данных!  ",
                                 "constraints": "  Нет доступа к персональным данным.  "},
                        "confirmed_fields": ["context", "constraints"],
                    })
                    self.assertEqual(response.status_code, 201)
                    task = response.json()
                    self.assertEqual(task["score"], 10)
                    self.assertEqual(task["topic"], "Ритейл")
                    self.assertEqual(task["card"]["title"], "Аудит")
                with TestClient(app) as restarted:
                    persisted = restarted.get(f"/api/tasks/{task['id']}").json()
                    self.assertEqual(persisted, task)


if __name__ == "__main__":
    unittest.main()
