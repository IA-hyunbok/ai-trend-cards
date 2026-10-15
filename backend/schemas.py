import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DataCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    date: dt.date = Field(examples=["2026-10-01"])
    value: int = Field(ge=0, le=1000, description="그날 100점 이상 HN 인기 글 수(IT 화제도)", examples=[52])
    memo: str = Field("", max_length=300, description="그날 1위 헤드라인")

    @field_validator("date")
    @classmethod
    def not_future(cls, v: dt.date) -> dt.date:
        if v > dt.date.today():
            raise ValueError("미래 날짜는 넣을 수 없습니다")
        return v


class DataUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    value: int | None = Field(None, ge=0, le=1000)
    memo: str | None = Field(None, max_length=300)

    @model_validator(mode="after")
    def at_least_one(self):
        if self.value is None and self.memo is None:
            raise ValueError("value나 memo 중 하나는 있어야 합니다")
        return self


class DataItem(BaseModel):
    date: dt.date
    value: int
    memo: str


class Point(BaseModel):
    date: dt.date
    value: int
    memo: str = ""


class Metrics(BaseModel):
    average: float
    max: Point
    min: Point
    latest: Point


class MonthAvg(BaseModel):
    month: str
    avg: float


class Headline(BaseModel):
    date: dt.date
    memo: str


class Summary(BaseModel):
    period: str
    count: int
    metrics: Metrics | None
    trend: str
    monthly_avg: list[MonthAvg]
    recent_headlines: list[Headline]


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)
    ts: dt.datetime | None = None


class ConversationCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str | None = Field(None, max_length=100, description="비우면 첫 메시지 앞 30자")
    messages: list[Message] = Field(min_length=1, max_length=200)


class ConversationCreated(BaseModel):
    id: str


class ConversationMeta(BaseModel):
    """목록용: messages는 포함하지 않는다. 불러오기는 GET /api/conversations/{id}."""
    id: str
    title: str
    updated_at: dt.datetime
    message_count: int


class Conversation(BaseModel):
    id: str
    title: str
    created_at: dt.datetime
    updated_at: dt.datetime
    messages: list[Message]


class ChatRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    message: str = Field(min_length=1, max_length=1000, examples=["요즘 IT 쪽 분위기 어때?"])
    conversation_id: str | None = Field(None, description="이어서 대화할 때. 비우면 새 대화를 만든다")


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str


class CardItem(BaseModel):
    title: str
    title_ko: str
    summary_ko: str
    url: str
    points: int
    comments: int = 0


class BlogItem(BaseModel):
    blog: str
    title: str
    url: str
    published: str
    summary_ko: str


class Card(BaseModel):
    date: dt.date = Field(description="발행일(KST)")
    source_day: dt.date = Field(description="글 작성일(UTC)")
    items: list[CardItem]
    blogs: list[BlogItem] = Field(default=[], description="국내 기술 블로그 새 글")
    posted_to_discord: bool
