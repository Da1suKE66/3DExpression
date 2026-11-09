"""Download pinned public runtime files; keep the app offline after setup."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib
import json
import subprocess
import shutil
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
MP = "https://unpkg.com/@mediapipe/tasks-vision@0.10.21/"
THREE = "https://unpkg.com/three@0.160.1/"
FILES = [
    (THREE + "build/three.module.js", "app/vendor/three.module.js", "three", "0.160.1"),
    (THREE + "LICENSE", "app/vendor/THREE-LICENSE.txt", "three", "0.160.1"),
    (THREE + "examples/jsm/loaders/GLTFLoader.js", "app/vendor/addons/loaders/GLTFLoader.js", "three", "0.160.1"),
    (THREE + "examples/jsm/utils/BufferGeometryUtils.js", "app/vendor/addons/utils/BufferGeometryUtils.js", "three", "0.160.1"),
    (MP + "vision_bundle.mjs", "app/vendor/vision_bundle.mjs", "@mediapipe/tasks-vision", "0.10.21"),
    *[(MP + "wasm/" + name, "app/vendor/wasm/" + name, "@mediapipe/tasks-vision", "0.10.21")
      for name in ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]],
    ("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", "app/models/face_landmarker.task", "face_landmarker", "float16/1"),
    ("https://www.apache.org/licenses/LICENSE-2.0.txt", "app/vendor/MEDIAPIPE-LICENSE.txt", "mediapipe-license", "Apache-2.0"),
]
lock_path = ROOT / "evidence/dependency_lock.json"
previous = {}
if lock_path.exists():
    previous = {v["path"]: v for v in json.loads(lock_path.read_text())["files"]}
records = []
for url, relative, package, version in FILES:
    dest = ROOT / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    old = previous.get(relative)
    if dest.exists() and old and hashlib.sha256(dest.read_bytes()).hexdigest() == old["sha256"]:
        records.append(old)
        print("Verified", relative, flush=True)
        continue
    partial = dest.with_suffix(dest.suffix + ".partial")
    curl = shutil.which('curl')
    failed = False
    if curl:
        result = subprocess.run([curl, "--fail", "--location", "--silent", "--show-error", "--retry", "2", "--connect-timeout", "15", "--max-time", "120", url, "--output", str(partial)])
        failed = result.returncode != 0
    else:
        try:
            with urlopen(url, timeout=120) as response, partial.open('wb') as handle:
                shutil.copyfileobj(response, handle)
        except OSError:
            failed = True
    if failed:
        partial.unlink(missing_ok=True)
        raise SystemExit(f"Download failed: {relative}. Existing files were preserved.")
    digest = hashlib.sha256(partial.read_bytes()).hexdigest()
    if old and digest != old["sha256"]:
        partial.unlink(missing_ok=True)
        raise SystemExit(f"Checksum changed: {relative}; investigate before replacing pinned runtime.")
    partial.replace(dest)
    records.append({"path": relative, "url": url, "package": package, "version": version,
                    "bytes": dest.stat().st_size, "sha256": digest,
                    "downloaded_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")})
    print("Downloaded", relative, dest.stat().st_size, flush=True)
temporary_lock = lock_path.with_suffix('.json.tmp')
temporary_lock.write_text(json.dumps({"schema_version": 1, "files": records}, ensure_ascii=False, indent=2) + "\n")
temporary_lock.replace(lock_path)
print("All runtime dependencies stored locally.")
