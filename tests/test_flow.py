import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from httpx import Request, Response
from openai import NotFoundError

from app.main import app
from app.scoring import WEIGHTS


class ChallengeFlowTest(unittest.TestCase):
    def test_publish_low_score_then_improve_and_select_two_teams(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "test.db")}):
                with TestClient(app) as client:
                    self.assertEqual(client.get("/api/health").json(), {"status": "ok"})
                    self.assertEqual(len(client.get("/api/tasks").json()["tasks"]), 5)
                    self.assertEqual(len(client.get("/api/teams").json()["teams"]), 5)

                    card = dict.fromkeys(["title", *WEIGHTS], "")
                    card.update(title="Проверка отходов", context="На складе есть отходы", need="Нужен учёт")
                    payload = {"topic": "Экология", "card": card, "confirmed_fields": ["context", "need"]}
                    response = client.post("/api/tasks", json=payload)
                    self.assertEqual(response.status_code, 201, response.text)
                    task = response.json()
                    self.assertEqual(task["score"], 20)
                    task_id = task["id"]
                    self.assertEqual(client.post(f"/api/tasks/{task_id}/publish", json={}).status_code, 200)
                    visible = client.get("/api/tasks?level=draft").json()["tasks"]
                    self.assertIn(task_id, [row["id"] for row in visible])

                    proposal = {"team_id": 1, "idea": "Сделать анализ и прототип учёта",
                                "plan": "Собрать данные и проверить прототип",
                                "duration_days": 14, "prototype_url": "https://example.org/demo"}
                    first = client.post(f"/api/tasks/{task_id}/proposals", json=proposal)
                    self.assertEqual(first.status_code, 201, first.text)
                    second = client.post(f"/api/tasks/{task_id}/proposals", json={**proposal, "team_id": 2})
                    self.assertEqual(second.status_code, 201, second.text)
                    self.assertEqual(client.patch(f"/api/proposals/{first.json()['id']}", json={"status": "selected"}).status_code, 200)
                    self.assertEqual(client.patch(f"/api/proposals/{second.json()['id']}", json={"status": "selected"}).status_code, 200)
                    milestone = f"/api/proposals/{first.json()['id']}/milestones/confirm"
                    self.assertEqual(client.post(milestone, json={}).json()["points"], 10)
                    self.assertEqual(client.post(milestone, json={}).json()["points"], 10)
                    self.assertEqual(client.get("/api/teams").json()["teams"][0]["points"], 10)

                    for field in WEIGHTS:
                        card[field] = "Подтверждённое бизнесом описание"
                    improved = client.put(f"/api/tasks/{task_id}", json={"topic": "Экология", "card": card,
                              "confirmed_fields": list(WEIGHTS)}).json()
                    self.assertEqual(improved["score"], 100)
                    self.assertEqual(improved["level"], "priority")
                    self.assertEqual(client.get("/api/tasks?level=priority").json()["tasks"][0]["id"], task_id)
                    self.assertEqual(client.post(f"/api/tasks/{task_id}/proposals",
                        json={**proposal, "prototype_url": "not-a-url"}).status_code, 422)

    def test_ai_requires_key_and_never_returns_fake_questions(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "test.db")}):
                with patch("app.ai.service.config", return_value=""):
                    with TestClient(app) as client:
                        response = client.post("/api/ai/questions", json={"draft": "Хотим сократить списания", "topic": "Ритейл"})
                        self.assertEqual(response.status_code, 503)
                        self.assertEqual(response.json()["error"]["code"], "AI_NOT_CONFIGURED")

    def test_missing_model_returns_safe_ai_error(self):
        error = NotFoundError(
            "model unavailable",
            response=Response(404, request=Request("POST", "https://api.openai.com/v1/chat/completions")),
            body=None,
        )
        client_mock = MagicMock()
        client_mock.chat.completions.create = AsyncMock(side_effect=error)
        context_mock = MagicMock()
        context_mock.__aenter__ = AsyncMock(return_value=client_mock)
        context_mock.__aexit__ = AsyncMock(return_value=None)
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "test.db")}):
                with patch("app.ai.service.config", return_value="test-only-key"):
                    with patch("openai.AsyncOpenAI", return_value=context_mock):
                        with TestClient(app) as client:
                            response = client.post("/api/ai/questions", json={"draft": "Хотим сократить списания", "topic": "Ритейл"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "AI_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
