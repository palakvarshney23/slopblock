"""
download_train_cleanup.py
==========================
Download ~25 GB of diverse video datasets for SlopBlock incremental retraining.
Covers: AI human, AI anime, AI cartoon, real human, real anime, real cartoon, semi-real.

After download, runs retrain_incremental.py to embed, train, and auto-delete raw videos.

USAGE:
  python download_train_cleanup.py
  python download_train_cleanup.py --dry-run
  python download_train_cleanup.py --budget-gb 20
"""
import os
import sys
import shutil
import argparse
import subprocess
from pathlib import Path
from datetime import datetime

# -- Config -----------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_AI    = SCRIPT_DIR / "data" / "ai_generated"
DATA_REAL  = SCRIPT_DIR / "data" / "real"
TEMP_DIR   = Path("/tmp/slopblock_dl") if os.name != "nt" else (SCRIPT_DIR / "_tmp_downloads")
RETRAIN_SCRIPT = SCRIPT_DIR / "retrain_incremental.py"
LOG_FILE   = SCRIPT_DIR / "download_train_cleanup.log"
TOKEN_FILE = SCRIPT_DIR / ".hf_token"

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

# -- HF Token ---------------------------------------------------------------
def load_hf_token():
    """Load HuggingFace token from env var or .hf_token file."""
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if token:
        return token
    if TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if token:
            os.environ["HF_TOKEN"] = token
            return token
    return None

HF_TOKEN = load_hf_token()
if HF_TOKEN:
    os.environ["HF_TOKEN"] = HF_TOKEN

# -- Logging ----------------------------------------------------------------
def log(msg, level="INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {level}: {msg}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def sep():
    print("-" * 60)

# -- Disk checks ------------------------------------------------------------
def get_dir_gb(path: Path) -> float:
    if not path.exists():
        return 0.0
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return total / (1024 ** 3)

def free_disk_gb() -> float:
    total, used, free = shutil.disk_usage(str(SCRIPT_DIR))
    return free / (1024 ** 3)

# -- Download a HF dataset snapshot -----------------------------------------
def download_hf_dataset(repo_id: str, local_dir: Path, max_workers: int = 4, ignore=None):
    """Download dataset snapshot, return path to downloaded folder."""
    try:
        from huggingface_hub import snapshot_download
        local_dir.mkdir(parents=True, exist_ok=True)
        snap = snapshot_download(
            repo_id=repo_id,
            repo_type="dataset",
            local_dir=str(local_dir),
            max_workers=max_workers,
            local_dir_use_symlinks=False,
            ignore_patterns=ignore or ["*.parquet", "*.json", "*.jsonl", "*.txt", "*.md", "*.csv", "*.pkl", "*.html", "*.hdf5"]
        )
        return Path(snap)
    except Exception as e:
        log(f"Snapshot download failed for {repo_id}: {e}", "ERROR")
        return None

# -- Copy video files from source to dest with prefix -----------------------
def collect_videos(src: Path, dest: Path, prefix: str, max_count: int = 1000, budget_gb: float = float('inf')) -> int:
    """Copy video files from src tree to dest, with naming prefix."""
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    bytes_copied = 0
    max_bytes = budget_gb * (1024 ** 3)

    for f in sorted(src.rglob("*")):
        if not f.is_file():
            continue
        if f.suffix.lower() not in VIDEO_EXTS:
            continue
        if count >= max_count:
            break
        if bytes_copied >= max_bytes:
            log(f"Budget reached during copy ({bytes_copied/1024**3:.1f} GB)", "WARN")
            break

        dst = dest / f"{prefix}_{count:05d}{f.suffix}"
        try:
            shutil.copy2(f, dst)
            bytes_copied += dst.stat().st_size
            count += 1
        except Exception as e:
            log(f"Copy failed for {f.name}: {e}", "ERROR")

    return count

# -- Dataset definitions ----------------------------------------------------
DATASETS = [
    {
        "name": "DeepAction AI (RunwayML, Pika, CogVideoX, AnimateDiff, StableDiffusion, VideoPoet)",
        "repo": "faridlab/deepaction_v1",
        "label": "ai",
        "prefix": "deepaction_ai",
        "max_videos": 600,
        "filter": lambda p: any(m in str(p).lower() for m in ["animatediff", "cogvideox", "runway", "pika", "stablediffusion", "videopoet"]),
    },
    {
        "name": "DeepAction REAL (matched human actions)",
        "repo": "faridlab/deepaction_v1",
        "label": "real",
        "prefix": "deepaction_real",
        "max_videos": 400,
        "filter": lambda p: "real" in str(p).lower(),
    },
    {
        "name": "MultiCamVideo (3D rendered / semi-real characters)",
        "repo": "KwaiVGI/MultiCamVideo-Dataset",
        "label": "ai",
        "prefix": "multicam",
        "max_videos": 300,
        "filter": None,
    },
    {
        "name": "anime-2024 (real anime series footage)",
        "repo": "JacobLinCool/anime-2024",
        "label": "real",
        "prefix": "anime2024",
        "max_videos": 300,
        "filter": None,
    },
    {
        "name": "PE-Video (Meta real-world footage, 10 categories)",
        "repo": "facebook/PE-Video",
        "label": "real",
        "prefix": "pevideo",
        "max_videos": 400,
        "filter": None,
    },
]

def process_dataset(ds: dict, dry_run: bool, budget_gb: float) -> int:
    """Download and process one dataset. Returns video count copied."""
    sep()
    log(f"Dataset: {ds['name']}")
    log(f"  Repo:  {ds['repo']}")
    log(f"  Label: {ds['label']}  -> data/{ds['label']}/")

    # Check budget
    used_gb = get_dir_gb(DATA_AI) + get_dir_gb(DATA_REAL)
    if used_gb >= budget_gb:
        log(f"  SKIP — budget reached ({used_gb:.1f}/{budget_gb} GB)", "WARN")
        return 0

    if dry_run:
        log(f"  [DRY RUN] Would download ~{ds['max_videos']} videos", "WARN")
        return 0

    dest = DATA_AI if ds["label"] == "ai" else DATA_REAL
    snap_dir = TEMP_DIR / ds["prefix"]

    try:
        # Download snapshot
        log("  Downloading snapshot...")
        snap = download_hf_dataset(ds["repo"], snap_dir, max_workers=6)
        if snap is None:
            return 0

        # Filter if needed
        if ds["filter"]:
            files = [f for f in snap.rglob("*") if f.is_file() and f.suffix.lower() in VIDEO_EXTS and ds["filter"](f)]
        else:
            files = [f for f in snap.rglob("*") if f.is_file() and f.suffix.lower() in VIDEO_EXTS]

        log(f"  Found {len(files)} video files in snapshot")

        # Copy to destination
        remaining_budget = budget_gb - used_gb
        count = collect_videos(snap, dest, ds["prefix"], max_count=ds["max_videos"], budget_gb=remaining_budget)
        log(f"  OK Copied {count} videos to data/{ds['label']}/")

        # Cleanup temp
        shutil.rmtree(str(snap_dir), ignore_errors=True)
        return count

    except Exception as e:
        log(f"  FAIL Failed: {e}", "ERROR")
        shutil.rmtree(str(snap_dir), ignore_errors=True)
        return 0


# -- Run retraining -------------------------------------------------------
def run_retraining(dry_run: bool) -> bool:
    sep()
    log("Starting incremental retraining...")

    if not RETRAIN_SCRIPT.exists():
        log(f"retrain_incremental.py not found at {RETRAIN_SCRIPT}", "ERROR")
        return False

    if dry_run:
        log("[DRY RUN] Would run: python retrain_incremental.py", "WARN")
        return True

    result = subprocess.run([sys.executable, str(RETRAIN_SCRIPT)], cwd=str(SCRIPT_DIR))
    if result.returncode != 0:
        log(f"Training failed (exit {result.returncode})", "ERROR")
        log("Videos NOT deleted. Fix error and re-run.", "ERROR")
        return False

    log("OK Retraining complete!")
    return True


# -- Main -------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="SlopBlock Dataset Download + Train + Cleanup")
    parser.add_argument("--budget-gb", type=float, default=25.0, help="Max GB to download (default 25)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without downloading")
    args = parser.parse_args()

    sep()
    print(f"  SlopBlock Dataset Pipeline")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Budget: {args.budget_gb} GB  |  Dry run: {args.dry_run}")
    sep()

    # Pre-flight
    if HF_TOKEN:
        log(f"HF token loaded (length {len(HF_TOKEN)})")
    else:
        log("WARNING: No HF token found. Downloads may be slow or fail for gated datasets.", "WARN")

    free = free_disk_gb()
    needed = args.budget_gb + 5
    if free < needed:
        log(f"Not enough disk space. Need {needed:.0f} GB, have {free:.0f} GB.", "ERROR")
        sys.exit(1)
    log(f"Disk space OK: {free:.1f} GB free")

    # Create dirs
    DATA_AI.mkdir(parents=True, exist_ok=True)
    DATA_REAL.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    # Download datasets
    total_videos = 0
    for ds in DATASETS:
        n = process_dataset(ds, args.dry_run, args.budget_gb)
        total_videos += n

    # Summary
    sep()
    ai_count = sum(1 for f in DATA_AI.rglob("*") if f.suffix.lower() in VIDEO_EXTS and f.is_file())
    real_count = sum(1 for f in DATA_REAL.rglob("*") if f.suffix.lower() in VIDEO_EXTS and f.is_file())
    used_gb = get_dir_gb(DATA_AI) + get_dir_gb(DATA_REAL)
    log(f"Downloaded: {ai_count} AI + {real_count} real = {ai_count+real_count} videos ({used_gb:.2f} GB)")

    if ai_count + real_count == 0 and not args.dry_run:
        log("No videos downloaded. Check connection.", "ERROR")
        sys.exit(1)

    # Retrain
    success = run_retraining(args.dry_run)
    if not success:
        sys.exit(1)

    # Cleanup temp
    shutil.rmtree(str(TEMP_DIR), ignore_errors=True)
    log("Temp files cleaned up.")

    # Cleanup all raw videos after training
    if success:
        log("Deleting all raw video files to free disk space...")
        deleted = 0
        for data_dir in (DATA_AI, DATA_REAL):
            if data_dir.exists():
                for f in data_dir.rglob("*"):
                    if f.is_file() and f.suffix.lower() in VIDEO_EXTS:
                        try:
                            f.unlink()
                            deleted += 1
                        except Exception as e:
                            log(f"Could not delete {f}: {e}", "WARN")
        log(f"Deleted {deleted} raw video files.")

    # Final summary
    sep()
    print("\n  DONE ALL DONE!")
    print(f"  Downloaded: {used_gb:.2f} GB of video data")
    print(f"  Trained on: {ai_count + real_count} videos")
    print(f"  Videos:     auto-deleted by retrain_incremental.py")
    print(f"  Embeddings: saved to embeddings/")
    print(f"  New model:  saved to models/ (versioned)")
    print("\n  Next: update video_classifier.js to load the new probe version.")
    sep()


if __name__ == "__main__":
    main()
