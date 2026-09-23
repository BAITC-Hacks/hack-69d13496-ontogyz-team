WEIGHTS = {
    "context": 10,
    "need": 10,
    "data": 20,
    "expected_result": 15,
    "success_criteria": 15,
    "constraints": 10,
    "users": 10,
    "contact": 5,
    "interaction_format": 5,
}
UNINFORMATIVE = {"не знаю", "нет данных", "n/a", "unknown", "?", "-"}


def readiness(card: dict, confirmed_fields: list[str]) -> dict:
    confirmed = set(confirmed_fields)
    breakdown = {
        field: weight if field in confirmed and str(card.get(field, "")).strip().casefold() not in UNINFORMATIVE and str(card.get(field, "")).strip() else 0
        for field, weight in WEIGHTS.items()
    }
    score = sum(breakdown.values())
    if score < 40:
        level = "draft"
    elif score < 70:
        level = "working"
    elif score < 90:
        level = "ready"
    else:
        level = "priority"
    return {
        "score": score,
        "level": level,
        "score_breakdown": breakdown,
        "missing_fields": [field for field, points in breakdown.items() if points == 0],
    }
