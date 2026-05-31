"""
download_small_real.py
=======================
Download smaller real video datasets quickly.
"""
import os
from pathlib import Path
from tqdm import tqdm
from huggingface_hub import hf_hub_download, list_repo_files

DATA_ROOT = Path("data")
REAL_DIR = DATA_ROOT / "real"
REAL_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_EXTS = ('.mp4', '.avi', '.mov', '.mkv', '.webm', '.MOV')

REPOS = [
    ('JimmyH16/real_video', None),
    ('Sraghvi/real_video_dataset', None),
    ('fengzhuzi/Videos-Natural-scenes', None),
    ('ud-biometrics/Anti-Spoofing-Real-Videos', None),
    ('TreeePlanter/vls_real_video_orange', None),
    ('TreeePlanter/vls_real_video_tea', None),
    ('TreeePlanter/vls_real_video_banana', None),
    ('TreeePlanter/vls_real_video_cup', None),
]

total = 0

for repo_id, _ in REPOS:
    print(f"\n=== {repo_id} ===")
    try:
        files = list(list_repo_files(repo_id, repo_type='dataset'))
        videos = [f for f in files if f.endswith(VIDEO_EXTS)]
        print(f"  Found {len(videos)} videos")
        
        for vf in tqdm(videos[:50], desc=repo_id.split('/')[-1]):
            try:
                hf_hub_download(
                    repo_id=repo_id,
                    filename=vf,
                    repo_type='dataset',
                    local_dir=str(REAL_DIR),
                    local_dir_use_symlinks=False,
                )
                total += 1
            except Exception as e:
                print(f"    FAIL {vf}: {e}")
                
    except Exception as e:
        print(f"  ERROR listing {repo_id}: {e}")

video_files = [f for f in REAL_DIR.rglob('*') if f.suffix.lower() in ('.mp4','.avi','.mov','.mkv','.webm') or f.suffix == '.MOV']
print(f"\n{'='*60}")
print(f"DONE: Downloaded {total} videos")
print(f"Total real videos on disk: {len(video_files)}")
print(f"{'='*60}")
