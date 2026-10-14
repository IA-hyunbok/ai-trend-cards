"""시계열 요약. /api/data/summary와 채팅 프롬프트 주입이 같은 함수를 쓴다."""
from collections import defaultdict
from statistics import mean

TREND_WINDOW = 7   # 최근 구간
BASE_WINDOW = 28   # 비교 기준 구간
FLAT_PCT = 5.0     # ±이 안이면 "유지"
HEADLINES = 14


def summarize(rows: list[dict]) -> dict:
    """rows: 날짜 오름차순 [{date, value, memo}]. Firestore를 모르는 순수 함수."""
    if not rows:
        return {"period": "-", "count": 0, "metrics": None, "trend": "데이터 없음",
                "monthly_avg": [], "recent_headlines": []}

    values = [r["value"] for r in rows]
    months = defaultdict(list)
    for r in rows:
        months[r["date"][:7]].append(r["value"])

    return {
        "period": f"{rows[0]['date']} ~ {rows[-1]['date']}",
        "count": len(rows),
        "metrics": {
            "average": round(mean(values), 1),
            "max": max(rows, key=lambda r: r["value"]),
            "min": min(rows, key=lambda r: r["value"]),
            "latest": rows[-1],
        },
        "trend": _trend(values),
        "monthly_avg": [{"month": m, "avg": round(mean(v), 1)} for m, v in sorted(months.items())],
        "recent_headlines": [{"date": r["date"], "memo": r["memo"]} for r in rows[-HEADLINES:] if r["memo"]][::-1],
    }


def _trend(values: list[int]) -> str:
    recent, base = values[-TREND_WINDOW:], values[-(TREND_WINDOW + BASE_WINDOW):-TREND_WINDOW]
    if not base:
        return "판단 보류 (데이터 부족)"
    pct = (mean(recent) - mean(base)) / mean(base) * 100 if mean(base) else 0.0
    label = "유지" if abs(pct) <= FLAT_PCT else ("상승" if pct > 0 else "하락")
    return f"{label} (최근 {TREND_WINDOW}일 평균이 직전 {BASE_WINDOW}일 대비 {pct:+.1f}%)"


def build_summary() -> dict:
    from services import data_service  # Firestore 의존은 여기서만
    return summarize(data_service.all_rows())
