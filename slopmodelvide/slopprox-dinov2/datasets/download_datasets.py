"""
Dataset Download & Preparation for SlopProx DINOv2+ReStraV Training
=====================================================================
Handles: Celeb-DF v2, GenVidBench/AEGIS subset, Vript reals

Usage:
    python download_datasets.py --all
    python download_datasets.py --celebdf --genvidbench --vript
    python download_datasets.py --celebdf   # just one

Output structure:
    data/
      celeb_df/
        real/   (mp4 clips)
        fake/   (deepfake mp4s)
      genvidbench/
        t2v/    (Sora, Runway, Pika generated)
        real/   (YouTube sourced reals)
      vript/
        real/   (diverse YouTube b-roll)
"""

import os
import argparse
import subprocess
import json
import sys
from pathlib import Path

DATA_ROOT = Path("data")


# ─── CELEB-DF v2 ─────────────────────────────────────────────────────────────
def download_celebdf():
    """
    Celeb-DF v2: official form at https://github.com/yuezunli/celeb-deepfakeforensics
    You must request access and receive a Google Drive link.
    This script handles post-download extraction.
    """
    dest = DATA_ROOT / "celeb_df"
    dest.mkdir(parents=True, exist_ok=True)

    print("\n=== Celeb-DF v2 ===")
    print("1. Go to: https://github.com/yuezunli/celeb-deepfakeforensics")
    print("2. Fill the request form to get download links.")
    print("3. Download 'Celeb-real.zip' and 'Celeb-synthesis.zip'")
    print(f"4. Place them in: {dest.resolve()}/")
    print("5. Re-run this script — it will extract automatically.\n")

    real_zip = dest / "Celeb-real.zip"
    fake_zip = dest / "Celeb-synthesis.zip"

    if real_zip.exists():
        print("Extracting Celeb-real.zip ...")
        subprocess.run(["unzip", "-q", str(real_zip), "-d", str(dest / "real")], check=True)
        print("  → Extracted to data/celeb_df/real/")
    else:
        print(f"  [SKIP] {real_zip} not found.")

    if fake_zip.exists():
        print("Extracting Celeb-synthesis.zip ...")
        subprocess.run(["unzip", "-q", str(fake_zip), "-d", str(dest / "fake")], check=True)
        print("  → Extracted to data/celeb_df/fake/")
    else:
        print(f"  [SKIP] {fake_zip} not found.")


# ─── GenVidBench / AEGIS ──────────────────────────────────────────────────────
def download_genvidbench():
    """
    GenVidBench: https://github.com/PhoenixZ810/GenVidBench
    AEGIS subset curated for T2V detection (Sora, Runway, Pika, etc.)
    HuggingFace dataset: 'hyw1712/AEGIS-Video-Detection'
    """
    dest = DATA_ROOT / "genvidbench"
    t2v_dest = dest / "t2v"
    real_dest = dest / "real"
    t2v_dest.mkdir(parents=True, exist_ok=True)
    real_dest.mkdir(parents=True, exist_ok=True)

    print("\n=== GenVidBench / AEGIS (T2V) ===")

    # Try HuggingFace datasets CLI download
    try:
        import huggingface_hub
        print("Downloading AEGIS-Video-Detection from HuggingFace...")
        from huggingface_hub import snapshot_download
        local = snapshot_download(
            repo_id="hyw1712/AEGIS-Video-Detection",
            repo_type="dataset",
            local_dir=str(dest / "raw_hf"),
            ignore_patterns=["*.parquet"],   # only videos
        )
        print(f"  → Downloaded to {local}")
        print("  Run organize_genvidbench.py to split into t2v/ and real/ folders.")
    except ImportError:
        print("  huggingface_hub not installed. Run: pip install huggingface_hub")
    except Exception as e:
        print(f"  HF download failed: {e}")
        print("  Manual: https://huggingface.co/datasets/hyw1712/AEGIS-Video-Detection")

    # Also print GenVidBench manual instructions
    print("\n  GenVidBench manual download:")
    print("  → https://github.com/PhoenixZ810/GenVidBench")
    print("  → Follow instructions for video subset download")
    print(f"  → Place T2V videos in: {t2v_dest.resolve()}/")
    print(f"  → Place real videos in: {real_dest.resolve()}/")


# ─── Vript (diverse real YouTube b-roll) ─────────────────────────────────────
def download_vript():
    """
    Vript: https://huggingface.co/datasets/Mutonix/Vript
    Large-scale dense captions + clips from YouTube. We use the video clips
    as 'social real' negatives to reduce false positives on AI-generated content.
    We sample ~2000 clips to balance the dataset.
    """
    dest = DATA_ROOT / "vript" / "real"
    dest.mkdir(parents=True, exist_ok=True)

    print("\n=== Vript (Social Real Negatives) ===")
    try:
        from huggingface_hub import snapshot_download
        print("Downloading Vript subset from HuggingFace (this may be large)...")
        print("  Tip: Use HF_HUB_ENABLE_HF_TRANSFER=1 for faster downloads")

        local = snapshot_download(
            repo_id="Mutonix/Vript",
            repo_type="dataset",
            local_dir=str(DATA_ROOT / "vript" / "raw_hf"),
            allow_patterns=["clips/*"],   # only video clips, skip annotations
        )
        print(f"  → Downloaded to {local}")
        print("  Run organize_vript.py to sample and copy ~2000 clips to real/")
    except ImportError:
        print("  huggingface_hub not installed. Run: pip install huggingface_hub")
    except Exception as e:
        print(f"  HF download failed: {e}")
        print("  Manual: https://huggingface.co/datasets/Mutonix/Vript")


# ─── Organize after download ──────────────────────────────────────────────────
def write_manifest():
    """Scan data/ and write a manifest JSON for training scripts to consume."""
    manifest = {"real": [], "fake": []}

    # Celeb-DF
    for p in (DATA_ROOT / "celeb_df" / "real").glob("**/*.mp4"):
        manifest["real"].append(str(p))
    for p in (DATA_ROOT / "celeb_df" / "fake").glob("**/*.mp4"):
        manifest["fake"].append(str(p))

    # GenVidBench
    for p in (DATA_ROOT / "genvidbench" / "real").glob("**/*.mp4"):
        manifest["real"].append(str(p))
    for p in (DATA_ROOT / "genvidbench" / "t2v").glob("**/*.mp4"):
        manifest["fake"].append(str(p))

    # Vript
    for p in (DATA_ROOT / "vript" / "real").glob("**/*.mp4"):
        manifest["real"].append(str(p))

    out = DATA_ROOT / "manifest.json"
    with open(out, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n=== Manifest written: {out} ===")
    print(f"  Real clips : {len(manifest['real'])}")
    print(f"  Fake/AI clips: {len(manifest['fake'])}")
    return manifest


# ─── CLI ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download SlopProx training datasets")
    parser.add_argument("--all", action="store_true", help="Download all datasets")
    parser.add_argument("--celebdf", action="store_true")
    parser.add_argument("--genvidbench", action="store_true")
    parser.add_argument("--vript", action="store_true")
    parser.add_argument("--manifest", action="store_true", help="Just rebuild manifest.json")
    args = parser.parse_args()

    DATA_ROOT.mkdir(exist_ok=True)

    if args.manifest:
        write_manifest()
        sys.exit(0)

    if args.all or args.celebdf:
        download_celebdf()
    if args.all or args.genvidbench:
        download_genvidbench()
    if args.all or args.vript:
        download_vript()

    print("\n--- Writing manifest ---")
    write_manifest()
    print("\nNext: python training/embed_dataset.py")
