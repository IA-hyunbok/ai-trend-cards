import datetime as dt

from fastapi import APIRouter, HTTPException, Query, Response

from schemas import DataCreate, DataItem, DataUpdate, Summary
from services import data_service, summary_service

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/summary", response_model=Summary, summary="데이터 요약(프롬프트 주입용)")
def get_summary():
    return summary_service.build_summary()


@router.get("", response_model=list[DataItem], summary="데이터 목록(날짜 내림차순)")
def list_data(start: dt.date | None = None, end: dt.date | None = None,
              limit: int = Query(200, ge=1, le=1000)):
    return data_service.list_data(start, end, limit)


@router.post("", response_model=DataItem, status_code=201, summary="데이터 추가")
def create_data(body: DataCreate):
    try:
        return data_service.create(body.date, body.value, body.memo)
    except data_service.Duplicate:
        raise HTTPException(409, f"{body.date} 데이터가 이미 있습니다. 수정(PUT)을 쓰세요")


@router.put("/{date}", response_model=DataItem, summary="데이터 수정(value·memo)")
def update_data(date: dt.date, body: DataUpdate):
    try:
        return data_service.update(date, body.model_dump(exclude_none=True))
    except data_service.Missing:
        raise HTTPException(404, f"{date} 데이터가 없습니다")


@router.delete("/{date}", status_code=204, summary="데이터 삭제")
def delete_data(date: dt.date):
    try:
        data_service.delete(date)
    except data_service.Missing:
        raise HTTPException(404, f"{date} 데이터가 없습니다")
    return Response(status_code=204)
