import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class MilestoneConcurrencyTest(unittest.TestCase):
    def test_concurrent_confirmations_award_only_once(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "test.db")}):
                with TestClient(app) as client:
                    selected = client.patch("/api/proposals/1", json={"status": "selected"})
                    self.assertEqual(selected.status_code, 200)
                    barrier = Barrier(8)

                    def confirm(_):
                        barrier.wait(timeout=10)
                        return client.post("/api/proposals/1/milestones/confirm", json={})

                    with ThreadPoolExecutor(max_workers=8) as pool:
                        responses = list(pool.map(confirm, range(8)))
                    for response in responses:
                        self.assertEqual(response.status_code, 200, response.text)
                        self.assertEqual(response.json()["points"], 10)
                    teams = client.get("/api/teams").json()["teams"]
                    self.assertEqual(next(t["points"] for t in teams if t["id"] == 1), 10)
                    rejected = client.patch("/api/proposals/1", json={"status": "rejected"})
                    self.assertEqual(rejected.status_code, 409)


if __name__ == "__main__":
    unittest.main()
