"""오늘의 카드뉴스: HN 수집 → GPT 한국어 카드 → Firestore 저장 → 디스코드 웹훅."""
import datetime as dt
import json
import logging
import os
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from firebase_admin import firestore

from db import db
from services import data_service, hn_service
from services.chat_service import MODEL, client

COL = db.collection("cards")
TOP_N = 5
KST = dt.timezone(dt.timedelta(hours=9))
log = logging.getLogger("uvicorn.error")

CARD_PROMPT = """아래는 어제 Hacker News 인기 글 {n}개입니다. 각 글에 제목, 원문 사이트, 원문 소개문(있으면)이 있습니다. 각 글을 한국어 카드뉴스 한 장으로 만드세요.

규칙:
- title_ko: 무슨 소식인지 바로 알 수 있는 한국어 제목(40자 이내). 제품·회사·기술 이름은 원어 유지. "Show HN"(직접 만든 것 공개), "Ask HN"(질문 글)은 번역하지 말고 그대로 앞에 둔다
- summary_ko: 1~2문장. 소개문에 있는 구체적 사실(기능, 수치, 이유)만 쓴다. "주목받고 있다", "중요한 주제다" 같은 내용 없는 문장은 쓰지 않는다
- 소개문이 (없음)이면 제목에서 확실한 것만 1문장. "정보가 없다"는 말은 쓰지 않는다. 수치·기능을 지어내지 않는다
- 순서와 개수를 그대로 유지한다
- 다른 말 없이 JSON 배열만 출력: [{{"title_ko": "...", "summary_ko": "..."}}, ...]

{items}"""


def latest() -> dict | None:
    docs = list(COL.order_by("date", direction=firestore.Query.DESCENDING).limit(1).stream())
    return docs[0].to_dict() if docs else None


def publish() -> dict:
    """하루 한 번. 같은 날 다시 불려도 기존 카드를 돌려주고 디스코드에 또 보내지 않는다."""
    utc_today = dt.datetime.now(dt.timezone.utc).date()
    card_date = dt.datetime.now(KST).date().isoformat()

    # 1. 시계열을 하루 늘린다 (점수가 굳은 이틀 전)
    data_service.upsert_many([hn_service.daily_stat(utc_today - dt.timedelta(days=2))])

    ref = COL.document(card_date)
    existing = ref.get()
    if existing.exists and existing.to_dict().get("posted_to_discord"):
        return existing.to_dict()

    # 2~3. 어제 인기 글 상위 N개 → 한국어 카드
    source_day = utc_today - dt.timedelta(days=1)
    top = hn_service.stories(source_day)[:TOP_N]
    items = [{"title": s["title"], "url": s["url"], "points": s["points"], "comments": s["comments"], **ko}
             for s, ko in zip(top, _translate(top))]

    card = {"date": card_date, "source_day": source_day.isoformat(), "items": items,
            "posted_to_discord": False, "created_at": dt.datetime.now(dt.timezone.utc).isoformat()}
    ref.set(card)

    # 4. 디스코드
    card["posted_to_discord"] = _post_discord(card)
    ref.update({"posted_to_discord": card["posted_to_discord"]})
    return card


def _translate(stories: list[dict]) -> list[dict]:
    fallback = [{"title_ko": s["title"], "summary_ko": ""} for s in stories]
    if not stories:
        return []
    with ThreadPoolExecutor(len(stories)) as ex:  # 원문 소개문을 동시에 가져온다(각 6초 타임아웃)
        # 원문 소개문 우선. HN 본문은 "See also" 같은 곁가지일 수 있어 뒤에 붙인다
        descs = list(ex.map(lambda s: " / ".join(x for x in (hn_service.describe(s["url"]), s["text"]) if x), stories))
    block = "\n\n".join(
        f"{i + 1}. 제목: {s['title']}\n   사이트: {urllib.parse.urlparse(s['url']).netloc}\n   소개문: {d or '(없음)'}"
        for i, (s, d) in enumerate(zip(stories, descs)))
    try:
        res = client.chat.completions.create(
            model=MODEL, max_completion_tokens=1200,
            messages=[{"role": "user", "content": CARD_PROMPT.format(n=len(stories), items=block)}],
        )
        text = res.choices[0].message.content or ""
        parsed = json.loads(re.search(r"\[.*\]", text, re.S).group(0))  # 코드펜스가 붙어도 배열만 뽑는다
        if len(parsed) != len(stories):
            raise ValueError(f"개수 불일치 {len(parsed)} != {len(stories)}")
        return [{"title_ko": str(p.get("title_ko") or s["title"])[:100],
                 "summary_ko": str(p.get("summary_ko") or "")[:300]} for p, s in zip(parsed, stories)]
    except Exception:
        # COPA는 JSON 모드 미지원 → 파싱 실패 시 원문 제목으로라도 발행
        log.exception("card translate failed, using original titles")
        return fallback


def _post_discord(card: dict) -> bool:
    url = os.getenv("DISCORD_WEBHOOK_URL")
    if not url:
        return False
    embeds = [{
        "title": f"{i + 1}. {it['title_ko']}"[:256],
        "url": it["url"],
        "description": f"{it['summary_ko']}\n\n> {it['title']}\n▲ {it['points']}점 · 💬 {it.get('comments', 0)}"[:4000],
        "color": 0xFF6600,  # HN 오렌지
    } for i, it in enumerate(card["items"])]
    body = {"username": "IT 트렌드 카드",
            "content": f"📰 **{card['date']} IT 트렌드 카드** — Hacker News 어제의 인기 글 {len(embeds)}선",
            "embeds": embeds}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json",
        "User-Agent": "ai-trend-cards (https://github.com/IA-hyunbok/ai-trend-cards, 1.0)",  # 기본 UA는 Cloudflare가 막는다
    })
    try:
        with urllib.request.urlopen(req, timeout=20):
            return True
    except Exception:
        log.exception("discord webhook failed")
        return False
