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
UNINFORMATIVE = {
    "не знаю", "нет данных", "данных нет", "неизвестно", "пока неизвестно",
    "не указано", "не определено", "не предоставлено", "нет сведений",
    "сведений нет", "нет информации", "n/a", "unknown",
}


def has_information(value: str) -> bool:
    # Normalize only whole placeholder answers; preserve useful negative facts
    # such as "Нет доступа к персональным данным".
    text = " ".join(value.split()).casefold().strip(" .,!?:;—–-_…\"'«»()[]")
    return bool(text) and text not in UNINFORMATIVE


def readiness(card: dict, confirmed_fields: list[str]) -> dict:
    confirmed = set(confirmed_fields)
    breakdown = {
        field: weight if field in confirmed and has_information(str(card.get(field, ""))) else 0
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
