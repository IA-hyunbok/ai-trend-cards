import datetime as dt

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
