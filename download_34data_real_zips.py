"""
download_34data_real_zips.py
=============================
Download zip files from 34data real video datasets and extract videos.
Each zip contains multiple videos, so this is much more efficient than
individual file downloads.
"""
import os
import zipfile
from pathlib import Path
from huggingface_hub import hf_hub_download

DATA_ROOT = Path("data")
REAL_DIR = DATA_ROOT / "real"
REAL_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR = DATA_ROOT / "_temp_zips"
TEMP_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_EXTS = ('.mp4', '.avi', '.mov', '.mkv', '.webm', '.MOV')

# 34data real video datasets with their zip counts
REPOS = [
    ('34data/v14-real-mmhu-h-videos', 6),
    ('34data/v14-real-mmhu-t-videos', 4),
    ('34data/v14-real-mmhu-v-videos', 8),
    ('34data/v14-real-or-video-mov', 2),
]

total_extracted = 0

for repo_id, num_zips in REPOS:
    print(f"\n=== {repo_id} ===")
    for i in range(1, num_zips + 1):
        zip_name = f"data_{i:03d}.zip"
        try:
            print(f"  Downloading {zip_name}...")
            local_path = hf_hub_download(
                repo_id=repo_id,
                filename=zip_name,
                repo_type="dataset",
                local_dir=str(TEMP_DIR),
                local_dir_use_symlinks=False,
            )
            
            print(f"  Extracting from {zip_name}...")
            with zipfile.ZipFile(local_path, 'r') as z:
                videos = [m for m in z.namelist() if m.endswith(VIDEO_EXTS)]
                print(f"  Found {len(videos)} videos")
                
                # Extract to real directory
                for v in videos:
                    z.extract(v, REAL_DIR)
                    total_extracted += 1
            
            # Clean up zip
            os.remove(local_path)
            
        except Exception as e:
            print(f"  ERROR with {zip_name}: {e}")

# Clean up temp
import shutil
if TEMP_DIR.exists():
    shutil.rmtree(TEMP_DIR)

# Count final
video_files = [f for f in REAL_DIR.rglob('*') if f.suffix.lower() in ('.mp4','.avi','.mov','.mkv','.webm') or f.suffix == '.MOV']
print(f"\n{'='*60}")
print(f"DONE: Extracted {total_extracted} videos")
print(f"Total real videos on disk: {len(video_files)}")
print(f"{'='*60}")
