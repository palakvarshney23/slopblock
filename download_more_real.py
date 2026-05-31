"""
download_more_real.py
=====================
Download additional real videos from HuggingFace to balance the dataset.
"""
import os
import zipfile
from pathlib import Path
from tqdm import tqdm
from huggingface_hub import hf_hub_download, list_repo_files

DATA_ROOT = Path("data")
REAL_DIR = DATA_ROOT / "real"
REAL_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_EXTS = ('.mp4', '.avi', '.mov', '.mkv', '.webm', '.MOV')

def download_videos_from_repo(repo_id, max_files=1000):
    """Download all video files from a HF dataset repo."""
    print(f"\n=== {repo_id} ===")
    try:
        files = list(list_repo_files(repo_id, repo_type="dataset"))
    except Exception as e:
        print(f"  ERROR listing: {e}")
        return 0

    videos = [f for f in files if f.lower().endswith(VIDEO_EXTS) or f.endswith('.MOV')]
    zips = [f for f in files if f.endswith('.zip')]
    
    total = 0
    
    # Download direct videos
    if videos:
        print(f"  Found {len(videos)} direct video files")
        videos = videos[:max_files]
        for vf in tqdm(videos, desc=f"DL {repo_id.split('/')[-1]}"):
            try:
                hf_hub_download(
                    repo_id=repo_id,
                    filename=vf,
                    repo_type="dataset",
                    local_dir=str(REAL_DIR),
                    local_dir_use_symlinks=False,
                )
                total += 1
            except Exception as e:
                print(f"    FAIL {vf}: {e}")
    
    # Download and extract zips
    if zips:
        print(f"  Found {len(zips)} zip files")
        zips = zips[:50]  # cap at 50 zips
        for zf in tqdm(zips, desc=f"ZIP {repo_id.split('/')[-1]}"):
            try:
                local_path = hf_hub_download(
                    repo_id=repo_id,
                    filename=zf,
                    repo_type="dataset",
                    local_dir=str(DATA_ROOT / "_temp_zips"),
                    local_dir_use_symlinks=False,
                )
                
                with zipfile.ZipFile(local_path, 'r') as z:
                    zip_videos = [m for m in z.namelist() if m.lower().endswith(VIDEO_EXTS)]
                    print(f"    Extracting {len(zip_videos)} videos from {zf}")
                    for v in zip_videos:
                        z.extract(v, REAL_DIR)
                        total += 1
                
                os.remove(local_path)
            except Exception as e:
                print(f"    FAIL {zf}: {e}")
    
    print(f"  Total added: {total}")
    return total


REPOS = [
    'TreeePlanter/rainbow_real_pick_video',
    'TreeePlanter/vls_real_video_orange',
    'TreeePlanter/vls_real_video_tea',
    'TreeePlanter/vls_real_video_banana',
    'TreeePlanter/vls_real_video_cup',
    'JimmyH16/real_video',
    'Sraghvi/real_video_dataset',
    'fengzhuzi/Videos-Natural-scenes',
    'ud-biometrics/Anti-Spoofing-Real-Videos',
    # 34data real videos (zip archives)
    '34data/v14-real-mmhu-h-videos',
    '34data/v14-real-mmhu-t-videos',
    '34data/v14-real-mmhu-v-videos',
    '34data/v14-real-or-video-mov',
]

if __name__ == "__main__":
    total = 0
    for repo in REPOS:
        total += download_videos_from_repo(repo)
    
    # Cleanup temp
    temp_dir = DATA_ROOT / "_temp_zips"
    if temp_dir.exists():
        import shutil
        shutil.rmtree(temp_dir)
    
    # Count final
    video_files = [f for f in REAL_DIR.rglob('*') if f.suffix.lower() in ('.mp4','.avi','.mov','.mkv','.webm') or f.suffix == '.MOV']
    print(f"\n{'='*60}")
    print(f"DONE: Total real videos on disk: {len(video_files)}")
    print(f"{'='*60}")
