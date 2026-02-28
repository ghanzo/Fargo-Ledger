"""
Folder watcher: monitors data/inbox/{AccountName}/ for new CSV files,
imports them using the shared import_csv_content() logic, then moves
the file to a processed/ subfolder with a timestamp prefix.
"""
import logging
import os
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from src.database import SessionLocal
from src.models import Account
from src.importer import import_csv_content

logger = logging.getLogger("watcher")

INBOX_DIR = Path("/app/data/inbox")
STABILITY_DELAY = 2  # seconds to wait for file write to finish


class ImportLog:
    """Thread-safe ring buffer for recent import results."""

    def __init__(self, max_entries: int = 50):
        self._entries: list[dict] = []
        self._max = max_entries
        self._lock = threading.Lock()

    def add(self, entry: dict):
        with self._lock:
            self._entries.append(entry)
            if len(self._entries) > self._max:
                self._entries = self._entries[-self._max:]

    def recent(self, n: int = 20) -> list[dict]:
        with self._lock:
            return list(reversed(self._entries[-n:]))


import_log = ImportLog()


def _wait_for_stable(path: Path, delay: float = STABILITY_DELAY):
    """Wait until the file size stops changing."""
    prev_size = -1
    while True:
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size == prev_size and size > 0:
            return True
        prev_size = size
        time.sleep(delay)


def _process_csv(file_path: Path):
    """Import a single CSV file that appeared in an account inbox subfolder."""
    account_name = file_path.parent.name
    filename = file_path.name

    logger.info("New CSV detected: %s (account=%s)", filename, account_name)

    db = SessionLocal()
    try:
        # Case-insensitive account lookup
        account = db.query(Account).filter(
            Account.name.ilike(account_name)
        ).first()

        if not account:
            msg = f"No account matching folder name '{account_name}' — skipping {filename}"
            logger.warning(msg)
            import_log.add({
                "timestamp": datetime.now().isoformat(),
                "file": filename,
                "account": account_name,
                "status": "skipped",
                "detail": msg,
            })
            return

        content = file_path.read_bytes()
        result = import_csv_content(content, filename, db, account.id)

        # Move to processed/ subfolder
        processed_dir = file_path.parent / "processed"
        processed_dir.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = processed_dir / f"{ts}_{filename}"
        shutil.move(str(file_path), str(dest))

        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "file": filename,
            "account": account_name,
            "account_id": account.id,
            "status": "success",
            "imported": result["imported"],
            "skipped": result["skipped"],
            "suggestions_created": result.get("suggestions_created", 0),
        }
        import_log.add(log_entry)
        logger.info(
            "Imported %s: %d new, %d skipped, %d suggestions created",
            filename, result["imported"], result["skipped"], result.get("suggestions_created", 0),
        )

    except Exception as e:
        logger.exception("Failed to import %s: %s", filename, e)
        import_log.add({
            "timestamp": datetime.now().isoformat(),
            "file": filename,
            "account": account_name,
            "status": "error",
            "detail": str(e),
        })
    finally:
        db.close()


class InboxHandler(FileSystemEventHandler):
    """React to new .csv files dropped into account subfolders."""

    def on_created(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() != ".csv":
            return
        # Only process files one level deep: inbox/{AccountName}/file.csv
        # Skip files inside processed/ subfolders
        if path.parent.name.lower() == "processed":
            return
        if path.parent == INBOX_DIR:
            logger.warning("CSV found directly in inbox root (not in account subfolder) — skipping: %s", path.name)
            return

        # Wait for file write to complete, then process
        threading.Thread(
            target=self._handle_file,
            args=(path,),
            daemon=True,
        ).start()

    def _handle_file(self, path: Path):
        if _wait_for_stable(path):
            _process_csv(path)


_observer: Observer | None = None
_running = False


def start_watcher():
    """Start the folder watcher in a background thread. Safe to call multiple times."""
    global _observer, _running

    if _running:
        return

    INBOX_DIR.mkdir(parents=True, exist_ok=True)

    _observer = Observer()
    _observer.schedule(InboxHandler(), str(INBOX_DIR), recursive=True)
    _observer.daemon = True
    _observer.start()
    _running = True
    logger.info("Inbox watcher started — monitoring %s", INBOX_DIR)


def stop_watcher():
    """Stop the folder watcher gracefully."""
    global _observer, _running

    if _observer and _running:
        _observer.stop()
        _observer.join(timeout=5)
        _running = False
        logger.info("Inbox watcher stopped")


def get_status() -> dict:
    """Return watcher state for the /watcher/status endpoint."""
    return {
        "running": _running,
        "inbox_dir": str(INBOX_DIR),
        "recent_imports": import_log.recent(5),
    }


def get_log(limit: int = 20) -> list[dict]:
    """Return recent import log entries."""
    return import_log.recent(limit)
