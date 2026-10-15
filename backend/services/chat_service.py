"""컨텍스트 주입 채팅: 요약 → 시스템 프롬프트 → GPT(+도구) → 대화 자동 저장."""
import datetime as dt
import json
import os

from openai import OpenAI

from services import conversation_service, data_service, summary_service

client = OpenAI()  # OPENAI_API_KEY, OPENAI_BASE_URL(COPA)을 환경변수에서 읽는다
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
MAX_TOKENS = 500
HISTORY = 10
TOOL_ROUNDS = 3  # 도구 호출 왕복 상한(무한 루프 방지)

# 요약은 항상 프롬프트에 넣고(미션 필수), 요약에 없는 세부는 GPT가 도구로 꺼내 본다
TOOLS = [
    {"type": "function", "function": {
        "name": "get_summary",
        "description": "저장된 HN 화제도 데이터 전체 요약(기간, 평균, 최고/최저, 추세, 월별 평균, 최근 일별 트렌드)을 다시 가져온다.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "get_data_range",
        "description": "특정 기간의 일별 화제도(value), 그날 트렌드 한 줄(memo), 1위 글 원제(top)를 가져온다. 요약에 없는 날짜나 기간을 물으면 사용한다. 최대 100일.",
        "parameters": {"type": "object", "properties": {
            "start": {"type": "string", "description": "시작일 YYYY-MM-DD"},
            "end": {"type": "string", "description": "종료일 YYYY-MM-DD"}},
            "required": ["start", "end"]}}},
    {"type": "function", "function": {
        "name": "get_cards",
        "description": "가장 최근 발행된 카드뉴스(어제 HN 인기 글 5개 + 국내 기술 블로그 새 글)의 제목·요약을 가져온다. 오늘 뉴스, 카드, 블로그를 물으면 사용한다.",
        "parameters": {"type": "object", "properties": {}}}},
]


def run_tool(name: str, args: dict):
    """도구 실행. MCP 서버도 같은 이름·인자를 쓴다."""
    if name == "get_summary":
        return summary_service.build_summary()
    if name == "get_data_range":
        start, end = dt.date.fromisoformat(args["start"]), dt.date.fromisoformat(args["end"])
        return data_service.list_data(start, end, limit=100)[::-1]  # 오름차순
    if name == "get_cards":
        from services import card_service  # card_service가 이 모듈을 import하므로 지연 import
        c = card_service.latest()
        if not c:
            return {"error": "발행된 카드가 없습니다"}
        return {"date": c["date"], "source_day": c["source_day"],
                "hn": [{k: it[k] for k in ("title_ko", "summary_ko", "title", "points")} for it in c["items"]],
                "blogs": [{k: b[k] for k in ("blog", "title", "summary_ko")} for b in c.get("blogs", [])]}
    raise ValueError(f"unknown tool {name}")

SYSTEM_TEMPLATE = """당신은 IT 트렌드 분석 비서입니다. 아래는 사용자가 모아 둔 Hacker News 화제도 데이터 요약입니다.
화제도(value) = 그날 작성된 글 중 100점 이상 받은 인기 글 수, 트렌드 = 그날 인기 글들을 한 문장으로 정의한 것입니다.

[사용자 데이터 요약]
- 데이터 기간: {period}
- 총 레코드: {count}개
- 평균 화제도: {average}
- 최고: {max_date} {max_value}건 ("{max_memo}")
- 최저: {min_date} {min_value}건 ("{min_memo}")
- 최신: {latest_date} {latest_value}건
- 최근 트렌드: {trend}
- 월별 평균: {monthly}
- 최근 일별 트렌드:
{headlines}

규칙:
- 위 데이터에 근거해 한국어로 짧고 구체적으로 답하세요. 수치를 말할 때는 날짜를 함께 쓰세요.
- 도구로 받은 영어 원제(top)는 한국어로 풀어 설명하되 원문 제목도 괄호로 남기세요.
- 요약에 없는 특정 날짜·기간의 값은 get_data_range로, 오늘의 카드뉴스·기술 블로그는 get_cards로 조회한 뒤 답하세요.
- 도구로도 없는 사실(기사 본문 등)은 지어내지 말고 "데이터에 없다"고 말하세요.
- "Show HN"(직접 만든 것 공개), "Ask HN"(질문 글)은 번역하지 마세요.
- 화면이 마크다운을 렌더링하지 않으니 **굵게**, # 제목 같은 기호 없이 평문으로 쓰세요. 목록은 "- "만 쓰세요."""


def system_prompt(s: dict) -> str:
    if not s["metrics"]:
        return "당신은 IT 트렌드 분석 비서입니다. 아직 저장된 데이터가 없으니, 데이터를 먼저 추가하라고 안내하세요."
    m = s["metrics"]
    return SYSTEM_TEMPLATE.format(
        period=s["period"], count=s["count"], average=m["average"],
        max_date=m["max"]["date"], max_value=m["max"]["value"], max_memo=m["max"]["memo"],
        min_date=m["min"]["date"], min_value=m["min"]["value"], min_memo=m["min"]["memo"],
        latest_date=m["latest"]["date"], latest_value=m["latest"]["value"],
        trend=s["trend"],
        monthly=", ".join(f"{x['month']} {x['avg']}" for x in s["monthly_avg"]),
        headlines="\n".join(f"  - {h['date']}: {h['memo']}" for h in s["recent_headlines"]),
    )


def chat(message: str, conversation_id: str | None) -> dict:
    history = []
    if conversation_id:
        history = conversation_service.get(conversation_id)["messages"][-HISTORY:]  # 없으면 Missing

    messages = [{"role": "system", "content": system_prompt(summary_service.build_summary())},
                *({"role": h["role"], "content": h["content"]} for h in history),
                {"role": "user", "content": message}]
    used = []
    for i in range(TOOL_ROUNDS + 1):
        res = client.chat.completions.create(
            model=MODEL, messages=messages, max_completion_tokens=MAX_TOKENS,
            **({"tools": TOOLS} if i < TOOL_ROUNDS else {}),  # 마지막 회차는 도구 없이 답을 강제
        )
        msg = res.choices[0].message
        if not msg.tool_calls:
            break
        messages.append(msg.model_dump(exclude_none=True))
        for call in msg.tool_calls:
            used.append(call.function.name)
            try:
                out = run_tool(call.function.name, json.loads(call.function.arguments or "{}"))
            except Exception as e:  # 잘못된 인자 등은 GPT에 돌려줘 스스로 고치게 한다
                out = {"error": str(e)}
            messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(out, ensure_ascii=False)})
    reply = msg.content or "(빈 응답)"

    # GPT 호출이 성공한 뒤에만 질문+답을 한 번에 저장 → 반쪽 대화가 남지 않는다
    turn = [{"role": "user", "content": message}, {"role": "assistant", "content": reply}]
    if conversation_id:
        conversation_service.append(conversation_id, turn)
    else:
        conversation_id = conversation_service.create(turn)
    return {"conversation_id": conversation_id, "reply": reply, "tools_used": used}
