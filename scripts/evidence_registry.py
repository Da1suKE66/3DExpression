"""Append or refresh an evidence entry only for an existing project file."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import csv
import hashlib
import threading

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ["evidence_id", "kind", "relative_path", "captured_at", "source", "related_claim", "verification_status", "sha256", "contains_personal_data", "notes"]
LOCK = threading.RLock()

def register(evidence_id, kind, path, source, claim, status, personal="no", notes="", captured_at=None, root=ROOT):
    root = Path(root).resolve()
    path = Path(path).resolve()
    relative = str(path.relative_to(root))
    if not path.is_file():
        raise ValueError("Evidence must exist before registration")
    row = dict(zip(FIELDS, [evidence_id, kind, relative, captured_at or datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds"), source, claim, status, hashlib.sha256(path.read_bytes()).hexdigest(), personal, notes]))
    manifest = root / "evidence/manifest.csv"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with LOCK:
        records = []
        if manifest.exists():
            with manifest.open(encoding="utf-8-sig", newline="") as handle:
                records = list(csv.DictReader(handle))
        prior = next((r for r in records if r["evidence_id"] == evidence_id), None)
        if prior and prior["relative_path"] != relative:
            raise ValueError("Evidence ID already belongs to a different file")
        if prior and prior['sha256'] == row['sha256'] and captured_at is None:
            row["captured_at"] = prior["captured_at"]
        records = [r for r in records if r["evidence_id"] != evidence_id] + [row]
        temp = manifest.with_suffix(".csv.tmp")
        with temp.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(records)
        temp.replace(manifest)
    return row

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--id", required=True)
    parser.add_argument("--kind", required=True, choices=["input", "extraction", "screenshot", "video", "data", "result", "test", "decision", "dependency", "document"])
    parser.add_argument("--source", required=True)
    parser.add_argument("--claim", required=True)
    parser.add_argument("--status", default="pending_review")
    parser.add_argument("--personal", default="unknown", choices=["yes", "no", "unknown"])
    parser.add_argument("--notes", default="")
    args = parser.parse_args()
    row = register(args.id, args.kind, ROOT / args.path, args.source, args.claim, args.status, args.personal, args.notes)
    print(row["evidence_id"], row["relative_path"], row["sha256"])
