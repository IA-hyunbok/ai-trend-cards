"""컨텍스트 주입 채팅: 요약 → 시스템 프롬프트 → GPT → 대화 자동 저장."""
import os

from openai import OpenAI

from services import conversation_service, summary_service

client = OpenAI()  # OPENAI_API_KEY, OPENAI_BASE_URL(COPA)을 환경변수에서 읽는다
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
MAX_TOKENS = 500
HISTORY = 10

SYSTEM_TEMPLATE = """당신은 IT 트렌드 분석 비서입니다. 아래는 사용자가 모아 둔 Hacker News 화제도 데이터 요약입니다.
화제도(value) = 그날 작성된 글 중 100점 이상 받은 인기 글 수, 헤드라인 = 그날 1위 글 제목입니다.

[사용자 데이터 요약]
- 데이터 기간: {period}
- 총 레코드: {count}개
- 평균 화제도: {average}
- 최고: {max_date} {max_value}건 ("{max_memo}")
- 최저: {min_date} {min_value}건 ("{min_memo}")
- 최신: {latest_date} {latest_value}건
- 최근 트렌드: {trend}
- 월별 평균: {monthly}
- 최근 헤드라인:
{headlines}

규칙:
- 위 데이터에 근거해 한국어로 짧고 구체적으로 답하세요. 수치를 말할 때는 날짜를 함께 쓰세요.
- 영어 헤드라인은 한국어로 풀어 설명하되 원문 제목도 괄호로 남기세요.
- 데이터에 없는 사실(기사 본문, 요약에 없는 날짜의 값)은 지어내지 말고 "데이터에 없다"고 말하세요.
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

    res = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": system_prompt(summary_service.build_summary())},
                  *({"role": h["role"], "content": h["content"]} for h in history),
                  {"role": "user", "content": message}],
        max_completion_tokens=MAX_TOKENS,
    )
    reply = res.choices[0].message.content or "(빈 응답)"

    # GPT 호출이 성공한 뒤에만 질문+답을 한 번에 저장 → 반쪽 대화가 남지 않는다
    turn = [{"role": "user", "content": message}, {"role": "assistant", "content": reply}]
    if conversation_id:
        conversation_service.append(conversation_id, turn)
    else:
        conversation_id = conversation_service.create(turn)
    return {"conversation_id": conversation_id, "reply": reply}
