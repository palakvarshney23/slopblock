"""
Aggressive dataset downloader - gets ALL available public videos
"""
import os
from pathlib import Path
from huggingface_hub import hf_hub_download, list_repo_files
from tqdm import tqdm

DATA_ROOT = Path("data")
real_dir = DATA_ROOT / "real"
fake_dir = DATA_ROOT / "fake"
real_dir.mkdir(exist_ok=True, parents=True)
fake_dir.mkdir(exist_ok=True, parents=True)

SOURCES = [
    {"repo": "angads24/deepfake-video", "real_path": "real", "fake_path": "fake"},
    {"repo": "Sarim-Hash/video_DEEPFAKE_dataset", "real_path": "real_video", "fake_path": "fake_video"},
    {"repo": "UniDataPro/deepfake-videos-dataset", "real_path": "video", "fake_path": "deepfake"},
]

def download_all(repo_id, subdir, dest_prefix, max_count=10000):
    """Download all video files from a subdirectory of a HF dataset."""
    try:
        files = list_repo_files(repo_id, repo_type="dataset")
    except Exception as e:
        print(f"  [SKIP] {repo_id}: {e}")
        return 0
    
    videos = [f for f in files 
              if f.startswith(subdir) and 
              any(f.lower().endswith(ext) for ext in ['.mp4','.avi','.mov','.webm','.mkv'])]
    
    if not videos:
        print(f"  {repo_id}/{subdir}: no videos found")
        return 0
    
    existing = len(list((real_dir if dest_prefix == 'real' else fake_dir).glob(f"{repo_id.replace('/','_')}_*")))
    to_get = videos[existing:existing+max_count]
    
    if not to_get:
        print(f"  {repo_id}/{subdir}: already fully downloaded ({existing})")
        return 0
    
    print(f"  {repo_id}/{subdir}: downloading {len(to_get)} videos (already have {existing})...")
    count = 0
    temp_dir = DATA_ROOT / "_temp_dl"
    temp_dir.mkdir(exist_ok=True)
    
    dest = real_dir if dest_prefix == "real" else fake_dir
    
    for i, f in enumerate(tqdm(to_get, desc=f"  {repo_id.split('/')[1]}/{subdir}")):
        try:
            local = hf_hub_download(repo_id=repo_id, repo_type="dataset", 
                                    filename=f, local_dir=temp_dir, local_dir_use_symlinks=False)
            ext = Path(f).suffix
            target = dest / f"{repo_id.replace('/','_')}_{count:04d}{ext}"
            os.replace(local, target)
            count += 1
        except Exception as e:
            pass
    
    print(f"  -> Downloaded {count} new videos")
    return count

total_real = 0
total_fake = 0

for src in SOURCES:
    print(f"\n=== {src['repo']} ===")
    total_real += download_all(src["repo"], src["real_path"], "real")
    total_fake += download_all(src["repo"], src["fake_path"], "fake")

print(f"\n=== TOTAL NEW: {total_real} real, {total_fake} fake ===")

# Build manifest
import json
manifest = {"real": [], "fake": []}
for p in real_dir.glob("**/*"):
    if p.suffix.lower() in [".mp4",".avi",".mov",".webm",".mkv"]:
        manifest["real"].append(str(p))
for p in fake_dir.glob("**/*"):
    if p.suffix.lower() in [".mp4",".avi",".mov",".webm",".mkv"]:
        manifest["fake"].append(str(p))

with open(DATA_ROOT / "manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

print(f"\n=== Manifest ===")
print(f"  Real clips: {len(manifest['real'])}")
print(f"  Fake clips: {len(manifest['fake'])}")
print(f"  Total: {len(manifest['real']) + len(manifest['fake'])}")
