import datetime as dt
import os
import secrets

from fastapi import APIRouter, Header, HTTPException, Query

from schemas import Card, DayCards
from services import card_service

router = APIRouter(prefix="/api/cards", tags=["cards"])


@router.get("/latest", response_model=Card, summary="최신 카드뉴스")
def latest():
    card = card_service.latest()
    if not card:
        raise HTTPException(404, "아직 발행된 카드가 없습니다")
    return card


@router.get("/days", response_model=dict[str, DayCards], summary="기간 안의 저장된 날짜별 첫 카드 6장(최대 31일). 캘린더 한 달 미리 받기용")
def days_cards(start: dt.date, end: dt.date):
    if not 0 <= (end - start).days <= 31:
        raise HTTPException(400, "기간은 31일 이내여야 합니다")
    return card_service.day_cards_range(start, end)


@router.get("/day/{day}", response_model=DayCards, summary="그날(UTC) HN 인기 글 카드, 추천 순 6개씩(page). 처음 조회 때 생성 후 저장")
def day_cards(day: dt.date, page: int = Query(0, ge=0, le=20)):
    if not dt.date.today() - dt.timedelta(days=365) <= day < dt.date.today():
        raise HTTPException(400, "최근 1년 안의 지난 날짜만 볼 수 있습니다")
    return card_service.day_cards(day, page)


@router.post("/publish", response_model=Card, summary="오늘 카드 발행(수집+생성+디스코드). 스케줄러 전용")
def publish(x_cron_secret: str = Header("", description="CRON_SECRET 환경변수 값")):
    expected = os.getenv("CRON_SECRET", "")
    if not expected or not secrets.compare_digest(x_cron_secret, expected):
        raise HTTPException(401, "인증 실패")
    return card_service.publish()
