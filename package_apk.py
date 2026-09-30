#!/usr/bin/env python3
"""
Navisense APK Packaging & Production Pipeline Wrapper
Executes the authoritative 7-gate production pipeline to validate, bundle, and sign the official release APK.
"""
import sys
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
PIPELINE_SCRIPT = ROOT_DIR / "scripts" / "production_pipeline.py"

if __name__ == "__main__":
    res = subprocess.run([sys.executable, str(PIPELINE_SCRIPT)], cwd=str(ROOT_DIR))
    sys.exit(res.returncode)
