"""Explicit, conservative recovery. Importing this module never connects to DB."""
import argparse
import json
import os
from pathlib import Path

from backend.file_operations import file_operation


def recover_file(storage, filename, connect):
    """Reconcile one name under the same lock as upload/delete; never overwrite.

    Raises on ambiguity and leaves records/files for administrator inspection.
    Does not issue any INSERT/UPDATE/DELETE against the database.
    """
    with file_operation(storage, filename, recovery=True) as op:
        record = op.read()
        if record is None:
            if "payload" in os.listdir(op.directory):
                raise ValueError("Unjournaled payload; administrator review required")
            return {"status": "nothing_to_recover"}
        if record.get("kind") not in ("delete", "upload") or "fingerprint" not in record:
            raise ValueError("Incomplete journal; administrator review required")
        expected = record["fingerprint"]
        with connect() as conn:
            with conn.cursor() as cur:
                if record["kind"] == "delete":
                    cur.execute("SELECT id, filename, size, sha256 FROM files WHERE filename = %s OR id = %s FOR UPDATE",
                                (filename, record["file_id"]))
                else:
                    cur.execute("SELECT id, filename, size, sha256 FROM files WHERE filename = %s FOR UPDATE", (filename,))
                rows = cur.fetchall()
                if record["kind"] == "upload":
                    if (len(rows) != 1 or tuple(rows[0][1:]) != (filename, expected["size"], expected["sha256"])
                            or op.fingerprint(filename) != expected):
                        raise ValueError("Upload outcome uncertain; administrator review required")
                    # A missing row might be an in-flight commit. Never remove
                    # this file or its journal automatically in that situation.
                    action = "upload_confirmed"
                elif rows:
                    if (len(rows) != 1 or tuple(rows[0]) != (record["file_id"], filename, expected["size"], expected["sha256"])):
                        raise ValueError("Metadata conflict; administrator review required")
                    op.restore(record)
                    action = "restored"
                else:
                    # Run explicit recovery only after old server processes and
                    # their DB sessions have ended (see README).
                    op.finish_delete(record)
                    action = "deletion_completed"
            if action == "upload_confirmed":
                op.clear()
        return {"status": action}


def main():
    parser = argparse.ArgumentParser(description="Inspect or explicitly reconcile a Nestside operation")
    parser.add_argument("--storage", type=Path, required=True)
    parser.add_argument("--filename", required=True)
    parser.add_argument("--apply", action="store_true", help="Reconcile after stopping the server and terminating old DB sessions")
    args = parser.parse_args()
    try:
        if args.apply:
            from backend.database import get_connection
            result = recover_file(args.storage, args.filename, get_connection)
        else:
            with file_operation(args.storage, args.filename, recovery=True) as op:
                result = {"record": op.read(), "apply": False}
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        parser.exit(1, "Recovery blocked: preserve files and ask the administrator to inspect the operation.\n")


if __name__ == "__main__":
    main()
