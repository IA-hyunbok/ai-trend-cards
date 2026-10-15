"""IT 트렌드 카드 MCP 서버(stdio). 배포된 API를 HTTP로 호출하므로 Firebase 키가 필요 없다.

채팅 Function Calling과 같은 도구 3개(get_summary, get_data_range, get_cards)를
Claude Desktop·Claude Code 같은 MCP 클라이언트에 노출한다.

실행: pip install -r mcp_server/requirements.txt && python mcp_server/server.py
API 주소 변경: 환경변수 API_BASE_URL (기본 배포 주소)
"""
import json
import os
import urllib.parse
import urllib.request

from mcp.server import MCPServer

API = os.getenv("API_BASE_URL", "https://ai-trend-cards.onrender.com").rstrip("/")
mcp = MCPServer("ai-trend-cards")


def _get(path: str, **params) -> dict | list:
    url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    with urllib.request.urlopen(url, timeout=90) as res:  # Render 무료 플랜 콜드스타트 대비
        return json.load(res)


@mcp.tool()
def get_summary() -> dict:
    """HN 화제도 데이터 전체 요약: 기간, 평균, 최고/최저, 최근 추세, 월별 평균, 최근 헤드라인."""
    return _get("/api/data/summary")


@mcp.tool()
def get_data_range(start: str, end: str) -> list:
    """기간(YYYY-MM-DD ~ YYYY-MM-DD)의 일별 화제도(value=100점 넘은 인기 글 수)와 1위 헤드라인(memo). 날짜 오름차순."""
    return _get("/api/data", start=start, end=end, limit=100)[::-1]


@mcp.tool()
def get_cards() -> dict:
    """가장 최근 카드뉴스: 어제 HN 인기 글 5개의 한국어 제목·요약 + 국내 기술 블로그 새 글."""
    return _get("/api/cards/latest")


if __name__ == "__main__":
    mcp.run()
