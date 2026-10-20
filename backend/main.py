from pathlib import Path
from datetime import datetime, timezone
import hashlib
import os
import uuid
from contextlib import asynccontextmanager

from backend.database import get_connection
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from backend.deletion import delete_stored_file
from backend.file_operations import file_operation

STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"


@asynccontextmanager
async def lifespan(app):
    # Initialization occurs only on server startup, never on test imports.
    STORAGE_DIR.mkdir(exist_ok=True)
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/")
def root():
    return {"message": "Nestside Server is running"}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    filename = Path(file.filename or "").name
    try:
        if not filename or filename in (".", ".."):
            raise HTTPException(status_code=400, detail="Invalid filename")
        with file_operation(STORAGE_DIR, filename) as op:
            if op.fingerprint(filename) is not None:
                raise HTTPException(409, "File already exists")
            record = op.write({"operation_id": str(uuid.uuid4()), "kind": "upload",
                               "phase": "prepared"})
            sha256 = hashlib.sha256()
            file_size = 0
            fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=op.root)
            with os.fdopen(fd, "wb") as output:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                    sha256.update(chunk)
                    file_size += len(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.fsync(op.root)
            fingerprint = op.fingerprint(filename)
            if (fingerprint["size"], fingerprint["sha256"]) != (file_size, sha256.hexdigest()):
                raise HTTPException(409, "Uploaded file changed; recovery required")
            record = op.write(dict(record, phase="commit_pending", fingerprint=fingerprint))
            uploaded_at = datetime.now(timezone.utc).isoformat()
            # On any DB/commit failure keep the file and journal: a missing
            # acknowledgement must never cause deletion of a committed upload.
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO files (filename, size, sha256, content_type, uploaded_at)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (filename, file_size, sha256.hexdigest(), file.content_type, uploaded_at))
            op.clear()
            return {"filename": filename, "size": file_size, "sha256": sha256.hexdigest(),
                    "content_type": file.content_type, "uploaded_at": uploaded_at, "status": "uploaded"}
    except HTTPException:
        raise
    except FileExistsError:
        raise HTTPException(409, "File already exists; recovery may be required") from None
    except Exception:
        raise HTTPException(500, "Upload failed; administrator recovery may be required") from None
    finally:
        await file.close()


@app.get("/download/{filename}")
def download_file(filename: str):

    file_path = STORAGE_DIR / filename

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=filename
    )

@app.get("/files")
def list_files():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, filename, size, sha256,
                       content_type, uploaded_at
                FROM files
                ORDER BY uploaded_at DESC, id DESC
                """
            )

            rows = cur.fetchall()

    return [
        {
            "id": row[0],
            "filename": row[1],
            "size": row[2],
            "sha256": row[3],
            "content_type": row[4],
            "uploaded_at": row[5].isoformat()
        }
        for row in rows
    ]


@app.delete("/files/{file_id}")
def delete_file(file_id: int):
    return delete_stored_file(file_id, STORAGE_DIR, get_connection)
