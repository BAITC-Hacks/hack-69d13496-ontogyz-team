import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class BusinessTasksTest(unittest.TestCase):
    def test_saved_draft_can_be_found_and_updated_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "test.db")}):
                payload = {"topic": "Ритейл", "card": {"title": "Продолжить после перезапуска",
                           "context": "В магазине есть списания"}, "confirmed_fields": ["context"]}
                with TestClient(app) as client:
                    saved = client.post("/api/tasks", json=payload).json()
                    self.assertNotIn(saved["id"], [row["id"] for row in client.get("/api/tasks").json()["tasks"]])
                with TestClient(app) as client:
                    drafts = client.get("/api/business/tasks?status=draft").json()["tasks"]
                    self.assertEqual(drafts, [saved])
                    all_tasks = client.get("/api/business/tasks").json()["tasks"]
                    self.assertEqual(all_tasks[0], saved)
                    self.assertEqual(len(all_tasks), 6)
                    resumed = client.get(f"/api/tasks/{saved['id']}").json()
                    self.assertEqual(resumed, saved)
                    payload["card"]["need"] = "Хотим изучить причины"
                    payload["confirmed_fields"].append("need")
                    updated = client.put(f"/api/tasks/{saved['id']}", json=payload).json()
                    self.assertEqual(updated["id"], saved["id"])
                    self.assertEqual(updated["score"], 20)
                    self.assertEqual(len(client.get("/api/business/tasks").json()["tasks"]), 6)
                    client.post(f"/api/tasks/{saved['id']}/publish", json={})
                    self.assertEqual(client.get("/api/business/tasks?status=draft").json()["tasks"], [])
                    published = client.get("/api/business/tasks?status=published").json()["tasks"]
                    self.assertIn(saved["id"], [row["id"] for row in published])
                    self.assertIn(saved["id"], [row["id"] for row in client.get("/api/tasks?level=draft").json()["tasks"]])
                    invalid = client.get("/api/business/tasks?status=deleted")
                    self.assertEqual(invalid.status_code, 422)
                    self.assertEqual(invalid.json()["error"]["code"], "VALIDATION_ERROR")


if __name__ == "__main__":
    unittest.main()
