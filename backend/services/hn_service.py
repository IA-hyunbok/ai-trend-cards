"""Hacker News(Algolia) 수집. 키 불필요."""
import datetime as dt
import json
import urllib.parse
import urllib.request

API = "https://hn.algolia.com/api/v1/search"
MIN_POINTS = 100


def stories(day: dt.date, min_points: int = MIN_POINTS) -> list[dict]:
    """그날(UTC) 작성된 min_points 초과 글, 점수 내림차순."""
    start = int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp())
    params = urllib.parse.urlencode({
        "tags": "story",
        "numericFilters": f"created_at_i>={start},created_at_i<{start + 86400},points>{min_points}",
        "hitsPerPage": 1000,
    })
    with urllib.request.urlopen(f"{API}?{params}", timeout=30) as res:
        hits = json.load(res)["hits"]
    hits.sort(key=lambda h: h.get("points") or 0, reverse=True)
    return [{"title": h["title"], "url": h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}",
             "points": h.get("points") or 0} for h in hits if h.get("title")]


def daily_stat(day: dt.date) -> dict:
    """시계열 1행: value = 인기 글 수, memo = 1위 헤드라인."""
    s = stories(day)
    return {"date": day.isoformat(), "value": len(s), "memo": s[0]["title"][:300] if s else ""}
