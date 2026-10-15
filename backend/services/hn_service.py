"""Hacker News(Algolia) 수집. 키 불필요."""
import datetime as dt
import html
import json
import re
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
             "points": h.get("points") or 0, "comments": h.get("num_comments") or 0,
             "text": _strip(h.get("story_text") or "")[:500]}  # Ask/Show HN 본문
            for h in hits if h.get("title")]


def _strip(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", s)).strip()


def describe(url: str) -> str:
    """원문 페이지의 소개문 + 본문 앞부분. 실패하면 빈 문자열(카드 요약 근거용)."""
    if "news.ycombinator.com" in url:
        return ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 ai-trend-cards"})
        with urllib.request.urlopen(req, timeout=6) as res:
            page = res.read(300_000).decode(res.headers.get_content_charset() or "utf-8", "ignore")
    except Exception:
        return ""
    meta = ""
    for pat in (r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)',
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description',
                r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)'):
        m = re.search(pat, page, re.I)
        if m:
            meta = _strip(m.group(1))[:400]
            break
    # 소개문만으로는 요약이 한 줄에 그친다 → 40자 넘는 본문 문단 앞부분을 더한다
    paras = [" ".join(_strip(p).split()) for p in re.findall(r"<p[^>]*>(.*?)</p>", page, re.S | re.I)]
    body = " ".join(p for p in paras if len(p) > 40)[:800]
    return " / ".join(x for x in (meta, body) if x)

