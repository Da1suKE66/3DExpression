"""Use task-local optional libraries without modifying managed dependencies."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
LOCAL_LIBRARIES = ROOT / '.analysis_deps'
if LOCAL_LIBRARIES.is_dir():
    sys.path.insert(0, str(LOCAL_LIBRARIES))
