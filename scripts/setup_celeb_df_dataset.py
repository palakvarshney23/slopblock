"""Download, extract, and organize Celeb-DF v2 for CLIP probe training.

Usage:
  python scripts/setup_celeb_df_dataset.py              # extract + organize only
  python scripts/setup_celeb_df_dataset.py --download   # kaggle download first

Expects Kaggle credentials at ~/.kaggle/kaggle.json (or KAGGLE_USERNAME/KAGGLE_KEY).

Layout after running:
  data/raw/celeb-df-v2.zip
  data/raw/celeb-df-v2/          # extracted archive
  data/train/ai/                 # Celeb-synthesis (deepfakes)
  data/train/real/               # Celeb-real + YouTube-real
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
ZIP_PATH = RAW_DIR / "celeb-df-v2.zip"
EXTRACT_DIR = RAW_DIR / "celeb-df-v2"
TRAIN_AI = ROOT / "data" / "train" / "ai"
TRAIN_REAL = ROOT / "data" / "train" / "real"

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

FAKE_DIRS = ("Celeb-synthesis", "celeb-synthesis", "fake", "Fake")
REAL_DIRS = ("Celeb-real", "YouTube-real", "celeb-real", "youtube-real", "real", "Real")


def _run_kaggle_download() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "kaggle", "datasets", "download",
        "reubensuju/celeb-df-v2", "-p", str(RAW_DIR),
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def _find_dataset_root(base: Path) -> Path:
    candidates = [base]
    for child in base.iterdir():
        if child.is_dir():
            candidates.append(child)
    for root in candidates:
        names = {p.name.lower() for p in root.iterdir()} if root.is_dir() else set()
        if any(n in names for n in ("celeb-synthesis", "celeb-real", "youtube-real")):
            return root
    raise FileNotFoundError(f"Could not find Celeb-DF folders under {base}")


def _extract_zip() -> Path:
    if not ZIP_PATH.exists():
        raise FileNotFoundError(f"Missing {ZIP_PATH} — run with --download or place the zip there.")
    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Extracting {ZIP_PATH} → {EXTRACT_DIR} (this may take a while)…")
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        zf.extractall(EXTRACT_DIR)
    return _find_dataset_root(EXTRACT_DIR)


def _link_or_copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    try:
        dest.symlink_to(src.resolve())
    except OSError:
        try:
            dest.hardlink_to(src.resolve())
        except OSError:
            shutil.copy2(src, dest)


def _collect_videos(root: Path, dir_names: tuple[str, ...]) -> list[Path]:
    out: list[Path] = []
    for name in dir_names:
        folder = root / name
        if not folder.is_dir():
            folder = next((p for p in root.rglob(name) if p.is_dir()), None)
        if not folder:
            print(f"warning: folder not found: {name}")
            continue
        for path in folder.rglob("*"):
            if path.is_file() and path.suffix.lower() in VIDEO_EXTS:
                out.append(path)
    return out


def _organize(dataset_root: Path) -> None:
    fake_videos = _collect_videos(dataset_root, FAKE_DIRS)
    real_videos = _collect_videos(dataset_root, REAL_DIRS)
    if not fake_videos:
        raise RuntimeError("No fake videos found — check archive layout.")
    if not real_videos:
        raise RuntimeError("No real videos found — check archive layout.")

    TRAIN_AI.mkdir(parents=True, exist_ok=True)
    TRAIN_REAL.mkdir(parents=True, exist_ok=True)

    for src in fake_videos:
        dest = TRAIN_AI / src.name
        if dest.exists():
            continue
        _link_or_copy(src, dest)

    for src in real_videos:
        dest = TRAIN_REAL / f"{src.parent.name}_{src.name}"
        if dest.exists():
            continue
        _link_or_copy(src, dest)

    ai_count = len(list(TRAIN_AI.glob("*")))
    real_count = len(list(TRAIN_REAL.glob("*")))
    print(f"Organized {ai_count} fake → {TRAIN_AI}")
    print(f"Organized {real_count} real → {TRAIN_REAL}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true", help="Download from Kaggle first (~9.3 GB)")
    parser.add_argument("--skip-extract", action="store_true", help="Use already-extracted data/raw/celeb-df-v2")
    args = parser.parse_args()

    if args.download:
        _run_kaggle_download()

    if args.skip_extract:
        dataset_root = _find_dataset_root(EXTRACT_DIR)
    else:
        dataset_root = _extract_zip()

    _organize(dataset_root)
    print("Done. Train with:")
    print("  python scripts/train_clip_probe/embed_dataset.py")


if __name__ == "__main__":
    main()
