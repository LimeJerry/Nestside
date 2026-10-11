from pathlib import Path
from datetime import datetime, timezone
import hashlib
import psycopg

from backend.database import get_connection
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

app = FastAPI()

STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"
STORAGE_DIR.mkdir(exist_ok=True)


@app.get("/")
def root():
    return {"message": "Nestside Server is running"}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):

    # 파일명에서 경로 요소 제거
    filename = Path(file.filename or "").name

    if not filename or filename in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")

    destination = STORAGE_DIR / filename

    # 기존 파일 덮어쓰기 방지
    if destination.exists():
        raise HTTPException(status_code=409, detail="File already exists")

    # SHA-256 계산 준비
    sha256 = hashlib.sha256()
    file_size = 0

    # 파일 저장 및 메타데이터 계산
    try:
        with destination.open("xb") as output:
            while True:
                chunk = await file.read(1024 * 1024)

                if not chunk:
                    break

                output.write(chunk)

                sha256.update(chunk)
                file_size += len(chunk)

    except FileExistsError:
        raise HTTPException(status_code=409, detail="File already exists")

    finally:
        await file.close()

    # 업로드 완료 시간
    uploaded_at = datetime.now(timezone.utc).isoformat()

    # PostgreSQL에 파일 메타데이터 저장
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO files (
                        filename,
                        size,
                        sha256,
                        content_type,
                        uploaded_at
                    )
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        filename,
                        file_size,
                        sha256.hexdigest(),
                        file.content_type,
                        uploaded_at
                    )
                )

    except psycopg.Error:
        # DB 저장 실패 시 업로드한 파일 삭제
        destination.unlink(missing_ok=True)

        raise HTTPException(
            status_code=500,
            detail="Failed to save file metadata"
        )


    return {
        "filename": filename,
        "size": file_size,
        "sha256": sha256.hexdigest(),
        "content_type": file.content_type,
        "uploaded_at": uploaded_at,
        "status": "uploaded"
    }


@app.get("/download/{filename}")
def download_file(filename: str):

    file_path = STORAGE_DIR / filename

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=filename
    )
