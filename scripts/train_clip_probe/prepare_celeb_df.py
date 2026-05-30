"""Extract Celeb-DF v2 from Kaggle zip into data/train/{ai,real}."""

from __future__ import annotations

import argparse
import os
import shutil
import zipfile
from pathlib import Path

VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi"}


def _link_or_copy(src: Path, dst: Path, mode: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        return
    if mode == "symlink":
        dst.symlink_to(src.resolve())
    elif mode == "hardlink":
        os.link(src, dst)
    elif mode == "move":
        shutil.move(src, dst)
    else:
        shutil.copy2(src, dst)


def _collect_videos(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTS]


def prepare(zip_path: Path, data_root: Path, mode: str = "hardlink") -> None:
    extract_dir = data_root.parent / "_celeb_df_raw"
    if not extract_dir.exists():
        extract_dir.mkdir(parents=True, exist_ok=True)
        print(f"Extracting {zip_path} -> {extract_dir} (this may take a while)...")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)
    else:
        print(f"Using existing extract at {extract_dir}")

    ai_dir = data_root / "ai"
    real_dir = data_root / "real"
    ai_dir.mkdir(parents=True, exist_ok=True)
    real_dir.mkdir(parents=True, exist_ok=True)

    fake_roots = list(extract_dir.rglob("Celeb-synthesis"))
    real_roots = list(extract_dir.rglob("Celeb-real")) + list(extract_dir.rglob("YouTube-real"))
    if not fake_roots:
        raise SystemExit(f"Could not find Celeb-synthesis under {extract_dir}")
    if not real_roots:
        raise SystemExit(f"Could not find Celeb-real/YouTube-real under {extract_dir}")

    fake_count = 0
    for root in fake_roots:
        for video in _collect_videos(root):
            dst = ai_dir / video.name
            _link_or_copy(video, dst, mode)
            fake_count += 1

    real_count = 0
    for root in real_roots:
        for video in _collect_videos(root):
            dst = real_dir / f"{root.name}_{video.name}"
            _link_or_copy(video, dst, mode)
            real_count += 1

    print(f"Prepared {fake_count} fake -> {ai_dir}")
    print(f"Prepared {real_count} real -> {real_dir}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--zip",
        type=Path,
        default=Path("data/_downloads/celeb-df-v2.zip"),
        help="Path to kaggle celeb-df-v2.zip",
    )
    parser.add_argument("--data-root", type=Path, default=Path("data/train"))
    parser.add_argument(
        "--mode",
        choices=("hardlink", "move", "copy", "symlink"),
        default="hardlink",
        help="How to populate train dirs (default: hardlink, no extra disk use)",
    )
    args = parser.parse_args()
    if not args.zip.is_file():
        raise SystemExit(f"Missing zip: {args.zip}")
    prepare(args.zip, args.data_root, mode=args.mode)


if __name__ == "__main__":
    main()
