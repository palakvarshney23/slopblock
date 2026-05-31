"""
extract_frames_v2.py
=====================
Extract 8 evenly-spaced frames from all videos in data/ai_generated and data/real.
Processes the expanded dataset (1255 AI + 238 real = 1493 videos).
"""
import os
import cv2
import numpy as np
from pathlib import Path
from tqdm import tqdm

DATA_ROOT = Path("data")
FRAME_DIR = DATA_ROOT / "video_frames_v2"
FRAME_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_DIRS = {
    "ai": DATA_ROOT / "ai_generated",
    "real": DATA_ROOT / "real",
}

N_FRAMES = 8

def extract_video_frames(video_path, out_dir):
    """Extract N evenly-spaced frames, save as frame_000.jpg ... frame_007.jpg."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return False
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total < N_FRAMES:
        cap.release()
        return False
    indices = np.linspace(0, total - 1, N_FRAMES, dtype=int)
    for i, idx in enumerate(indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            break
        cv2.imwrite(str(out_dir / f"frame_{i:03d}.jpg"), frame)
    cap.release()
    return True


def process_split(label, video_dir):
    video_exts = ('.mp4', '.avi', '.mov', '.mkv', '.webm')
    videos = [f for f in video_dir.rglob('*') if f.is_file() and f.suffix.lower() in video_exts]
    out_split = FRAME_DIR / label
    out_split.mkdir(parents=True, exist_ok=True)

    ok = 0
    fail = 0
    for vpath in tqdm(videos, desc=f"Extract {label}"):
        out_dir = out_split / vpath.stem
        if out_dir.exists() and any(out_dir.iterdir()):
            ok += 1
            continue  # already extracted
        out_dir.mkdir(parents=True, exist_ok=True)
        if extract_video_frames(vpath, out_dir):
            ok += 1
        else:
            fail += 1
            try:
                out_dir.rmdir()
            except:
                pass

    print(f"[{label.upper()}] Extracted: {ok}, Failed: {fail}, Total: {len(videos)}")
    return ok


if __name__ == "__main__":
    print("=" * 60)
    print("FRAME EXTRACTION V2")
    print(f"  Target: {N_FRAMES} frames per video")
    print("=" * 60)

    ai_ok = process_split("ai", VIDEO_DIRS["ai"])
    real_ok = process_split("real", VIDEO_DIRS["real"])

    ai_dirs = [d for d in (FRAME_DIR / "ai").iterdir() if d.is_dir()]
    real_dirs = [d for d in (FRAME_DIR / "real").iterdir() if d.is_dir()]

    print("\n" + "=" * 60)
    print("COMPLETE")
    print(f"  AI frame sets: {len(ai_dirs)}")
    print(f"  Real frame sets: {len(real_dirs)}")
    print(f"  Total: {len(ai_dirs) + len(real_dirs)}")
    print("=" * 60)
