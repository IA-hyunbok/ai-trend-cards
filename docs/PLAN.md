# 기획서 — 환율 AI 비서 (8_AI Agent 개발)

작성: 2026-10-14

## 1. 한 줄 정의

원/달러 환율 데이터를 저장·관리하고, 그 요약을 GPT 시스템 프롬프트에 주입해 "이번 달 환율 어때?"에 **내 데이터 기준 숫자로** 답하는 웹 비서.

## 2. 아이디어톤 — 데이터 선정

| 후보 | 출처 | 100개+ | 판정 |
|---|---|---|---|
| **A. 원/달러 환율** | FRED `DEXKOUS` 공개 CSV(키 불필요) | 최근 1년 약 268개 | **채택** |
| B. 보유 ETF 종가 | 시세 CSV | 수백 | 시세 출처 확보 부담 |
| C. 취준 지원 기록 | 노션 지원현황 | 약 70일, 부족 | 회사명이 공개 저장소에 노출 |
| D. Claude 토큰 비용 | 로컬 로그 | 기간 의존 | 집계 dedup 선행 필요 |

채택 이유: 일별 단일 수치라 `(date, value, memo)` 스키마에 그대로 맞고, 추세·최고/최저·월 비교 질문이 자연스럽다. 공개 데이터라 저장소·배포에 노출돼도 문제없다.

- `value` = 1달러당 원화(예: 1342.13)
- `memo` = 사용자가 남기는 메모(예: "FOMC 발표", "환전함"). 시드 데이터는 빈 문자열

### 예상 질문 → 요약에 무엇이 있어야 답할 수 있나

| 질문 | 필요한 요약 항목 |
|---|---|
| 이번 달 환율 어때? | 이번 달 평균 vs 지난달 평균, 최신값 |
| 최근 1년 최고점은 언제? | max + 해당 날짜 |
| 요즘 오르는 중이야? | 최근 30일 평균 vs 직전 30일 평균, 7일 변화율 |
| 지금 환전해도 될까? | 최신값의 1년 범위 내 위치(백분위) — 투자 조언은 하지 않도록 프롬프트에 명시 |
| 메모 남긴 날 환율은? | 메모가 있는 레코드 목록(최근 N개) |

→ 요약 = 기본 통계 + 날짜 붙은 최고/최저 + 월별 평균(최대 13행) + 추세 + 메모 레코드. 원본 268행을 통째로 넣지 않고 수백 토큰으로 압축하는 것이 컨텍스트 주입의 핵심.

## 3. 기술 스택 (미션 고정)

| 영역 | 선택 |
|---|---|
| 백엔드 | FastAPI + Pydantic, uvicorn — Render |
| DB | Firebase Firestore (firebase-admin) |
| LLM | openai SDK → **COPA 게이트웨이**(`OPENAI_BASE_URL`), 모델 `gpt-4o` |
| 프론트 | 바닐라 HTML/CSS/JS — Vercel |

COPA 확인 결과(2026-10-14): `/v1/chat/completions` OpenAI 호환, `gpt-4o`·`gpt-5`·`gpt-5-mini` 사용 가능, tools(function calling) 동작, `reasoning_effort` 미지원. openai SDK는 `OPENAI_BASE_URL` 환경변수를 자동으로 읽으므로 별도 코드가 필요 없다.

## 4. 저장소 구조

```
fx-ai-assistant/
├── backend/
│   ├── main.py              # 앱 생성, CORS, 라우터 등록, /health
│   ├── config.py            # 환경변수 로드
│   ├── db.py                # Firestore 클라이언트 (서비스 계정 JSON은 env에서)
│   ├── schemas.py           # Pydantic 요청/응답 모델
│   ├── routers/             # HTTP 계층: 검증·상태코드만
│   │   ├── data.py
│   │   ├── conversations.py
│   │   └── chat.py
│   ├── services/            # 비즈니스 로직: Firestore·OpenAI 호출
│   │   ├── data_service.py
│   │   ├── summary_service.py
│   │   ├── conversation_service.py
│   │   └── chat_service.py
│   ├── scripts/seed.py      # FRED CSV → Firestore 일괄 적재
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── vercel.json          # 빌드 시 config.js 생성
└── docs/PLAN.md
```

분리 기준: **router는 HTTP를 알고 DB를 모른다, service는 DB를 알고 HTTP를 모른다.** `/api/chat`이 요약을 얻을 때 자기 서버의 `/api/data/summary`를 HTTP로 부르지 않고 `summary_service.build_summary()`를 직접 호출한다 — 같은 로직을 두 엔드포인트가 재사용하는 것이 summary를 서비스로 분리한 이유.

## 5. Firestore 컬렉션 설계

### `data/{date}`
```json
{ "date": "2026-10-09", "value": 1342.13, "memo": "", "updated_at": "<timestamp>" }
```
- **문서 ID = 날짜.** 같은 날짜 중복을 앱 코드가 아니라 DB 키로 막는다. POST에서 이미 있으면 409
- PUT은 `value`·`memo`만 수정. 날짜를 바꾸려면 삭제 후 추가(문서 ID가 바뀌므로)

### `conversations/{autoId}`
```json
{
  "title": "이번 달 환율 어때?",
  "created_at": "<timestamp>", "updated_at": "<timestamp>",
  "messages": [ { "role": "user|assistant", "content": "...", "ts": "<iso>" } ]
}
```
- messages를 문서 안 배열로 둔다. 대화 하나를 한 번에 읽고 쓰는 접근 패턴이라 서브컬렉션보다 단순. 문서 1MB 한도는 이 서비스 규모에서 닿지 않는다
- 목록 조회는 `messages`를 빼고 반환 — 불러오기는 **(A) 방식** `GET /api/conversations/{id}`

## 6. API 명세

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| POST | /api/data | `{date, value, memo?}` | 201 생성된 레코드 / 409 날짜 중복 |
| GET | /api/data | `?start=&end=&limit=` | 날짜 내림차순 목록 |
| PUT | /api/data/{date} | `{value?, memo?}` | 수정된 레코드 / 404 |
| DELETE | /api/data/{date} | — | 204 / 404 |
| GET | /api/data/summary | — | 요약 JSON(아래) |
| POST | /api/conversations | `{title?, messages[]}` | 201 `{id}` |
| GET | /api/conversations | — | `[{id, title, updated_at, message_count}]` |
| GET | /api/conversations/{id} | — | 전체 messages |
| DELETE | /api/conversations/{id} | — | 204 / 404 |
| POST | /api/chat | `{message, conversation_id?}` | `{conversation_id, reply}` |
| GET | /health | — | `{status: "ok"}` (콜드스타트 깨우기용) |

라우트 순서: `{date}` 경로는 PUT/DELETE에만 있어 `GET /api/data/summary`와 충돌하지 않는다. 나중에 `GET /api/data/{date}`를 추가하면 summary를 그보다 먼저 등록해야 한다.

### 요약 응답 예시
```json
{
  "period": "2025-10-01 ~ 2026-10-09",
  "count": 268,
  "metrics": {
    "latest": {"date": "2026-10-09", "value": 1342.13},
    "average": 1385.4,
    "max": {"date": "...", "value": 1480.2},
    "min": {"date": "...", "value": 1338.0},
    "latest_percentile": 3
  },
  "trend": "하락 (최근 30일 평균이 직전 30일 대비 -1.8%)",
  "change_7d_pct": -0.4,
  "monthly_avg": [{"month": "2026-10", "avg": 1341.5}, "..."],
  "memos": [{"date": "...", "value": 0, "memo": "FOMC"}]
}
```
추세 판정: 최근 30일 평균 vs 직전 30일 평균 변화율이 ±0.5% 이내면 "유지", 그 밖이면 상승/하락.

### Pydantic 검증
- `date`: `datetime.date` 타입(형식 오류 자동 422), 미래 날짜 거부
- `value`: `float`, `gt=0`, `lt=10000`(원/달러 상식 범위 — 데이터 오염 방지)
- `memo`: `max_length=200`, 앞뒤 공백 제거
- `message`(chat): `min_length=1`, `max_length=1000`

## 7. 채팅 흐름 (컨텍스트 주입)

```
POST /api/chat {message, conversation_id?}
 1. summary = summary_service.build_summary()
 2. system = SYSTEM_TEMPLATE.format(요약 항목)
 3. history = 기존 대화의 최근 10개 메시지 (conversation_id 있을 때)
 4. reply = openai.chat.completions.create(model, [system, *history, user], max_tokens=500)
 5. conversation_service.append(id 또는 새로 생성, user+assistant 메시지)   ← 자동 저장
 6. return {conversation_id, reply}
```

시스템 프롬프트 원칙:
- 요약에 없는 수치는 지어내지 말고 "데이터에 없다"고 말할 것
- 환전·투자 판단은 데이터 위치만 설명하고 권유하지 않을 것
- 숫자는 원 단위, 소수 둘째 자리

저장 시점: 응답을 받은 뒤 user+assistant를 **한 번에** 저장. GPT 호출이 실패하면 아무것도 저장하지 않아 질문만 있고 답이 없는 반쪽 대화가 남지 않는다. 새 대화의 제목은 첫 질문 앞 30자.

## 8. 프론트엔드

한 페이지, 데스크톱은 3단(대화 목록 | 채팅 | 데이터), 모바일(≤768px)은 하단 탭 3개로 전환.

| 영역 | 기능 |
|---|---|
| 상단 요약 카드 | 기간·개수·최신값·추세 (데이터 변경 시 재조회) |
| 채팅 | 입력, 말풍선, "생각 중…" 로딩, 전송 중 버튼 비활성 |
| 데이터 | 추가 폼, 최근 목록, 행별 수정/삭제 |
| 대화 기록 | 목록, 클릭 시 불러오기, 삭제, "새 대화" |

상태: `state = { conversationId, messages, data, summary }` 하나. 대화 불러오기 → `conversationId` 교체 → 이후 채팅이 그 대화에 이어 붙는다.

API 주소 주입: 정적 사이트는 Vercel 환경변수를 런타임에 못 읽으므로 빌드 명령에서 생성한다.
```json
{ "buildCommand": "echo \"window.API_BASE_URL='$API_BASE_URL';\" > config.js", "outputDirectory": "." }
```
로컬은 `config.js`가 없으면 `http://localhost:8000`으로 폴백.

콜드스타트 대응: 페이지 로드 즉시 `/health` 호출 → 3초 안에 응답 없으면 "무료 서버를 깨우는 중입니다(최대 1분)" 배너 → 응답 오면 배너 제거 후 초기 데이터 로드.

## 9. 환경 변수

| 이름 | 위치 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | Render | COPA 키 |
| `OPENAI_BASE_URL` | Render | `<COPA 호스트>/v1` |
| `OPENAI_MODEL` | Render | 기본 `gpt-4o` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Render | 서비스 계정 JSON 전체를 한 줄 문자열로 |
| `ALLOWED_ORIGINS` | Render | `https://<vercel 도메인>,http://localhost:5500` |
| `API_BASE_URL` | Vercel | `https://<render 도메인>` |

키는 `.env`(gitignore)와 각 플랫폼 대시보드에만. 커밋 전 시크릿 grep.

## 10. 위험과 대응

| 위험 | 대응 |
|---|---|
| 배포본을 동료가 두드려 COPA 예산 소진 | `max_tokens=500`, 메시지 1000자 제한, 히스토리 10개 제한 |
| 매 채팅마다 data 전체 읽기(268 reads) | Firestore 무료 일 5만 reads → 하루 약 180회 채팅까지 여유. 넘치면 쓰기 시 무효화하는 메모리 캐시 |
| CORS 오류 | `ALLOWED_ORIGINS`에 Vercel 프로덕션 도메인 정확히(끝 `/` 없이) |
| Render 콜드스타트 | /health 선호출 + 배너 |
| 악성/오염 입력 | Pydantic 범위 검증, 프론트는 `textContent`로만 렌더(XSS 방지) |

## 11. 진행 순서

| 단계 | 산출물 | 완료 기준 |
|---|---|---|
| M0 | 저장소·기획서 | ✅ 이 문서 |
| M1 | 백엔드 data CRUD + summary + seed | 로컬 /docs에서 5개 엔드포인트 동작, Firestore에 268건 |
| M2 | conversations + chat | Swagger에서 질문 → 요약 반영 답변 + 대화 저장 확인 |
| M3 | 프론트 | 로컬에서 4개 영역 동작, 모바일 폭 확인 |
| M4 | Render·Vercel 배포 | 배포 URL에서 전체 흐름 동작 |
| M5 | README·스크린샷 3장 | 미션 README 항목 전부 |
| M6 | 보너스 | 아래 |

### 보너스 계획
1. **Function Calling + MCP**: tools = `get_summary`, `get_data_range(start, end)`, `list_conversations`, `search_manual(query)`. "3월 초 환율은?"처럼 요약에 없는 구간 질문에서 GPT가 `get_data_range`를 부르는 것을 근거로 README에 흐름 정리. 같은 도구를 `backend/mcp_server.py`(공식 `mcp` 패키지)로 노출해 Claude Desktop에서 호출 검증
   - **`search_manual` — 코디세이 매뉴얼 Q&A** (2026-10-14 결정: 매뉴얼 챗봇을 주제로 삼지 않고 보너스 도구로 붙인다. 주제로 삼으면 시계열·summary 요건과 동료평가 항목이 어긋난다)
   - 출처: 공개해도 되는 문서만 `backend/manual/*.md`로 둔다. **RESUME `위키/` 원문은 넣지 않는다** — 운영 사고·인프라 감사 등 내부 기록이고, 저장소와 배포본이 공개다. 어떤 문서를 넣을지는 착수 시점에 사용자 확인
   - 검색: 문서를 제목 단위로 잘라 키워드 일치 점수로 상위 3개를 반환(벡터DB 없음). ponytail: 문서 수십 개까지는 키워드로 충분, 동의어 질문에서 못 찾으면 임베딩 검토
   - 라우팅 근거: 환율 질문은 요약/`get_data_range`, "동료평가 어떻게 해?" 같은 코디세이 이용 질문은 `search_manual` — README에 질문별 호출 도구 표로 정리
2. **인사이트·UX**: summary에 `latest_percentile`·`change_7d_pct` 추가(이미 설계에 포함), SVG 꺾은선 그래프(라이브러리 없이), CSV 내보내기(`Blob` 다운로드), 다크 모드 토글

## 12. 준비물 (사용자)

- [ ] Firebase 프로젝트 생성 → Firestore 활성화 → 서비스 계정 키 JSON 발급
- [ ] Render 계정(GitHub IA-hyunbok 연동)
- [ ] Vercel 계정(GitHub IA-hyunbok 연동)
- COPA 키는 기존 `genai-multimodal-ad/.env` 값을 사용
