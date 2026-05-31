"""
embed_dataset.py — DINOv2-small frame embedding for SlopProx
=============================================================
Phase A: DINOv2-small CLS token, mean-pooled across N frames
Phase B: Same, but keeps per-frame embeddings for ReStraV geometry

Outputs:
    embeddings/
        embeddings_phaseA.npz   — (N, 384) mean-pooled, label array
        embeddings_phaseB.npz   — (N, frames, 384) per-frame, label array

Usage:
    python training/embed_dataset.py --frames 8 --batch 16
    python training/embed_dataset.py --frames 10 --batch 8   # if VRAM tight

RTX 3050 (8 GB): batch 16 with DINOv2-small is comfortable.
"""

import os
import json
import argparse
import random
import numpy as np
from pathlib import Path
import torch
import torch.nn.functional as F
from torchvision import transforms
from transformers import AutoModel, AutoImageProcessor
import cv2
from tqdm import tqdm

EMBED_DIR = Path("embeddings")
DATA_ROOT = Path("data")

# DINOv2-small: 384-d CLS token
DINOV2_MODEL = "facebook/dinov2-small"

# ─── Frame extraction ──────────────────────────────────────────────────────────

def extract_frames(video_path: str, n_frames: int = 8) -> list[np.ndarray] | None:
    """
    Uniformly sample n_frames from a video.
    Returns list of RGB uint8 arrays (H, W, 3), or None on failure.
    Mirrors the browser's uniform-seek logic in content.js.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total < n_frames:
        cap.release()
        return None

    indices = [int(i * total / n_frames) for i in range(n_frames)]
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            cap.release()
            return None
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

    cap.release()
    return frames


# ─── DINOv2 setup ─────────────────────────────────────────────────────────────

def build_model(device):
    print(f"Loading DINOv2-small from HuggingFace -> {device}")
    model = AutoModel.from_pretrained(DINOV2_MODEL)
    model.eval().to(device)
    processor = AutoImageProcessor.from_pretrained(DINOV2_MODEL)
    return model, processor


@torch.no_grad()
def embed_frames(frames: list[np.ndarray], model, processor, device) -> np.ndarray:
    """
    Returns (n_frames, 384) CLS embeddings as float32 numpy array.
    """
    inputs = processor(images=frames, return_tensors="pt").to(device)
    outputs = model(**inputs)
    cls = outputs.last_hidden_state[:, 0, :]   # CLS token
    cls = F.normalize(cls, dim=-1)             # L2-normalize
    return cls.cpu().float().numpy()


# ─── Main embedding loop ───────────────────────────────────────────────────────

def embed_dataset(n_frames: int, batch_size: int, max_per_class: int | None):
    EMBED_DIR.mkdir(exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    model, processor = build_model(device)

    manifest_path = DATA_ROOT / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(
            "data/manifest.json not found. Run: python datasets/download_datasets.py --manifest"
        )

    with open(manifest_path) as f:
        manifest = json.load(f)

    real_paths = manifest["real"]
    fake_paths = manifest["fake"]

    if max_per_class:
        random.shuffle(real_paths)
        random.shuffle(fake_paths)
        real_paths = real_paths[:max_per_class]
        fake_paths = fake_paths[:max_per_class]

    print(f"\nEmbedding {len(real_paths)} real + {len(fake_paths)} fake videos")
    print(f"Frames per video: {n_frames}, Model: DINOv2-small (384-d)\n")

    all_embeddings_phaseA = []   # (384,) per video (mean pooled)
    all_embeddings_phaseB = []   # (n_frames, 384) per video
    all_labels = []              # 0=real, 1=fake
    all_paths = []

    all_videos = [(p, 0) for p in real_paths] + [(p, 1) for p in fake_paths]
    random.shuffle(all_videos)

    failed = 0
    for video_path, label in tqdm(all_videos, desc="Embedding"):
        frames = extract_frames(video_path, n_frames=n_frames)
        if frames is None:
            failed += 1
            continue

        try:
            frame_embs = embed_frames(frames, model, processor, device)  # (n_frames, 384)
        except Exception as e:
            failed += 1
            continue

        all_embeddings_phaseA.append(frame_embs.mean(axis=0))   # mean pool
        all_embeddings_phaseB.append(frame_embs)
        all_labels.append(label)
        all_paths.append(video_path)

    print(f"\nEmbedded: {len(all_labels)}, Failed/skipped: {failed}")

    labels = np.array(all_labels, dtype=np.int8)

    # Phase A: mean-pooled
    emb_a = np.stack(all_embeddings_phaseA, axis=0)  # (N, 384)
    np.savez_compressed(
        EMBED_DIR / "embeddings_phaseA.npz",
        embeddings=emb_a,
        labels=labels,
        paths=np.array(all_paths),
    )
    print(f"Saved: embeddings/embeddings_phaseA.npz  shape={emb_a.shape}")

    # Phase B: per-frame (variable -> pad to n_frames)
    emb_b = np.stack(all_embeddings_phaseB, axis=0)  # (N, n_frames, 384)
    np.savez_compressed(
        EMBED_DIR / "embeddings_phaseB.npz",
        embeddings=emb_b,
        labels=labels,
        paths=np.array(all_paths),
        n_frames=n_frames,
    )
    print(f"Saved: embeddings/embeddings_phaseB.npz  shape={emb_b.shape}")
    print("\nNext:")
    print("  Phase A -> python training/train_phaseA.py")
    print("  Phase B -> python training/extract_restrap_features.py")


# ─── CLI ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", type=int, default=8, help="Frames per video (default 8)")
    parser.add_argument("--batch", type=int, default=16, help="Batch size for GPU (default 16)")
    parser.add_argument("--max-per-class", type=int, default=None,
                        help="Cap real/fake clips (e.g. 5000). Useful for balancing.")
    args = parser.parse_args()
    embed_dataset(args.frames, args.batch, args.max_per_class)
