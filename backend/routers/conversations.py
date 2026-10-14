from fastapi import APIRouter, HTTPException, Response

from schemas import Conversation, ConversationCreate, ConversationCreated, ConversationMeta
from services import conversation_service

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.post("", response_model=ConversationCreated, status_code=201, summary="대화 저장")
def create_conversation(body: ConversationCreate):
    messages = [m.model_dump(exclude_none=True) for m in body.messages]
    return {"id": conversation_service.create(messages, body.title)}


@router.get("", response_model=list[ConversationMeta], summary="대화 목록(messages 제외, 최근 50개)")
def list_conversations():
    return conversation_service.list_meta()


@router.get("/{conversation_id}", response_model=Conversation, summary="대화 불러오기(전체 messages)")
def get_conversation(conversation_id: str):
    try:
        return conversation_service.get(conversation_id)
    except conversation_service.Missing:
        raise HTTPException(404, "대화를 찾을 수 없습니다")


@router.delete("/{conversation_id}", status_code=204, summary="대화 삭제")
def delete_conversation(conversation_id: str):
    try:
        conversation_service.delete(conversation_id)
    except conversation_service.Missing:
        raise HTTPException(404, "대화를 찾을 수 없습니다")
    return Response(status_code=204)
