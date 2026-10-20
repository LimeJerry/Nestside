"""격리된 실제 ASGI 앱 + 모의 DB. 운영 DB/실제 storage는 사용하지 않는다."""
import hashlib
import itertools
import os
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend import main

storage = tempfile.TemporaryDirectory(prefix="nestside-web-test-")
main.STORAGE_DIR = Path(storage.name)
rows = []
transport = {"received": 0, "complete": False}


class Cursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, sql, params=None):
        if "INSERT INTO files" in sql:
            filename, size, sha256, content_type, uploaded_at = params
            self.connection.data.append((next(file_ids), filename, size, sha256, content_type, datetime.fromisoformat(uploaded_at)))
            self.connection.dirty = True
        elif sql.startswith("SELECT filename, size, sha256 FROM files WHERE id"):
            row = next((row for row in self.connection.data if row[0] == params[0]), None)
            self.result = (row[1], row[2], row[3]) if row else None
        elif sql.startswith("DELETE FROM files WHERE id"):
            self.connection.data = [row for row in self.connection.data if row[0] != params[0]]
            self.connection.dirty = True
        elif "SELECT id, filename, size, sha256" not in sql:
            raise RuntimeError("테스트용 DB에서 허용하지 않는 SQL")

    def fetchone(self):
        return self.result

    def fetchall(self):
        return sorted(self.connection.data, key=lambda row: (row[5], row[0]), reverse=True)


class Connection:
    def __init__(self):
        self.data = rows.copy()
        self.dirty = False

    def __enter__(self):
        return self

    def __exit__(self, error, *args):
        if error:
            self.rollback()
        else:
            self.commit()

    def commit(self):
        if self.dirty:
            rows[:] = self.data
            self.dirty = False

    def rollback(self):
        self.data = rows.copy()
        self.dirty = False

    def cursor(self):
        return Cursor(self)


file_ids = itertools.count(1)
# 운영 설정과 무관하게 격리 서버의 삭제는 처음에 비활성화한다.
os.environ["NESTSIDE_ENV"] = "development"
os.environ["NESTSIDE_ENABLE_DELETE"] = "false"
main.get_connection = Connection
for name, content in [("시작 안내.txt", b"Nestside fixture only\n"), ("한글 #?%& 공백.txt", b"special filename fixture\n")]:
    (main.STORAGE_DIR / name).write_bytes(content)
    rows.append((next(file_ids), name, len(content), hashlib.sha256(content).hexdigest(), "text/plain", datetime.now(timezone.utc)))


@main.app.get("/__test/transport")
def transport_state():
    return transport


@main.app.post("/__test/reset-transport")
def reset_transport():
    transport.update(received=0, complete=False)
    return transport


@main.app.post("/__test/delete-mode")
def delete_mode(enabled: bool = False):
    # 이 경로는 임시 저장소·모의 DB만 사용하는 테스트 서버에만 존재한다.
    os.environ["NESTSIDE_ENABLE_DELETE"] = "true" if enabled else "false"
    return {"enabled": enabled}


class ObserveBody:
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == "/upload":
            transport.update(received=0, complete=False)

            async def observe():
                event = await receive()
                if event["type"] == "http.request":
                    transport["received"] += len(event.get("body", b""))
                    transport["complete"] = not event.get("more_body", False)
                return event
            await main.app(scope, observe, send)
        else:
            await main.app(scope, receive, send)


if __name__ == "__main__":
    try:
        uvicorn.run(ObserveBody(), host="127.0.0.1", port=18080, log_level="warning")
    finally:
        storage.cleanup()
