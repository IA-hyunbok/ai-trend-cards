"""최근 N일 HN 화제도를 data 컬렉션에 적재한다. 점수가 굳은 이틀 전까지만.

사용: cd backend && ../.venv/bin/python -m scripts.seed [일수=130]
"""
import datetime as dt
import sys

from services import data_service, hn_service

days = int(sys.argv[1]) if len(sys.argv) > 1 else 130
last = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=2)

rows = []
for i in range(days):
    day = last - dt.timedelta(days=i)
    rows.append(hn_service.daily_stat(day))
    print(f"\r{i + 1}/{days} {day}", end="", flush=True)
print()

data_service.upsert_many(rows)
print(f"적재 완료: {len(rows)}건 ({rows[-1]['date']} ~ {rows[0]['date']})")
