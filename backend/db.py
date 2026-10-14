"""Firestore 클라이언트. 서비스 계정 JSON은 환경변수 FIREBASE_SERVICE_ACCOUNT_JSON에서만 읽는다."""
import json
import os

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore

load_dotenv()

if not firebase_admin._apps:
    firebase_admin.initialize_app(
        credentials.Certificate(json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"]))
    )

db = firestore.client()
