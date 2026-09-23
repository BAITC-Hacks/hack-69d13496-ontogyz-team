"""Controlled model doubles for the independent 16:30 review regressions."""

import unittest
from unittest.mock import AsyncMock, patch

from app.ai import service


def card_selection(**fields):
    return {"title": "Проверка", **{field: [] for field in service.SOURCE_FIELDS}, **fields}


def questions_with_result(text):
    return {"questions": [
        {"id": "q1", "field": "expected_result", "text": text},
        {"id": "q2", "field": "data", "text": "Какие данные доступны?"},
        {"id": "q3", "field": "success_criteria", "text": "Как проверить результат?"},
    ]}


class ReviewRegressions(unittest.IsolatedAsyncioTestCase):
    def test_future_sources_are_not_available(self):
        for text in (
            "CSV появится через месяц, когда начнём собирать записи.",
            "Выгрузка будет доступна после запуска учёта.",
            "Журнал начнут вести на следующей неделе.",
            "Исходную таблицу получим через две недели.",
            "Записи планируем собирать с октября.",
        ):
            with self.subTest(text=text):
                self.assertFalse(service._describes_existing_data(text))

    async def test_future_availability_keeps_condition_but_not_data(self):
        for text in (
            "CSV появится через месяц, когда начнём собирать записи.",
            "Выгрузка будет доступна после запуска учёта.",
        ):
            with self.subTest(text=text):
                raw = card_selection(expected_result=["s1"], data=["s2"], constraints=["s2"])
                with patch.object(service, "_model_json", AsyncMock(return_value=raw)):
                    card = await service.build_card("Нужна таблица списаний магазина. " + text, "Ритейл", [])
                self.assertEqual(card["data"], "")
                self.assertEqual(card["constraints"], text)
                self.assertEqual(card["expected_result"], "Нужна таблица списаний магазина.")

    async def test_existing_csv_and_paraphrase_are_preserved(self):
        for text in (
            "Есть CSV со списаниями за месяц.",
            "Выгрузка уже доступна в Excel.",
            "Мы получили CSV после закрытия месяца.",
            "Есть CSV для обработки завтра.",
        ):
            with self.subTest(text=text):
                self.assertTrue(service._describes_existing_data(text))
                with patch.object(service, "_model_json", AsyncMock(return_value=card_selection(data=["s1"]))):
                    card = await service.build_card(text, "Ритейл", [])
                self.assertEqual(card["data"], text)

    async def test_existing_source_survives_next_to_future_source(self):
        raw = card_selection(data=["s1", "s2"], constraints=["s2"])
        with patch.object(service, "_model_json", AsyncMock(return_value=raw)):
            card = await service.build_card(
                "Есть CSV за август. Новая выгрузка появится через месяц.", "Ритейл", [])
        self.assertEqual(card["data"], "Есть CSV за август.")
        self.assertEqual(card["constraints"], "Новая выгрузка появится через месяц.")

    async def test_user_duty_preserves_role_action_and_frequency(self):
        for text in (
            "Управляющий должен просматривать отчёт каждый день.",
            "Руководитель смены обязан ежедневно пользоваться сводкой.",
            "Аналитики должны проверять показатели в интерфейсе.",
        ):
            with self.subTest(text=text):
                raw = card_selection(expected_result=["s1"], users=["s2"])
                with patch.object(service, "_model_json", AsyncMock(return_value=raw)):
                    card = await service.build_card("Нужен отчёт по товарам.", "Ритейл",
                                                    [{"question_id": "q1", "answer": text}])
                self.assertEqual(card["users"], text)
                self.assertEqual(card["contact"], "")

    async def test_prohibited_prototype_does_not_rewrite_valid_question(self):
        for draft in (
            "Прототип создавать нельзя. Нужен только аналитический отчёт.",
            "Разработка прототипа запрещена. Требуется аналитическая записка.",
            "Прототип не нужен. Нужна таблица.",
            "Есть прототип. Нужен отчёт о его недостатках.",
        ):
            with self.subTest(draft=draft):
                original = "Какой конкретный продукт нужен в результате?"
                with patch.object(service, "_model_json", AsyncMock(return_value=questions_with_result(original))):
                    questions = await service.generate_questions(draft, "Ритейл")
                self.assertEqual(questions[0]["text"], original)
                self.assertNotIn("запрошенный прототип", " ".join(q["text"] for q in questions))

    async def test_explicit_requested_prototype_still_gets_detail_question(self):
        with patch.object(service, "_model_json", AsyncMock(return_value=questions_with_result(
                "Какой конкретный продукт нужен в результате?"))):
            questions = await service.generate_questions("Требуется прототип записи к врачу.", "Сервис")
        self.assertIn("Какие действия", questions[0]["text"])

    async def test_rewrite_collision_is_safe_invalid_output(self):
        raw = questions_with_result("Какой конкретный продукт нужен в результате?")
        raw["questions"][1] = {
            "id": "q2", "field": "expected_result",
            "text": "  КАКИЕ действия должен поддерживать уже запрошенный прототип? ",
        }
        with patch.object(service, "_model_json", AsyncMock(return_value=raw)):
            with self.assertRaises(service.AIServiceError) as caught:
                await service.generate_questions("Нужен прототип сервиса записи.", "Сервис")
        self.assertEqual(caught.exception.code, "AI_INVALID_OUTPUT")

    async def test_figures_reconciliation_is_only_acceptance(self):
        for text in (
            "Суммы списаний в отчёте должны совпадать с Excel.",
            "Итоговые значения должны соответствовать исходной таблице.",
        ):
            with self.subTest(text=text):
                raw = card_selection(success_criteria=["s1"], constraints=["s1"])
                with patch.object(service, "_model_json", AsyncMock(return_value=raw)):
                    card = await service.build_card(text, "Ритейл", [])
                self.assertEqual(card["success_criteria"], text)
                self.assertEqual(card["constraints"], "")

    async def test_independent_constraint_next_to_criterion_survives(self):
        raw = card_selection(success_criteria=["s1"], constraints=["s1", "s2"])
        with patch.object(service, "_model_json", AsyncMock(return_value=raw)):
            card = await service.build_card(
                "Суммы в отчёте должны совпадать с Excel. Нельзя менять кассовую систему.", "Ритейл", [])
        self.assertEqual(card["success_criteria"], "Суммы в отчёте должны совпадать с Excel.")
        self.assertEqual(card["constraints"], "Нельзя менять кассовую систему.")

    async def test_mixed_constraint_and_criterion_are_not_blanket_deduplicated(self):
        text = "Суммы должны совпадать с Excel, без передачи файла сторонним сервисам."
        raw = card_selection(success_criteria=["s1"], constraints=["s1"])
        with patch.object(service, "_model_json", AsyncMock(return_value=raw)):
            card = await service.build_card(text, "Ритейл", [])
        self.assertEqual(card["success_criteria"], text)
        self.assertEqual(card["constraints"], text)


if __name__ == "__main__":
    unittest.main()
