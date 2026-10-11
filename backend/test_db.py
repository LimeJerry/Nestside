import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

# 프로젝트 루트의 .env 파일 읽기
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# PostgreSQL 연결
with psycopg.connect(
    host=os.getenv("DB_HOST"),
    port=os.getenv("DB_PORT"),
    dbname=os.getenv("DB_NAME"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
) as conn:

    # SQL 실행
    with conn.cursor() as cur:
        cur.execute("SELECT current_database(), current_user;")
        result = cur.fetchone()

        print("Database:", result[0])
        print("User:", result[1])
        print("PostgreSQL 연결 성공!")
