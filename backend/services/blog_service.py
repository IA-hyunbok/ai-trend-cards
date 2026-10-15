"""국내 기업 기술 블로그 RSS/Atom 수집. 키 불필요."""
import datetime as dt
import email.utils
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

from services.hn_service import _strip

FEEDS = {
    "토스": "https://toss.tech/rss.xml",
    "카카오": "https://tech.kakao.com/feed/",
    "우아한형제들": "https://techblog.woowahan.com/feed/",
    "네이버 D2": "https://d2.naver.com/d2.atom",
    "LY(라인)": "https://techblog.lycorp.co.jp/ko/feed/index.xml",
    "당근": "https://medium.com/feed/daangn",
    "여기어때": "https://techblog.gccompany.co.kr/feed",
}


def _parse_date(s: str) -> dt.datetime | None:
    try:
        d = email.utils.parsedate_to_datetime(s)  # RSS: RFC 822
    except (TypeError, ValueError):
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))  # Atom: ISO 8601
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


def _fetch(blog: str, url: str) -> list[dict]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 ai-trend-cards"})
        with urllib.request.urlopen(req, timeout=8) as res:
            root = ET.fromstring(res.read())
    except Exception:
        return []  # 한 블로그가 죽어도 나머지는 낸다
    posts = []
    for e in root.iter():
        if e.tag.split("}")[-1] not in ("item", "entry"):
            continue
        f = {}  # 네임스페이스를 떼고 태그명 → 요소
        for c in e:
            f.setdefault(c.tag.split("}")[-1], c)
        link = f.get("link")
        date = next((_parse_date(f[k].text or "") for k in ("pubDate", "published", "updated") if k in f), None)
        if link is None or "title" not in f or not date:
            continue
        body = next((f[k].text for k in ("encoded", "content", "description", "summary") if k in f and f[k].text), "")
        posts.append({"blog": blog, "title": (f["title"].text or "").strip(),
                      "url": (link.text or link.get("href") or "").strip(),
                      "published": date.isoformat(), "text": " ".join(_strip(body).split())[:800]})
    return posts


def recent(days: int = 7) -> list[dict]:
    """최근 days일 새 글, 최신순."""
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    with ThreadPoolExecutor(len(FEEDS)) as ex:
        posts = [p for ps in ex.map(lambda kv: _fetch(*kv), FEEDS.items()) for p in ps]
    posts = [p for p in posts if dt.datetime.fromisoformat(p["published"]) >= since and p["url"]]
    return sorted(posts, key=lambda p: p["published"], reverse=True)


if __name__ == "__main__":
    assert _parse_date("Wed, 14 Oct 2026 05:06:00 GMT").isoformat() == "2026-10-14T05:06:00+00:00"
    assert _parse_date("2026-10-08T06:44:57Z").isoformat() == "2026-10-08T06:44:57+00:00"
    assert _parse_date("garbage") is None
    for p in recent(14):
        print(p["published"][:10], p["blog"], p["title"], "|", p["text"][:60])
