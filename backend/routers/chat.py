import openai
from fastapi import APIRouter, HTTPException

from schemas import ChatRequest, ChatResponse
from services import chat_service, conversation_service

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat", response_model=ChatResponse, summary="AI 채팅(요약 주입 + 대화 자동 저장)")
def chat(body: ChatRequest):
    try:
        return chat_service.chat(body.message, body.conversation_id)
    except conversation_service.Missing:
        raise HTTPException(404, "이어갈 대화를 찾을 수 없습니다")
    except openai.APIError as e:
        raise HTTPException(502, f"AI 응답을 받지 못했습니다: {type(e).__name__}")
