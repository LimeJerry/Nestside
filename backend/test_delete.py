import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from backend import main


async def request(method, path, body=b"", content_type=None):
    """Exercise the real ASGI app without a server or network client."""
    messages = []
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.Event().wait()

    async def send(message):
        messages.append(message)

    headers = [(b"content-length", str(len(body)).encode())]
    if content_type:
        headers.append((b"content-type", content_type.encode()))
    await main.app({"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                    "method": method, "path": path, "raw_path": path.encode(),
                    "query_string": b"", "headers": headers, "scheme": "http",
                    "server": ("test", 80), "client": ("test", 1), "root_path": ""}, receive, send)
    status = next(m["status"] for m in messages if m["type"] == "http.response.start")
    return status, b"".join(m.get("body", b"") for m in messages)


class DeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.storage = Path(self.temp.name) / "storage"
        self.storage.mkdir()
        self.file = self.storage / "sample.txt"
        self.file.write_bytes(b"example")
        self.conn = MagicMock()
        self.conn.__enter__.return_value = self.conn
        self.cursor = self.conn.cursor.return_value.__enter__.return_value
        self.cursor.fetchone.return_value = ("sample.txt", 7, hashlib.sha256(b"example").hexdigest())
        for p in (patch.object(main, "STORAGE_DIR", self.storage),
                  patch.object(main, "get_connection", return_value=self.conn),
                  patch.dict(os.environ, {"NESTSIDE_ENV": "development", "NESTSIDE_ENABLE_DELETE": "true"})):
            p.start()
            self.addCleanup(p.stop)

    def call(self, method="DELETE", path="/files/1", **kwargs):
        return asyncio.run(request(method, path, **kwargs))

    def payloads(self):
        return list(self.storage.glob(".nestside-operations/*/payload"))

    def test_success(self):
        status, body = self.call()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"id": 1, "status": "deleted", "cleanup_pending": False})
        self.assertFalse(self.file.exists())
        self.assertEqual(self.payloads(), [])
        self.conn.commit.assert_called_once()
        self.cursor.execute.assert_any_call("DELETE FROM files WHERE id = %s", (1,))

    def test_disabled_unless_both_flags_match(self):
        for changes in ({"NESTSIDE_ENABLE_DELETE": ""}, {"NESTSIDE_ENV": "production"},
                        {"NESTSIDE_ENV": "", "NESTSIDE_ENABLE_DELETE": ""}):
            with self.subTest(changes=changes), patch.dict(os.environ, changes):
                self.assertEqual(self.call()[0], 403)
        main.get_connection.assert_not_called()
        self.assertTrue(self.file.exists())

    def test_unknown_id(self):
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.call()[0], 404)
        self.assertTrue(self.file.exists())

    def test_invalid_id(self):
        self.assertEqual(self.call(path="/files/not-an-id")[0], 422)

    def test_unsafe_names(self):
        for name in ("../outside", "/etc/passwd", "a/b", "a\\b", ".", "..", "", "x\x00y"):
            with self.subTest(name=name):
                self.cursor.fetchone.return_value = (name,)
                self.assertEqual(self.call()[0], 409)
        self.assertTrue(self.file.exists())

    def test_symlink_and_directory(self):
        outside = Path(self.temp.name) / "outside"
        outside.write_bytes(b"keep")
        (self.storage / "link").symlink_to(outside)
        (self.storage / "directory").mkdir()
        for name in ("link", "directory"):
            self.cursor.fetchone.return_value = (name,)
            self.assertEqual(self.call()[0], 409)
        self.assertEqual(outside.read_bytes(), b"keep")

    def test_missing_file_keeps_metadata(self):
        self.cursor.fetchone.return_value = ("missing",)
        self.assertEqual(self.call()[0], 409)
        self.assertEqual(self.cursor.execute.call_count, 2)

    def test_quarantine_symlink_rejected(self):
        (self.storage / ".delete-quarantine").symlink_to(self.temp.name)
        self.assertEqual(self.call()[0], 500)
        self.assertTrue(self.file.exists())

    def test_delete_error_restores_file(self):
        self.cursor.execute.side_effect = [None, None, RuntimeError("DB failure")]
        self.assertEqual(self.call()[0], 500)
        self.assertEqual(self.file.read_bytes(), b"example")
        self.conn.rollback.assert_called_once()

    def test_commit_failure_retains_recovery_payload(self):
        self.conn.commit.side_effect = RuntimeError("connection lost")
        self.assertEqual(self.call()[0], 500)
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")
        record = self.payloads()[0].with_name("record.json")
        self.assertEqual(json.loads(record.read_text())["file_id"], 1)
        self.assertEqual(json.loads(record.read_text())["phase"], "commit_pending")

    def test_rollback_failure_retains_payload(self):
        self.cursor.execute.side_effect = [None, None, RuntimeError("DB failure")]
        self.conn.rollback.side_effect = RuntimeError("connection lost")
        self.assertEqual(self.call()[0], 500)
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")

    def test_file_replaced_during_move_is_not_deleted(self):
        rename = os.rename
        outside = Path(self.temp.name) / "outside"
        outside.write_bytes(b"keep")

        def replace_then_move(*args, **kwargs):
            self.file.unlink()
            self.file.symlink_to(outside)
            return rename(*args, **kwargs)

        with patch("backend.deletion.os.rename", side_effect=replace_then_move):
            self.assertEqual(self.call()[0], 409)
        self.assertEqual(outside.read_bytes(), b"keep")
        self.assertTrue(self.payloads()[0].is_symlink())
        self.assertEqual(self.cursor.execute.call_count, 2)

    def test_restore_does_not_overwrite_new_file(self):
        def execute(sql, params):
            if sql.startswith("DELETE"):
                self.file.write_bytes(b"new upload")
                raise RuntimeError("DB failure")
        self.cursor.execute.side_effect = execute
        self.assertEqual(self.call()[0], 500)
        self.assertEqual(self.file.read_bytes(), b"new upload")
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")

    def test_cleanup_failure(self):
        with patch("backend.deletion.os.unlink", side_effect=OSError("disk failure")):
            status, body = self.call()
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["cleanup_pending"])
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")

    def test_existing_root_download_and_list(self):
        self.assertEqual(self.call("GET", "/")[0], 200)
        self.assertEqual(self.call("GET", "/download/sample.txt"), (200, b"example"))
        self.assertEqual(self.call("GET", "/download/missing")[0], 404)
        self.cursor.fetchall.return_value = [(1, "sample.txt", 7, "hash", "text/plain", datetime.now(timezone.utc))]
        status, body = self.call("GET", "/files")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)[0]["filename"], "sample.txt")

    def test_existing_upload_and_duplicate(self):
        data = (b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="new.txt"\r\n'
                b'Content-Type: text/plain\r\n\r\nhello\r\n--boundary--\r\n')
        kwargs = {"body": data, "content_type": "multipart/form-data; boundary=boundary"}
        status, body = self.call("POST", "/upload", **kwargs)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["sha256"], hashlib.sha256(b"hello").hexdigest())
        self.assertEqual((self.storage / "new.txt").read_bytes(), b"hello")
        self.assertEqual(self.call("POST", "/upload", **kwargs)[0], 409)


if __name__ == "__main__":
    unittest.main()
