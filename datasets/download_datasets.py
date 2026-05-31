"""
Robust Dataset Downloader for SlopProx Training
=================================================
Tries multiple HuggingFace sources, downloads subsets,
and organizes into data/real/ and data/fake/ folders.

Usage:
    python datasets/download_datasets.py --max-videos 2000
    python datasets/download_datasets.py --sources angads24,Sarim-Hash --max-videos 500
"""

import os
import argparse
import json
import sys
import random
from pathlib import Path
from tqdm import tqdm

try:
    from huggingface_hub import snapshot_download, hf_hub_download, list_repo_files
except ImportError:
    print("huggingface_hub not installed. Run: pip install huggingface_hub")
    sys.exit(1)

DATA_ROOT = Path("data")

# Sources that have been verified to work without auth
KNOWN_SOURCES = {
    "Sarim-Hash": {
        "repo_id": "Sarim-Hash/video_DEEPFAKE_dataset",
        "real_pattern": "real_video/**/*",
        "fake_pattern": "fake_video/**/*",
        "video_exts": [".mp4", ".avi", ".mov", ".mkv"],
    },
    "angads24": {
        "repo_id": "angads24/deepfake-video",
        "real_pattern": "real/**/*",
        "fake_pattern": "fake/**/*",
        "video_exts": [".mp4", ".avi", ".mov", ".mkv", ".webm"],
    },
    "liusiyi641": {
        "repo_id": "liusiyi641/deep_fake_videos",
        "real_pattern": "real/**/*",
        "fake_pattern": "fake/**/*",
        "video_exts": [".mp4", ".avi", ".mov", ".mkv"],
    },
    "liusiyi641_val": {
        "repo_id": "liusiyi641/deep_fake_videos_val",
        "real_pattern": "real/**/*",
        "fake_pattern": "fake/**/*",
        "video_exts": [".mp4", ".avi", ".mov", ".mkv"],
    },
}


def download_source(name, config, max_per_class, dest_real, dest_fake):
    """Download from a single HF source and sort into real/fake folders."""
    repo_id = config["repo_id"]
    print(f"\n=== Downloading {name} ({repo_id}) ===")

    # Create temp download dir
    temp_dir = DATA_ROOT / "_temp" / name
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        # List files first to see what's available
        files = list_repo_files(repo_id, repo_type="dataset")
        video_files = [f for f in files if any(f.lower().endswith(ext) for ext in config["video_exts"])]

        real_files = [f for f in video_files if "real" in f.lower()]
        fake_files = [f for f in video_files if "fake" in f.lower()]

        print(f"  Found {len(real_files)} real, {len(fake_files)} fake videos in repo")

        if not real_files and not fake_files:
            print(f"  [SKIP] No videos found in expected paths. Available samples:")
            for f in video_files[:10]:
                print(f"    {f}")
            return 0, 0

        # Download subset
        real_sample = random.sample(real_files, min(max_per_class, len(real_files))) if real_files else []
        fake_sample = random.sample(fake_files, min(max_per_class, len(fake_files))) if fake_files else []

        downloaded_real = 0
        downloaded_fake = 0

        for f in tqdm(real_sample, desc=f"  {name} real", leave=False):
            try:
                local = hf_hub_download(repo_id=repo_id, repo_type="dataset", filename=f, local_dir=temp_dir, local_dir_use_symlinks=False)
                # Move to data/real/
                ext = Path(f).suffix
                target = dest_real / f"{name}_{downloaded_real:04d}{ext}"
                os.replace(local, target)
                downloaded_real += 1
            except Exception as e:
                pass

        for f in tqdm(fake_sample, desc=f"  {name} fake", leave=False):
            try:
                local = hf_hub_download(repo_id=repo_id, repo_type="dataset", filename=f, local_dir=temp_dir, local_dir_use_symlinks=False)
                ext = Path(f).suffix
                target = dest_fake / f"{name}_{downloaded_fake:04d}{ext}"
                os.replace(local, target)
                downloaded_fake += 1
            except Exception as e:
                pass

        print(f"  -> Downloaded {downloaded_real} real, {downloaded_fake} fake")
        return downloaded_real, downloaded_fake

    except Exception as e:
        print(f"  [ERROR] {e}")
        return 0, 0


def write_manifest():
    """Scan data/ and write manifest.json."""
    manifest = {"real": [], "fake": []}
    real_dir = DATA_ROOT / "real"
    fake_dir = DATA_ROOT / "fake"

    for p in real_dir.glob("**/*"):
        if p.suffix.lower() in [".mp4", ".avi", ".mov", ".mkv", ".webm"]:
            manifest["real"].append(str(p))
    for p in fake_dir.glob("**/*"):
        if p.suffix.lower() in [".mp4", ".avi", ".mov", ".mkv", ".webm"]:
            manifest["fake"].append(str(p))

    out = DATA_ROOT / "manifest.json"
    with open(out, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n=== Manifest written: {out} ===")
    print(f"  Real clips : {len(manifest['real'])}")
    print(f"  Fake/AI clips: {len(manifest['fake'])}")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", type=str, default="Sarim-Hash,angads24,liusiyi641",
                        help="Comma-separated source names to try")
    parser.add_argument("--max-per-source", type=int, default=500,
                        help="Max videos per class per source")
    parser.add_argument("--manifest-only", action="store_true",
                        help="Only rebuild manifest")
    args = parser.parse_args()

    DATA_ROOT.mkdir(exist_ok=True)
    real_dir = DATA_ROOT / "real"
    fake_dir = DATA_ROOT / "fake"
    real_dir.mkdir(exist_ok=True)
    fake_dir.mkdir(exist_ok=True)

    if args.manifest_only:
        write_manifest()
        sys.exit(0)

    sources = [s.strip() for s in args.sources.split(",")]
    total_real = 0
    total_fake = 0

    for src_name in sources:
        if src_name not in KNOWN_SOURCES:
            print(f"\n[SKIP] Unknown source: {src_name}")
            continue
        r, f = download_source(src_name, KNOWN_SOURCES[src_name], args.max_per_source, real_dir, fake_dir)
        total_real += r
        total_fake += f

    print(f"\n=== Total downloaded: {total_real} real, {total_fake} fake ===")
    write_manifest()

    if total_real + total_fake < 50:
        print("\n[WARNING] Very few videos downloaded. You may need to:")
        print("  1. Set HF_TOKEN for gated datasets")
        print("  2. Add more public sources")
        print("  3. Place manual downloads in data/real/ and data/fake/")
    else:
        print("\nNext: python training/embed_dataset.py --frames 8 --batch 16")
