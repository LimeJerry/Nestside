"""Development-only deletion, coordinated with uploads and explicit recovery."""
import os
import uuid

from fastapi import HTTPException
from backend.file_operations import file_operation


def verified_fingerprint(op, name, *, payload=False):
    try:
        return op.fingerprint(name, payload=payload)
    except (OSError, ValueError):
        raise HTTPException(409, "Unsafe or changed file; administrator review required") from None


def delete_stored_file(file_id, storage, connect):
    if (os.getenv("NESTSIDE_ENV") != "development"
            or os.getenv("NESTSIDE_ENABLE_DELETE") != "true"):
        raise HTTPException(403, "File deletion is disabled")
    try:
        # Discover the lock key without retaining a DB row lock. All mutating
        # operations acquire the filename lock before their transaction locks.
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT filename, size, sha256 FROM files WHERE id = %s", (file_id,))
                row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "File metadata not found")
        name = row[0]
        with file_operation(storage, name) as op:
            with connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT filename, size, sha256 FROM files WHERE id = %s FOR UPDATE", (file_id,))
                    current = cur.fetchone()
                    if current is None:
                        raise HTTPException(404, "File metadata not found")
                    if current != row:
                        raise HTTPException(409, "Metadata changed; retry required")
                    fingerprint = verified_fingerprint(op, name)
                    if fingerprint is None:
                        raise HTTPException(409, "Stored file is missing")
                    if (fingerprint["size"], fingerprint["sha256"]) != (row[1], row[2]):
                        raise HTTPException(409, "File does not match metadata")
                    record = op.write({"operation_id": str(uuid.uuid4()), "kind": "delete",
                                       "file_id": file_id, "phase": "prepared", "fingerprint": fingerprint})
                    os.rename(name, "payload", src_dir_fd=op.root, dst_dir_fd=op.directory)
                    os.fsync(op.root)
                    os.fsync(op.directory)
                    if verified_fingerprint(op, "payload", payload=True) != fingerprint:
                        raise HTTPException(409, "File changed; administrator recovery required")
                    record = op.write(dict(record, phase="moved"))
                    try:
                        cur.execute("DELETE FROM files WHERE id = %s", (file_id,))
                    except Exception:
                        conn.rollback()
                        op.restore(record)
                        raise
                # Persist intent before commit. A lost acknowledgement leaves a
                # journal that blocks reuse of this name until DB reconciliation.
                record = op.write(dict(record, phase="commit_pending"))
                conn.commit()
            try:
                record = op.write(dict(record, phase="committed"))
                op.finish_delete(record)
            except (OSError, ValueError):
                return {"id": file_id, "status": "deleted", "cleanup_pending": True}
            return {"id": file_id, "status": "deleted", "cleanup_pending": False}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(500, "Deletion failed; administrator recovery may be required") from None
