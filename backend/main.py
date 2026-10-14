import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv()

from routers import cards, chat, conversations, data  # noqa: E402  chat_service가 import 시 env를 읽는다
log = logging.getLogger("uvicorn.error")

app = FastAPI(title="IT 트렌드 카드 API", description="HN 인기 글 기반 IT 화제도 시계열 + AI 비서")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(conversations.router)
app.include_router(chat.router)
app.include_router(cards.router)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "서버 오류가 발생했습니다"})


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}
