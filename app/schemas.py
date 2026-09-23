from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

from app.scoring import WEIGHTS


class InputModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class Card(InputModel):
    title: str = Field(default="", max_length=160)
    context: str = Field(default="", max_length=2000)
    need: str = Field(default="", max_length=2000)
    users: str = Field(default="", max_length=2000)
    data: str = Field(default="", max_length=2000)
    constraints: str = Field(default="", max_length=2000)
    expected_result: str = Field(default="", max_length=2000)
    success_criteria: str = Field(default="", max_length=2000)
    contact: str = Field(default="", max_length=2000)
    interaction_format: str = Field(default="", max_length=2000)


class TaskInput(InputModel):
    topic: str = Field(min_length=1, max_length=80)
    card: Card
    confirmed_fields: list[str] = Field(default_factory=list, max_length=9)

    @field_validator("confirmed_fields")
    @classmethod
    def valid_confirmations(cls, fields: list[str]) -> list[str]:
        if len(fields) != len(set(fields)) or any(field not in WEIGHTS for field in fields):
            raise ValueError("Указаны повторяющиеся или неизвестные подтверждённые поля")
        return fields


class DraftInput(InputModel):
    draft: str = Field(min_length=10, max_length=6000)
    topic: str = Field(min_length=1, max_length=80)


class Answer(InputModel):
    question_id: str = Field(min_length=1, max_length=30)
    answer: str = Field(max_length=2000)


class CardGenerationInput(DraftInput):
    answers: list[Answer] = Field(default_factory=list, max_length=5)


class ProposalInput(InputModel):
    team_id: int = Field(gt=0, strict=True)
    idea: str = Field(min_length=10, max_length=2000)
    plan: str = Field(min_length=10, max_length=2000)
    duration_days: int = Field(ge=1, le=365, strict=True)
    prototype_url: HttpUrl


class DecisionInput(InputModel):
    status: Literal["selected", "rejected"]
