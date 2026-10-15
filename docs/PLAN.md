# 기획서 — IT 트렌드 카드뉴스 AI 비서 (8_AI Agent 개발)

작성: 2026-10-14 (환율 → IT 트렌드로 주제 변경)

## 1. 한 줄 정의

매일 Hacker News 인기 글을 수집해 **IT 화제도 시계열**로 쌓고, 그 요약을 GPT 시스템 프롬프트에 주입해 "요즘 뭐가 핫해?"에 데이터 기준으로 답하며, 매일 아침 한국어 **카드뉴스**를 웹과 디스코드에 올리는 비서.

## 2. 아이디어톤 경과

| 후보 | 판정 |
|---|---|
| 원/달러 환율 | 요건은 맞지만 재미·쓸모 없음 → 폐기 |
| 코디세이 매뉴얼 챗봇(위키) | 시계열·summary 요건과 어긋남, 내부 위키 공개 위험 → 폐기 |
| 내 AI 사용량·수면·가계부·ETF | 검토만 |
| **IT 트렌드 카드뉴스 + 디스코드** | **채택** — 매일 쓸모 있고, 미션 요건에 그대로 대응됨 |

## 3. 데이터

출처: HN Algolia 검색 API(`hn.algolia.com/api/v1/search`) — 키 불필요, 과거 날짜 조회 가능.

| 필드 | 의미 | 예 |
|---|---|---|
| `date` | 날짜(UTC 기준 하루) | 2026-10-01 |
| `value` | 그날 작성된 글 중 100점 이상 인기 글 수 = **IT 화제도** | 52 |
| `memo` | 그날 1위 헤드라인 | "FTC is investigating OpenAI, Anthropic…" |

- 확인값: 10/1 = 52개, 10/8 = 36개 → 날마다 변동이 있어 추세 분석 가능
- 시드: 최근 120일 이상 적재(100개 요건 충족)
- 점수는 글 작성 후 하루 이상 오르므로 **수집은 이틀 전 날짜까지**만 확정값으로 넣는다. 오늘·어제는 카드뉴스용으로만 조회

### 예상 질문 → 요약에 필요한 항목

| 질문 | 요약 항목 |
|---|---|
| 요즘 IT 쪽 활발해? | 최근 7일 평균 vs 전체 평균, 추세 |
| 제일 뜨거웠던 날은? | max + 날짜 + 그날 헤드라인 |
| 지난주 무슨 일 있었어? | 최근 14일 헤드라인 목록 |
| 이번 달 vs 지난달? | 월별 평균 |

## 4. 기술 스택 (미션 고정 + 추가)

| 영역 | 선택 |
|---|---|
| 백엔드 | FastAPI + Pydantic, uvicorn — Render |
| DB | Firebase Firestore |
| LLM | openai SDK → **COPA 게이트웨이**(`OPENAI_BASE_URL`), `gpt-4o` |
| 프론트 | 바닐라 HTML/CSS/JS — Vercel |
| 추가 | 디스코드 웹훅, GitHub Actions 스케줄 |

COPA 확인(2026-10-14): `/v1/chat/completions` OpenAI 호환, `gpt-4o`·`gpt-5`·`gpt-5-mini`, tools 동작, `reasoning_effort` 미지원.

## 5. 저장소 구조

```
ai-trend-cards/
├── backend/
│   ├── main.py              # 앱, CORS, 라우터 등록, /health
│   ├── db.py                # Firestore 클라이언트 (env 로드 포함, 별도 config.py 없음)
│   ├── schemas.py           # Pydantic 모델
│   ├── routers/             # HTTP 계층: 검증·상태코드만
│   │   ├── data.py
│   │   ├── conversations.py
│   │   ├── chat.py
│   │   └── cards.py
│   ├── services/            # 로직: Firestore·OpenAI·HN 호출
│   │   ├── data_service.py
│   │   ├── summary_service.py
│   │   ├── conversation_service.py
│   │   ├── chat_service.py
│   │   ├── hn_service.py    # HN 수집
│   │   └── card_service.py  # 카드 생성·디스코드 발송
│   ├── scripts/seed.py      # 최근 120일 일괄 적재
│   └── requirements.txt
├── frontend/  index.html · style.css · app.js · vercel.json
├── .github/workflows/daily.yml
└── docs/PLAN.md
```

분리 기준: router는 HTTP만, service는 DB·외부 API만. `/api/chat`과 카드 생성은 `summary_service.build_summary()`를 직접 호출해 재사용한다(자기 서버를 HTTP로 부르지 않음).

## 6. Firestore 컬렉션

### `data/{date}`
```json
{ "date": "2026-10-01", "value": 52, "memo": "FTC is investigating…", "updated_at": "<ts>" }
```
- 문서 ID = 날짜 → 같은 날짜 중복을 DB 키로 차단. POST 중복은 409, PUT은 `value`·`memo`만

### `conversations/{autoId}`
```json
{ "title": "요즘 뭐가 핫해?", "created_at": "<ts>", "updated_at": "<ts>",
  "messages": [ { "role": "user|assistant", "content": "...", "ts": "<iso>" } ] }
```
- 목록은 messages 제외, 불러오기는 (A) `GET /api/conversations/{id}`

### `cards/{date}`
```json
{ "date": "2026-10-14", "items": [ { "title_ko": "...", "summary_ko": "...", "url": "...", "points": 412 } ],
  "posted_to_discord": true, "created_at": "<ts>" }
```
- 날짜당 1개. 같은 날 재발행 요청은 기존 카드 반환(중복 발송 방지)

## 7. API

| 메서드 | 경로 | 비고 |
|---|---|---|
| POST | /api/data | `{date, value, memo?}` → 201 / 409 |
| GET | /api/data | `?start=&end=&limit=` 날짜 내림차순 |
| PUT | /api/data/{date} | `{value?, memo?}` → 200 / 404 |
| DELETE | /api/data/{date} | 204 / 404 |
| GET | /api/data/summary | 요약 JSON |
| POST | /api/conversations | `{title?, messages[]}` → 201 |
| GET | /api/conversations | `[{id, title, updated_at, message_count}]` |
| GET | /api/conversations/{id} | 전체 messages |
| DELETE | /api/conversations/{id} | 204 / 404 |
| POST | /api/chat | `{message, conversation_id?}` → `{conversation_id, reply}` |
| GET | /api/cards/latest | 최신 카드뉴스 |
| POST | /api/cards/publish | 수집+카드 생성+디스코드 발송. `X-Cron-Secret` 헤더 필수 |
| GET | /health | 콜드스타트 깨우기 |

### 요약 예시
```json
{
  "period": "2026-06-10 ~ 2026-10-12", "count": 125,
  "metrics": { "average": 44.2, "max": {"date": "...", "value": 71, "memo": "..."},
               "min": {"date": "...", "value": 22, "memo": "..."}, "latest": {"date": "...", "value": 36} },
  "trend": "상승 (최근 7일 평균이 전체 평균 대비 +12%)",
  "monthly_avg": [{"month": "2026-10", "avg": 41.3}],
  "recent_headlines": [{"date": "...", "memo": "..."}]
}
```
추세: 최근 7일 평균 vs 직전 28일 평균, ±5% 이내면 "유지".

### Pydantic 검증
- `date`: `datetime.date`, 미래 거부 / `value`: `int`, `ge=0`, `le=1000` / `memo`: `max_length=300`, strip
- `message`: 1~1000자

## 8. 채팅 흐름 (컨텍스트 주입)

```
POST /api/chat
 1. summary = build_summary()
 2. system = 템플릿에 요약 삽입
 3. history = 기존 대화 최근 10개
 4. reply = chat.completions.create(gpt-4o, max_tokens=500)
 5. user+assistant를 한 번에 conversations에 저장   ← GPT 실패 시 저장 안 함
 6. return {conversation_id, reply}
```
프롬프트 원칙: 요약에 없는 사실은 지어내지 않기, 헤드라인 인용 시 날짜 함께.

## 9. 카드뉴스·디스코드

```
GitHub Actions (매일 KST 08:00 = UTC 23:00)
  → POST /api/cards/publish  (X-Cron-Secret)
      1. 이틀 전 날짜 화제도를 data에 upsert  ← 시계열이 매일 자라남
      2. 어제 인기 글 상위 5개 조회
      3. GPT로 한국어 제목+2줄 요약 생성 (JSON 응답, 1회 호출)
      4. cards/{오늘} 저장
      5. 디스코드 웹훅으로 임베드 5개 발송
```
- **봇이 아니라 웹훅**: Render 무료 서버는 15분 무요청 시 잠들어 상시 접속 봇이 끊긴다. 웹훅은 POST 한 번
- **GitHub Actions 스케줄**: Render cron은 유료. Actions 요청이 잠든 서버를 깨우는 역할도 겸함(타임아웃 넉넉히, 실패 시 1회 재시도)
- 카드 이미지는 생성하지 않음(COPA 비용). 디스코드 임베드 + 웹 카드 화면
- `X-Cron-Secret` 없으면 401 — 공개 URL에서 아무나 발행·과금 못 하게

## 10. 프론트엔드

데스크톱 3단, 모바일(≤768px) 하단 탭 4개.

| 영역 | 기능 |
|---|---|
| 상단 요약 | 기간·개수·최신 화제도·추세 |
| 오늘의 카드 | 카드 5장 가로 스크롤, 원문 링크 |
| 채팅 | 입력, 말풍선, 로딩, 전송 중 비활성 |
| 데이터 | 추가 폼, 목록, 수정/삭제 |
| 대화 기록 | 목록, 불러오기, 삭제, 새 대화 |

- API 주소: Vercel 빌드 명령으로 `config.js` 생성, 로컬은 `localhost:8000` 폴백
- 콜드스타트: 로드 즉시 `/health`, 3초 무응답이면 "서버 깨우는 중(최대 1분)" 배너
- 렌더링은 `textContent`만(헤드라인·GPT 응답 XSS 방지)

## 11. 환경 변수

| 이름 | 위치 |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Render |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Render |
| `ALLOWED_ORIGINS` | Render |
| `DISCORD_WEBHOOK_URL` | Render |
| `CRON_SECRET` | Render + GitHub Actions secret |
| `API_BASE_URL` | Vercel + GitHub Actions secret |

## 12. 위험과 대응

| 위험 | 대응 |
|---|---|
| COPA 예산 소진 | max_tokens 500, 메시지 1000자, 히스토리 10개, 발행 엔드포인트 시크릿 |
| HN API 장애·형식 변경 | 발행 실패 시 Actions 로그로 확인, 데이터는 그날만 비고 다음날 재수집 시 채움 |
| 점수 미확정 값 저장 | 이틀 전 날짜만 시계열에 확정 |
| CORS | `ALLOWED_ORIGINS`에 Vercel 도메인 정확히 |
| 웹훅 URL 유출 | env에만. 유출 시 디스코드에서 재발급 |

## 13. 진행 순서

| 단계 | 완료 기준 |
|---|---|
| M0 기획·저장소 | ✅ |
| M1 data CRUD + summary + HN 시드 | ✅ 2026-10-14 — 130건(06-05~10-12), 5개 엔드포인트·409/404/422 확인 |
| M2 conversations + chat | ✅ 2026-10-14 — COPA gpt-4o로 요약 반영 답변·이어 대화·자동 저장 확인 |
| M3 cards + 디스코드 | ✅ 2026-10-14 — 원문 og:description 근거 요약, 디스코드 임베드 5장, 같은 날 재호출 시 중복 발송 없음. COPA는 JSON 모드 미지원 → 프롬프트 JSON + 실패 시 원문 제목 폴백 |
| M4 프론트 | ✅ 2026-10-14 — 5개 영역 로컬 동작(CRUD·불러오기·채팅), 390px 모바일 탭, 다크 모드 |
| M5 배포 | ✅ 2026-10-15 — Render(무료, 공개 저장소 URL 연결) https://ai-trend-cards.onrender.com · Vercel(CLI 배포) https://ai-trend-cards.vercel.app · Actions 수동 1회 성공. 둘 다 push 자동 배포 아님 → 수동 재배포. 카드 요약 2~3문장 + 국내 기술 블로그 3편 추가 |
| M6 README·스크린샷 | 미션 항목 전부 |
| M7 보너스 | tools(`get_summary`, `get_data_range`, `get_cards`) + MCP 서버, 화제도 그래프(SVG), CSV 내보내기, 다크 모드 |

## 14. 준비물 (사용자)

- [x] Firebase 프로젝트 → Firestore(서울, 프로덕션 모드) → 서비스 계정 키 JSON
- [x] 디스코드 채널 → 채널 설정 → 연동 → 웹후크 생성 → URL
- [x] Render·Vercel 계정
