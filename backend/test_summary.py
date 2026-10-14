"""summarize() 자체 점검. 실행: cd backend && ../.venv/bin/python test_summary.py"""
from services.summary_service import summarize

empty = summarize([])
assert empty["count"] == 0 and empty["metrics"] is None

# 28일 10 → 최근 7일 20: 상승 +100%
rows = [{"date": f"2026-08-{d:02d}", "value": 10, "memo": ""} for d in range(1, 29)]
rows += [{"date": f"2026-09-{d:02d}", "value": 20, "memo": f"h{d}"} for d in range(1, 8)]
s = summarize(rows)
assert s["count"] == 35
assert s["period"] == "2026-08-01 ~ 2026-09-07"
assert s["metrics"]["max"]["value"] == 20 and s["metrics"]["min"]["value"] == 10
assert s["trend"] == "상승 (최근 7일 평균 20.0 vs 직전 28일 평균 10.0, +100.0%)", s["trend"]
assert s["monthly_avg"] == [{"month": "2026-08", "avg": 10.0}, {"month": "2026-09", "avg": 20.0}]
assert s["recent_headlines"][0] == {"date": "2026-09-07", "memo": "h7"}  # 최신이 먼저, 빈 memo 제외
assert len(s["recent_headlines"]) == 7

flat = summarize([{"date": f"2026-08-{d:02d}", "value": 10, "memo": ""} for d in range(1, 31)])
assert flat["trend"].startswith("유지")

short = summarize(rows[:5])
assert short["trend"].startswith("판단 보류")

print("ok")
