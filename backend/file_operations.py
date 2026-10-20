"""Linux per-name locks and crash-durable journals. No database access on import."""
import fcntl
import hashlib
import json
import os
import stat
import uuid
from contextlib import contextmanager

from fastapi import HTTPException


DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def validate_name(name):
    if (not isinstance(name, str) or not name or name in (".", "..")
            or name.startswith(".nestside-") or name == ".delete-quarantine"
            or any(c in name for c in ("/", "\\", "\x00"))):
        raise HTTPException(409, "Unsafe stored filename")


def child_directory(parent, name):
    try:
        os.mkdir(name, mode=0o700, dir_fd=parent)
    except FileExistsError:
        pass
    # Another process may have just created this directory and died before
    # syncing it. Persist the parent even when mkdir reports EEXIST.
    os.fsync(parent)
    return os.open(name, DIRECTORY, dir_fd=parent)


class Operation:
    def __init__(self, root, directory, name):
        self.root, self.directory, self.name = root, directory, name

    def read(self):
        try:
            fd = os.open("record.json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.directory)
        except FileNotFoundError:
            return None
        with os.fdopen(fd) as stream:
            record = json.load(stream)
        if record.get("filename") != self.name or record.get("version") != 1:
            raise ValueError("Invalid journal; administrator review required")
        return record

    def write(self, record):
        record = dict(record, version=1, filename=self.name)
        temporary = "record-" + str(uuid.uuid4())
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=self.directory)
        with os.fdopen(fd, "w") as stream:
            json.dump(record, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, "record.json", src_dir_fd=self.directory, dst_dir_fd=self.directory)
        os.fsync(self.directory)
        return record

    def clear(self):
        os.unlink("record.json", dir_fd=self.directory)
        os.fsync(self.directory)

    def fingerprint(self, name, *, payload=False):
        parent = self.directory if payload else self.root
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        except FileNotFoundError:
            return None
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("Not a regular file")
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
            after = os.fstat(stream.fileno())
            if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ValueError("File changed during verification")
            return {"dev": after.st_dev, "ino": after.st_ino, "size": after.st_size, "sha256": digest}

    def restore(self, record):
        expected = record["fingerprint"]
        payload = self.fingerprint("payload", payload=True)
        original = self.fingerprint(self.name)
        if original is not None and original != expected:
            raise ValueError("Original path occupied; administrator review required")
        if payload is not None and payload != expected:
            raise ValueError("Payload changed; administrator review required")
        if original is None:
            if payload is None:
                raise ValueError("Both files missing; administrator review required")
            os.link("payload", self.name, src_dir_fd=self.directory, dst_dir_fd=self.root,
                    follow_symlinks=False)  # EEXIST preserves any new file.
        # Also sync an existing restored link before removing the payload.
        os.fsync(self.root)
        if payload is not None:
            os.unlink("payload", dir_fd=self.directory)
            os.fsync(self.directory)
        self.clear()

    def finish_delete(self, record):
        if self.fingerprint(self.name) is not None:
            raise ValueError("Original path occupied; administrator review required")
        payload = self.fingerprint("payload", payload=True)
        if payload is not None:
            if payload != record["fingerprint"]:
                raise ValueError("Payload changed; administrator review required")
            os.unlink("payload", dir_fd=self.directory)
            os.fsync(self.directory)
        self.clear()


@contextmanager
def file_operation(storage, name, *, recovery=False):
    validate_name(name)
    fds = []
    try:
        root = os.open(storage, DIRECTORY)
        fds.append(root)
        control = child_directory(root, ".nestside-operations")
        fds.append(control)
        directory = child_directory(control, hashlib.sha256(name.encode()).hexdigest())
        fds.append(directory)
        lock = os.open("lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        fds.append(lock)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise HTTPException(409, "Another operation is using this filename")
        operation = Operation(root, directory, name)
        # Old-version quarantine needs manual migration; never silently ignore it.
        try:
            legacy = os.open(".delete-quarantine", DIRECTORY, dir_fd=root)
        except FileNotFoundError:
            pass
        else:
            try:
                for entry in os.listdir(legacy):
                    old = os.open(entry, DIRECTORY, dir_fd=legacy)
                    try:
                        fd = os.open("record.json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=old)
                        with os.fdopen(fd) as stream:
                            old_record = json.load(stream)
                        if old_record["filename"] == name:
                            raise HTTPException(409, "Legacy recovery record requires administrator review")
                    finally:
                        os.close(old)
            finally:
                os.close(legacy)
        if not recovery and (operation.read() is not None or "payload" in os.listdir(directory)):
            raise HTTPException(409, "Recovery required; contact administrator")
        yield operation
    finally:
        for fd in reversed(fds):
            os.close(fd)
