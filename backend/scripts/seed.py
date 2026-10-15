"""최근 N일 HN 화제도 + 그날 트렌드 한 줄(GPT)을 data 컬렉션에, 그날 카드를 day_cards에 적재한다. 점수가 굳은 이틀 전까지만.

사용: cd backend && ../.venv/bin/python -m scripts.seed [일수=130]
"""
import datetime as dt
import sys
from concurrent.futures import ThreadPoolExecutor

from services import data_service
from services.card_service import daily_row, day_cards

days = int(sys.argv[1]) if len(sys.argv) > 1 else 130
last = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=2)

rows = []
with ThreadPoolExecutor(8) as ex:  # HN 수집 + GPT 한 줄을 동시에
    for i, row in enumerate(ex.map(daily_row, (last - dt.timedelta(days=i) for i in range(days)))):
        rows.append(row)
        print(f"\r{i + 1}/{days} {row['date']} {row['memo'][:30]}", end="", flush=True)
print()

data_service.upsert_many(rows)
print(f"적재 완료: {len(rows)}건 ({rows[-1]['date']} ~ {rows[0]['date']})")

# 캘린더 카드 미리 생성(이미 있는 날짜는 건너뜀)
with ThreadPoolExecutor(8) as ex:
    for i, _ in enumerate(ex.map(day_cards, (dt.date.fromisoformat(r["date"]) for r in rows))):
        print(f"\r카드 {i + 1}/{len(rows)}", end="", flush=True)
print()
