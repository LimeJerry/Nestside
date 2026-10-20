"""Concurrency/crash tests: temporary storage and mocked DB only."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from io import BytesIO

from backend import main
from backend.file_operations import Operation, file_operation
from backend.recovery import recover_file
from backend import test_delete


def crash_worker(storage, phase):
    with file_operation(Path(storage), "sample.txt") as op:
        record = op.write({"operation_id": "crash-test", "kind": "delete", "file_id": 1,
                           "phase": "prepared", "fingerprint": op.fingerprint("sample.txt")})
        if phase != "prepared":
            os.rename("sample.txt", "payload", src_dir_fd=op.root, dst_dir_fd=op.directory)
            os.fsync(op.root)
            os.fsync(op.directory)
            op.write(dict(record, phase=phase))
        os._exit(0)  # No context-manager cleanup; lock is released by the OS.


def lock_worker(storage, ready, release):
    with file_operation(Path(storage), "sample.txt"):
        ready.set()
        release.wait(10)


class StabilityTests(unittest.TestCase):
    setUp = test_delete.DeleteTests.setUp
    call = test_delete.DeleteTests.call
    payloads = test_delete.DeleteTests.payloads

    def upload(self, filename="sample.txt"):
        return asyncio.run(main.upload_file(UploadFile(BytesIO(b"new content"), filename=filename)))

    def journal(self):
        return list(self.storage.glob(".nestside-operations/*/record.json"))[0]

    def existing_rows(self):
        self.cursor.fetchall.return_value = [(1, "sample.txt", 7, hashlib.sha256(b"example").hexdigest())]

    def recover(self):
        return recover_file(self.storage, "sample.txt", main.get_connection)

    def fail_commit(self):
        self.conn.commit.side_effect = RuntimeError("lost acknowledgement")
        self.assertEqual(self.call()[0], 500)
        self.conn.commit.side_effect = None

    def spawn_crash(self, phase):
        process = multiprocessing.get_context("spawn").Process(target=crash_worker, args=(str(self.storage), phase))
        process.start()
        process.join(10)
        if process.is_alive():
            process.terminate()
            process.join()
            self.fail("Crash worker timed out")
        self.assertEqual(process.exitcode, 0)

    def test_delete_in_progress_blocks_same_upload_allows_other_upload(self):
        entered, release = threading.Event(), threading.Event()

        def execute(sql, params):
            if sql.startswith("DELETE"):
                entered.set()
                if not release.wait(5):
                    raise RuntimeError("test timeout")
        self.cursor.execute.side_effect = execute
        with ThreadPoolExecutor() as pool:
            task = pool.submit(self.call)
            try:
                self.assertTrue(entered.wait(5))
                with self.assertRaises(HTTPException) as error:
                    self.upload()
                self.assertEqual(error.exception.status_code, 409)
                self.assertEqual(self.upload("other.txt")["status"], "uploaded")
            finally:
                release.set()
            self.assertEqual(task.result(timeout=5)[0], 200)
        self.assertEqual((self.storage / "other.txt").read_bytes(), b"new content")

    def test_upload_in_progress_blocks_same_delete(self):
        self.cursor.fetchone.return_value = ("incoming.txt", 11, hashlib.sha256(b"new content").hexdigest())
        entered, release = threading.Event(), threading.Event()

        def execute(sql, params):
            if sql.startswith("INSERT"):
                entered.set()
                if not release.wait(5):
                    raise RuntimeError("test timeout")
        self.cursor.execute.side_effect = execute
        with ThreadPoolExecutor() as pool:
            task = pool.submit(self.upload, "incoming.txt")
            try:
                self.assertTrue(entered.wait(5))
                self.assertEqual(self.call()[0], 409)
            finally:
                release.set()
            self.assertEqual(task.result(timeout=5)["status"], "uploaded")
        self.assertEqual((self.storage / "incoming.txt").read_bytes(), b"new content")

    def test_process_lock_is_per_name(self):
        ctx = multiprocessing.get_context("spawn")
        ready, release = ctx.Event(), ctx.Event()
        process = ctx.Process(target=lock_worker, args=(str(self.storage), ready, release))
        process.start()
        try:
            self.assertTrue(ready.wait(10))
            with self.assertRaises(HTTPException):
                with file_operation(self.storage, "sample.txt"):
                    pass
            with file_operation(self.storage, "different.txt"):
                pass
        finally:
            release.set()
            process.join(10)
            if process.is_alive():
                process.terminate()
                process.join()
        self.assertEqual(process.exitcode, 0)

    def test_interrupted_move_restores_after_restart(self):
        self.spawn_crash("moved")
        self.existing_rows()
        self.assertEqual(self.call()[0], 409)
        with self.assertRaises(HTTPException):
            self.upload()
        self.assertEqual(self.recover()["status"], "restored")
        self.assertEqual(self.file.read_bytes(), b"example")
        self.assertFalse(self.journal_exists())

    def journal_exists(self):
        return bool(list(self.storage.glob(".nestside-operations/*/record.json")))

    def test_prepared_crash_preserves_original(self):
        self.spawn_crash("prepared")
        self.existing_rows()
        self.assertEqual(self.recover()["status"], "restored")
        self.assertEqual(self.file.read_bytes(), b"example")

    def test_commit_pending_crash_with_deleted_row_finishes(self):
        self.spawn_crash("commit_pending")
        self.cursor.fetchall.return_value = []
        self.assertEqual(self.recover()["status"], "deletion_completed")
        self.assertFalse(self.file.exists())
        self.assertEqual(self.payloads(), [])

    def test_move_failure_is_recoverable(self):
        with patch("backend.deletion.os.rename", side_effect=OSError("rename failed")):
            self.assertEqual(self.call()[0], 500)
        self.assertEqual(self.file.read_bytes(), b"example")
        self.assertEqual(self.call()[0], 409)
        self.existing_rows()
        self.assertEqual(self.recover()["status"], "restored")

    def test_recovery_link_failure_keeps_record_and_payload(self):
        self.fail_commit()
        self.existing_rows()
        with patch("backend.file_operations.os.link", side_effect=OSError("disk error")):
            with self.assertRaises(OSError):
                self.recover()
        self.assertTrue(self.journal_exists())
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")
        self.assertEqual(self.recover()["status"], "restored")

    def test_recovery_conflict_preserves_both_files(self):
        self.fail_commit()
        self.file.write_bytes(b"unrelated")
        self.existing_rows()
        with self.assertRaises(ValueError):
            self.recover()
        self.assertEqual(self.file.read_bytes(), b"unrelated")
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")
        self.assertTrue(self.journal_exists())

    def test_recovery_metadata_conflict_preserves_payload(self):
        self.fail_commit()
        self.cursor.fetchall.return_value = [(2, "sample.txt", 7, "different")]
        with self.assertRaises(ValueError):
            self.recover()
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")

    def test_recovery_db_error_preserves_payload(self):
        self.fail_commit()
        self.cursor.execute.side_effect = RuntimeError("database down")
        with self.assertRaises(RuntimeError):
            self.recover()
        self.assertTrue(self.journal_exists())
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")

    def test_corrupt_record_blocks_all_mutations(self):
        self.fail_commit()
        self.journal().write_text("invalid json")
        self.assertEqual(self.call()[0], 500)
        with self.assertRaises(HTTPException):
            self.upload()
        with self.assertRaises(ValueError):
            self.recover()
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")

    def test_record_update_failure_after_move_preserves_old_journal(self):
        write = Operation.write

        def fail_moved(op, record):
            if record["phase"] == "moved":
                raise OSError("journal failure")
            return write(op, record)
        with patch.object(Operation, "write", fail_moved):
            self.assertEqual(self.call()[0], 500)
        self.assertEqual(json.loads(self.journal().read_text())["phase"], "prepared")
        self.existing_rows()
        self.assertEqual(self.recover()["status"], "restored")

    def test_upload_db_error_keeps_file_and_blocks_reuse(self):
        self.cursor.execute.side_effect = RuntimeError("DB unavailable")
        with self.assertRaises(HTTPException):
            self.upload("new.txt")
        self.assertEqual((self.storage / "new.txt").read_bytes(), b"new content")
        self.cursor.execute.side_effect = None
        self.cursor.fetchall.return_value = []
        with self.assertRaises(ValueError):
            recover_file(self.storage, "new.txt", main.get_connection)
        self.assertEqual((self.storage / "new.txt").read_bytes(), b"new content")

    def test_committed_upload_can_be_confirmed(self):
        with patch.object(Operation, "clear", side_effect=OSError("journal cleanup failed")):
            with self.assertRaises(HTTPException):
                self.upload("new.txt")
        self.cursor.fetchall.return_value = [(2, "new.txt", 11, hashlib.sha256(b"new content").hexdigest())]
        self.assertEqual(recover_file(self.storage, "new.txt", main.get_connection)["status"], "upload_confirmed")
        self.assertEqual((self.storage / "new.txt").read_bytes(), b"new content")

    def test_changed_content_does_not_match_db(self):
        self.file.write_bytes(b"changed")
        self.assertEqual(self.call()[0], 409)
        self.assertEqual(self.file.read_bytes(), b"changed")

    def test_recovery_changed_payload_is_preserved(self):
        self.fail_commit()
        self.payloads()[0].write_bytes(b"changed")
        self.cursor.fetchall.return_value = []
        with self.assertRaises(ValueError):
            self.recover()
        self.assertEqual(self.payloads()[0].read_bytes(), b"changed")

    def test_internal_names_are_reserved(self):
        for name in (".nestside-operations", ".delete-quarantine"):
            with self.assertRaises(HTTPException) as error:
                self.upload(name)
            self.assertEqual(error.exception.status_code, 409)

    def test_control_directory_symlink_is_rejected(self):
        (self.storage / ".nestside-operations").symlink_to(self.temp.name)
        self.assertEqual(self.call()[0], 500)
        self.assertEqual(self.file.read_bytes(), b"example")

    def test_pending_legacy_record_is_not_ignored(self):
        legacy = self.storage / ".delete-quarantine" / "old-operation"
        legacy.mkdir(parents=True)
        (legacy / "record.json").write_text('{"filename":"sample.txt"}')
        self.assertEqual(self.call()[0], 409)
        self.assertEqual(self.file.read_bytes(), b"example")

    def test_legacy_record_for_other_name_does_not_block(self):
        legacy = self.storage / ".delete-quarantine" / "old-operation"
        legacy.mkdir(parents=True)
        (legacy / "record.json").write_text('{"filename":"another.txt"}')
        self.assertEqual(self.call()[0], 200)

    def test_directory_sync_failure_after_move_is_recoverable(self):
        rename = os.rename
        sync = os.fsync
        moved = False

        def mark_moved(*args, **kwargs):
            nonlocal moved
            rename(*args, **kwargs)
            moved = True

        def fail_after_move(fd):
            if moved:
                raise OSError("sync failed")
            sync(fd)

        with patch("backend.deletion.os.rename", side_effect=mark_moved), patch("os.fsync", side_effect=fail_after_move):
            self.assertEqual(self.call()[0], 500)
        self.assertTrue(self.journal_exists())
        self.existing_rows()
        self.assertEqual(self.recover()["status"], "restored")

    def test_restore_cleanup_failure_can_be_retried(self):
        self.fail_commit()
        self.existing_rows()
        with patch("backend.file_operations.os.unlink", side_effect=OSError("cleanup failed")):
            with self.assertRaises(OSError):
                self.recover()
        self.assertEqual(self.file.read_bytes(), b"example")
        self.assertEqual(self.payloads()[0].read_bytes(), b"example")
        self.assertTrue(self.journal_exists())
        self.assertEqual(self.recover()["status"], "restored")
        self.assertEqual(self.payloads(), [])

    def test_incomplete_upload_preserves_file_for_administrator(self):
        with file_operation(self.storage, "partial.txt") as op:
            op.write({"operation_id": "interrupted-upload", "kind": "upload", "phase": "prepared"})
            (self.storage / "partial.txt").write_bytes(b"partial")
        with self.assertRaises(ValueError):
            recover_file(self.storage, "partial.txt", main.get_connection)
        with self.assertRaises(HTTPException):
            self.upload("partial.txt")
        self.assertEqual((self.storage / "partial.txt").read_bytes(), b"partial")


if __name__ == "__main__":
    unittest.main()
