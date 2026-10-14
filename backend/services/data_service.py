"""data 컬렉션 CRUD. 문서 ID = 날짜(YYYY-MM-DD)라 같은 날짜 중복은 DB 키가 막는다."""
import datetime as dt

from firebase_admin import firestore
from google.api_core.exceptions import AlreadyExists, NotFound
from google.cloud.firestore_v1.base_query import FieldFilter

from db import db

COL = db.collection("data")


class Duplicate(Exception):
    pass


class Missing(Exception):
    pass


def _row(doc) -> dict:
    d = doc.to_dict()
    return {"date": d["date"], "value": d["value"], "memo": d.get("memo", "")}


def list_data(start: dt.date | None = None, end: dt.date | None = None, limit: int = 200) -> list[dict]:
    q = COL
    if start:
        q = q.where(filter=FieldFilter("date", ">=", start.isoformat()))
    if end:
        q = q.where(filter=FieldFilter("date", "<=", end.isoformat()))
    q = q.order_by("date", direction=firestore.Query.DESCENDING).limit(limit)
    return [_row(d) for d in q.stream()]


def all_rows() -> list[dict]:
    """요약 계산용 전체 행, 날짜 오름차순."""
    return [_row(d) for d in COL.order_by("date").stream()]


def create(date: dt.date, value: int, memo: str) -> dict:
    row = {"date": date.isoformat(), "value": value, "memo": memo}
    try:
        COL.document(row["date"]).create({**row, "updated_at": firestore.SERVER_TIMESTAMP})
    except AlreadyExists:
        raise Duplicate(row["date"])
    return row


def update(date: dt.date, fields: dict) -> dict:
    ref = COL.document(date.isoformat())
    try:
        ref.update({**fields, "updated_at": firestore.SERVER_TIMESTAMP})
    except NotFound:
        raise Missing(date.isoformat())
    return _row(ref.get())


def delete(date: dt.date) -> None:
    ref = COL.document(date.isoformat())
    if not ref.get().exists:
        raise Missing(date.isoformat())
    ref.delete()


def upsert_many(rows: list[dict]) -> None:
    """시드·일일 수집용. 같은 날짜는 덮어쓴다."""
    for i in range(0, len(rows), 400):  # Firestore 배치 한도 500
        batch = db.batch()
        for r in rows[i:i + 400]:
            batch.set(COL.document(r["date"]), {**r, "updated_at": firestore.SERVER_TIMESTAMP})
        batch.commit()
