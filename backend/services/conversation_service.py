"""conversations 컬렉션. messages는 문서 안 배열 — 대화 하나를 통째로 읽고 쓰는 접근 패턴이라."""
import datetime as dt

from firebase_admin import firestore
from google.api_core.exceptions import NotFound

from db import db

COL = db.collection("conversations")
LIST_LIMIT = 50


class Missing(Exception):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _stamp(messages: list[dict]) -> list[dict]:
    return [{"role": m["role"], "content": m["content"], "ts": m.get("ts") or _now()} for m in messages]


def create(messages: list[dict], title: str | None = None) -> str:
    ref = COL.document()
    ref.set({
        "title": title or messages[0]["content"][:30],
        "messages": _stamp(messages),
        "message_count": len(messages),
        "created_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP,
    })
    return ref.id


def append(conversation_id: str, messages: list[dict]) -> None:
    try:
        COL.document(conversation_id).update({
            "messages": firestore.ArrayUnion(_stamp(messages)),
            "message_count": firestore.Increment(len(messages)),
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
    except NotFound:
        raise Missing(conversation_id)


def list_meta() -> list[dict]:
    q = (COL.select(["title", "updated_at", "message_count"])
         .order_by("updated_at", direction=firestore.Query.DESCENDING).limit(LIST_LIMIT))
    return [{"id": d.id, **d.to_dict()} for d in q.stream()]


def get(conversation_id: str) -> dict:
    doc = COL.document(conversation_id).get()
    if not doc.exists:
        raise Missing(conversation_id)
    d = doc.to_dict()
    return {"id": doc.id, "title": d["title"], "created_at": d["created_at"],
            "updated_at": d["updated_at"], "messages": d["messages"]}


def delete(conversation_id: str) -> None:
    ref = COL.document(conversation_id)
    if not ref.get().exists:
        raise Missing(conversation_id)
    ref.delete()
