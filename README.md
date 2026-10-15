# IT 트렌드 카드뉴스 AI 비서

Hacker News 인기 글로 IT 화제도 시계열을 쌓고, 그 요약을 GPT에 주입해 트렌드 질문에 답하며, 매일 아침 한국어 카드뉴스를 웹과 디스코드에 올리는 AI 비서.
코디세이 미션 "8_AI Agent 개발: 나만의 AI 비서 구축" 결과물. 설계·결정 기록은 [docs/PLAN.md](docs/PLAN.md).

## 배포 URL

| 구분 | URL |
|---|---|
| 서비스(프론트, Vercel) | https://ai-trend-cards.vercel.app |
| API(백엔드, Render) | https://ai-trend-cards.onrender.com |
| Swagger 문서 | https://ai-trend-cards.onrender.com/docs |

> Render 무료 플랜이라 15분간 요청이 없으면 서버가 잠듭니다. 첫 접속은 30~60초 걸릴 수 있고, 3초 안에 응답이 없으면 화면 상단에 "무료 서버를 깨우는 중입니다" 안내가 뜨고 자동으로 재시도합니다.

## 서비스 소개

**데이터** — 하루 1행의 시계열 `(date, value, memo)`
- `value` = 그날 작성된 HN 글 중 100점을 넘은 인기 글 수(화제도)
- `memo` = 그날의 트렌드 한 줄. 그날 인기 글 상위 10개 제목을 GPT가 한 문장으로 정의합니다(예: "Cloudflare, Deno 인수"). 1위 글 원제는 `top` 필드에 따로 둡니다.
- 2026-06-05부터 130일 이상 적재. 점수가 굳은 이틀 전 날짜까지만 확정값으로 넣습니다.

**기능**
- **AI 비서 채팅**: 기간·평균·최고/최저·최근 추세·월별 평균·최근 일별 트렌드 요약을 시스템 프롬프트에 넣어 답합니다. 대화는 질문과 답이 한 쌍으로 자동 저장되고, 기록에서 다시 불러와 이어서 대화할 수 있습니다.
- **오늘의 카드뉴스**: 매일 KST 08:00 GitHub Actions가 발행 API를 호출합니다.
  - 어제 HN 인기 글 5개: 원문 소개문과 본문 앞부분을 근거로 한국어 제목과 2~3문장 요약
  - 국내 기업 기술 블로그(토스·카카오·우아한형제들·네이버 D2·LY·당근·여기어때) 최근 7일 새 글 3편
  - 웹 화면과 디스코드 웹훅으로 동시에 게시. 같은 날 다시 호출해도 중복 발송하지 않습니다.
- **트렌드 캘린더(데이터 관리)**: `calendar.html`. 날짜 칸마다 인기 글 수(색 진하기)와 트렌드 한 줄을 보여 줍니다. 날짜를 누르면 아래에 그날 HN 인기 글이 추천 순서대로 카드(한국어 제목·요약) 3열로 나오고, '6개 더 보기'로 그날 인기 글 전부를 볼 수 있습니다. 앞 12장은 미리 만들어 두고, 그 뒤는 처음 볼 때 만들어 저장합니다. 한 줄 추가·수정·삭제가 요약과 AI 답변에 바로 반영됩니다.
- **화면**: 메인은 데스크톱 2단(대화 기록 / 카드+채팅) · 900px 이하 하단 탭, 캘린더는 모바일에서 날짜별 목록. 첫 방문 화면 가이드(메인·캘린더 각각, ? 버튼으로 다시 보기), 다크 모드, 콜드스타트 안내

**보너스**
- **Function Calling**: 채팅 GPT가 도구 3개를 스스로 골라 호출합니다. 답변 아래에 `🔧 get_data_range 조회`처럼 사용한 도구가 표시됩니다.
  - `get_summary`: 전체 요약
  - `get_data_range(start, end)`: 요약에 없는 특정 기간의 일별 값과 트렌드 한 줄
  - `get_cards`: 최신 카드뉴스와 기술 블로그
  - 호출 근거와 흐름은 아래 [도구 호출 흐름](#도구-호출-흐름-function-calling) 참고
- **MCP 서버**(`mcp_server/`): 같은 도구 3개를 Claude Desktop·Claude Code 같은 MCP 클라이언트에 노출합니다(아래 연결 방법).
- **그래프**: 캘린더 페이지에 일별 화제도와 7일 이동평균 SVG 그래프. 마우스·터치로 날짜별 값과 트렌드를 보고, 누르면 그 날짜로 이동합니다.
- **추가 지표**: 7일 이동평균, 월별 평균, 최근 7일 vs 직전 28일 추세
- **내보내기**: 전체 데이터를 CSV(엑셀 한글 BOM 포함)와 JSON으로 내려받습니다.
- **다크 모드**: 우상단 버튼, 선택은 브라우저에 저장됩니다.

## 스크린샷

**① 데이터 요약 + 채팅** — 상단에 기간·개수·평균·최신·추세 요약, 아래에 질문과 요약을 근거로 한 답변

![데이터 요약과 채팅](docs/screenshots/01-chat.png)

**② 데이터 관리(수정)** — 캘린더에서 10월 9일을 눌러 그날 인기 글 카드를 펼치고, 수정 버튼으로 트렌드 한 줄·인기 글 수를 고치는 화면

![트렌드 캘린더 수정](docs/screenshots/02-calendar.png)

**③ 대화 기록 불러오기** — 왼쪽 목록에서 "제일 뜨거웠던 날은 언제야?"를 눌러 이전 대화 4개 메시지를 불러온 화면(선택 항목 강조)

![대화 불러오기](docs/screenshots/03-history.png)

**디스코드 카드뉴스** — 매일 08시 자동 게시

![디스코드](docs/screenshots/04-discord.png)

## 도구 호출 흐름 (Function Calling)

GPT는 매 요청마다 **요약이 들어간 시스템 프롬프트**와 **도구 3개의 정의**를 함께 받고, 요약만으로 답할 수 있는지 스스로 판단합니다. 코드: `backend/services/chat_service.py`의 `TOOLS`, `run_tool`, `chat`.

**어떤 근거로 고르나** — 도구 설명(description)과 시스템 프롬프트 규칙 두 가지입니다.

| 도구 | 도구 설명에 적힌 사용 조건 | 시스템 프롬프트 규칙 |
|---|---|---|
| `get_summary` | 전체 요약(기간·평균·최고/최저·추세·월별 평균·최근 트렌드)을 다시 가져온다 | 요약은 이미 프롬프트에 있어 보통 호출하지 않음 |
| `get_data_range` | 요약에 없는 날짜나 기간을 물으면 사용 (최대 100일) | "요약에 없는 특정 날짜·기간의 값은 get_data_range로 조회" |
| `get_cards` | 오늘 뉴스, 카드, 블로그를 물으면 사용 | "오늘의 카드뉴스·기술 블로그는 get_cards로 조회" |

**배포 서버에서 실제로 확인한 호출** (2026-10-15)

| 질문 | 호출된 도구 | 이유 |
|---|---|---|
| 요즘 IT 쪽 분위기 어때? | 없음 | 최근 추세·최근 일별 트렌드가 요약에 이미 있음 |
| 8월 25일부터 27일까지는 어땠어? | `get_data_range` | 요약의 최근 트렌드는 최근 14일뿐이라 8월 값이 없음 |
| 오늘 카드뉴스 중에 제일 눈에 띄는 거 알려줘 | `get_cards` | 카드뉴스는 요약에 없는 별도 컬렉션 |

**단계**

```mermaid
sequenceDiagram
    participant U as 화면
    participant S as FastAPI /api/chat
    participant G as GPT
    participant F as Firestore
    U->>S: 질문 + conversation_id
    S->>F: data 전체 → 요약 계산
    S->>G: 시스템 프롬프트(요약) + 이전 대화 10개 + 질문 + 도구 3개
    alt 요약으로 충분
        G-->>S: 답변
    else 더 필요한 데이터가 있음
        G-->>S: tool_calls (예: get_data_range 2026-08-25~27)
        S->>F: run_tool → 기간 조회
        S->>G: 도구 결과(role=tool) 추가해 다시 호출
        G-->>S: 답변
    end
    S->>F: 질문+답 한 쌍 저장 (GPT 성공 시에만)
    S-->>U: reply + tools_used → 답변 아래 "🔧 get_data_range 조회"
```

1. 서버가 `data` 전체로 요약을 계산해 시스템 프롬프트에 넣고, 이전 대화 10개·질문·도구 정의와 함께 GPT를 호출합니다.
2. GPT가 `tool_calls`를 돌려주면 서버가 `run_tool`로 실행하고, 결과를 `role: tool` 메시지로 붙여 다시 호출합니다. 잘못된 인자로 실패하면 오류 내용을 그대로 돌려줘 GPT가 고치게 합니다.
3. 왕복은 최대 3회입니다. 마지막 회차는 도구 없이 호출해 반드시 답을 내게 합니다(무한 루프 방지).
4. 호출한 도구 이름을 `tools_used`로 응답에 담아 화면에 표시합니다.
5. MCP 서버(`mcp_server/server.py`)는 같은 이름·인자의 도구를 배포 API로 구현해, Claude 같은 외부 에이전트도 같은 근거로 데이터를 조회할 수 있습니다.

## 기술 스택

| 영역 | 사용 |
|---|---|
| 백엔드 | Python 3.14, FastAPI, Pydantic, Uvicorn |
| DB | Firebase Firestore (`data`, `conversations`, `cards`, `day_cards` 컬렉션) |
| AI | OpenAI SDK + GPT(`gpt-4o`, OpenAI 호환 게이트웨이) |
| 프론트 | 바닐라 HTML/CSS/JS (프레임워크 없음) |
| 데이터 소스 | Hacker News Algolia API, 기술 블로그 RSS/Atom |
| 배포·자동화 | Render(백엔드), Vercel(프론트), GitHub Actions(매일 발행), Discord Webhook |

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/data` | 데이터 목록(날짜 내림차순) |
| POST | `/api/data` | 데이터 추가(같은 날짜면 409) |
| PUT | `/api/data/{date}` | value·memo 수정 |
| DELETE | `/api/data/{date}` | 삭제 |
| GET | `/api/data/summary` | 요약(프롬프트 주입용) |
| POST | `/api/conversations` | 대화 저장 |
| GET | `/api/conversations` | 대화 목록 |
| GET | `/api/conversations/{id}` | 대화 불러오기 |
| DELETE | `/api/conversations/{id}` | 대화 삭제 |
| POST | `/api/chat` | AI 채팅(요약 주입 + 자동 저장) |
| GET | `/api/cards/latest` | 최신 카드뉴스 |
| GET | `/api/cards/days?start&end` | 기간(31일 이내) 날짜별 첫 카드 6장과 전체 수. 캘린더가 한 달 치를 미리 받음 |
| GET | `/api/cards/day/{day}?page=N` | 그날 인기 글 카드를 추천 순 6개씩(`{items, total}`). 처음 조회 때 생성 후 저장, 앞 12장은 미리 생성 |
| POST | `/api/cards/publish` | 오늘 카드 발행(`X-Cron-Secret` 헤더 필요) |
| GET | `/health` | 헬스 체크 |

## 로컬 실행

```bash
git clone https://github.com/IA-hyunbok/ai-trend-cards.git
cd ai-trend-cards
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
# 저장소 루트에 .env 작성(아래 환경변수 표)

# 백엔드 → http://localhost:8000/docs
cd backend
../.venv/bin/uvicorn main:app --port 8000

# 초기 데이터 적재(최근 130일, 처음 한 번)
../.venv/bin/python -m scripts.seed 130

# 프론트 → http://localhost:5500 (다른 터미널)
cd frontend
python3 -m http.server 5500
```

프론트는 `config.js`가 없으면 `http://localhost:8000`을 API 주소로 씁니다. Vercel에서는 빌드 명령이 `API_BASE_URL` 환경변수로 `config.js`를 만듭니다(`frontend/vercel.json`).

## 환경변수

백엔드(`.env` 또는 Render 환경변수):

| 이름 | 설명 |
|---|---|
| `OPENAI_API_KEY` | GPT API 키 |
| `OPENAI_BASE_URL` | OpenAI 호환 게이트웨이 주소(OpenAI 직접 사용 시 생략) |
| `OPENAI_MODEL` | 모델 이름, 기본 `gpt-4o` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase 서비스 계정 키 JSON을 한 줄로 |
| `ALLOWED_ORIGINS` | CORS 허용 출처, 쉼표 구분(예: `https://ai-trend-cards.vercel.app,http://localhost:5500`) |
| `DISCORD_WEBHOOK_URL` | 카드뉴스를 올릴 디스코드 채널 웹훅 |
| `CRON_SECRET` | `/api/cards/publish` 호출용 비밀값 |

프론트(Vercel): `API_BASE_URL` = 백엔드 주소
GitHub Actions 시크릿: `API_BASE_URL`, `CRON_SECRET`

## MCP 서버 연결

배포된 API를 HTTP로 호출하므로 Firebase 키 없이 동작합니다.

```bash
pip install -r mcp_server/requirements.txt
python mcp_server/check.py   # stdio로 띄워 도구 3개 목록·호출 확인
```

Claude Code에 등록:

```bash
claude mcp add ai-trend-cards -- python /절대경로/ai-trend-cards/mcp_server/server.py
```

Claude Desktop(`claude_desktop_config.json`):

```json
{ "mcpServers": { "ai-trend-cards": { "command": "python", "args": ["/절대경로/ai-trend-cards/mcp_server/server.py"] } } }
```

## 자체 점검

```bash
cd backend && ../.venv/bin/python test_summary.py            # 요약·추세 계산
cd backend && ../.venv/bin/python -m services.blog_service   # RSS 날짜 파싱 + 실제 피드 수집
```
