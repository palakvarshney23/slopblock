"""Embed labeled videos with CLIP ViT-B/32 and cache mean-pooled vectors."""

from __future__ import annotations

import argparse
import pickle
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from tqdm import tqdm
from transformers import CLIPModel, CLIPProcessor

from browser_frame_sampler import sample_browser_frames_augmented
from frame_sampler import sample_browser_frames, sample_frames


CLIP_MODEL_ID = "openai/clip-vit-base-patch32"
DEFAULT_DATA_ROOT = Path("data/train")
DEFAULT_CACHE = Path("cache/train_embs.pkl")
DEFAULT_BROWSER_CACHE = Path("cache/train_embs_browser.pkl")


def _iter_videos(root: Path):
    exts = {".mp4", ".webm", ".mov", ".mkv", ".avi"}
    for label_dir in sorted(root.iterdir()):
        if not label_dir.is_dir():
            continue
        label = 1 if label_dir.name.lower() in {"ai", "fake", "generated", "slop"} else 0
        for path in sorted(label_dir.rglob("*")):
            if path.suffix.lower() in exts:
                yield path, label


def _l2_normalize(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    if norm <= 1e-12:
        return vec
    return vec / norm


@torch.no_grad()
def _embed_frames(model, processor, device, frames: np.ndarray) -> np.ndarray:
    embs = []
    for frame in frames:
        image = Image.fromarray(frame)
        inputs = processor(images=image, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}
        feat = model.get_image_features(**inputs)
        feat = feat / feat.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        embs.append(feat.squeeze(0).cpu().numpy())
    if not embs:
        raise ValueError("No frames to embed")
    pooled = np.mean(np.stack(embs, axis=0), axis=0)
    return _l2_normalize(pooled.astype(np.float32))


def _sample_for_mode(path: Path, mode: str, augment: bool) -> np.ndarray:
    if mode == "browser":
        if augment:
            frames = sample_browser_frames_augmented(str(path))
            if not frames:
                return np.zeros((0, 180, 320, 3), dtype=np.uint8)
            return np.stack(frames, axis=0)
        return sample_browser_frames(str(path))
    return sample_frames(str(path))


@torch.no_grad()
def embed_video(
    model,
    processor,
    device,
    video_path: Path,
    *,
    mode: str = "native",
    augment: bool = False,
) -> np.ndarray | None:
    frames = _sample_for_mode(video_path, mode, augment)
    if frames.size == 0:
        return None
    return _embed_frames(model, processor, device, frames)


def _load_partial(cache: Path):
    if not cache.is_file():
        return [], [], [], set()
    with cache.open("rb") as fh:
        data = pickle.load(fh)
    done = set(data.get("paths") or [])
    return (
        list(data.get("embeddings") or []),
        list(data.get("labels") or []),
        list(data.get("paths") or []),
        done,
    )


def _save_partial(
    cache: Path,
    embeddings,
    labels,
    paths,
    clip_model: str,
    *,
    mode: str,
    augment: bool,
) -> None:
    cache.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "embeddings": np.stack(embeddings, axis=0),
        "labels": np.array(labels, dtype=np.int32),
        "paths": paths,
        "clip_model": clip_model,
        "embedding_dim": int(embeddings[0].shape[0]),
        "frame_mode": mode,
        "augment": augment,
    }
    with cache.open("wb") as fh:
        pickle.dump(payload, fh)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--cache", type=Path, default=None)
    parser.add_argument("--clip-model", default=CLIP_MODEL_ID)
    parser.add_argument("--mode", choices=("native", "browser"), default="native")
    parser.add_argument("--augment", action="store_true", help="3x browser-frame augmentation")
    parser.add_argument("--resume", action="store_true", help="Skip videos already in cache")
    parser.add_argument("--checkpoint-every", type=int, default=100)
    args = parser.parse_args()

    cache = args.cache or (DEFAULT_BROWSER_CACHE if args.mode == "browser" else DEFAULT_CACHE)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    processor = CLIPProcessor.from_pretrained(args.clip_model)
    model = CLIPModel.from_pretrained(args.clip_model).to(device)
    model.eval()

    embeddings, labels, paths, done = ([], [], [], set())
    if args.resume:
        embeddings, labels, paths, done = _load_partial(cache)
        if embeddings:
            print(f"Resuming with {len(embeddings)} cached embeddings")

    pending = [
        (video_path, label)
        for video_path, label in _iter_videos(args.data_root)
        if str(video_path) not in done
    ]

    for idx, (video_path, label) in enumerate(tqdm(pending, desc="Embedding"), start=1):
        try:
            vec = embed_video(
                model,
                processor,
                device,
                video_path,
                mode=args.mode,
                augment=args.augment,
            )
            if vec is None:
                continue
        except Exception as err:  # noqa: BLE001 - training utility
            print(f"skip {video_path}: {err}")
            continue
        embeddings.append(vec)
        labels.append(label)
        paths.append(str(video_path))
        if args.checkpoint_every > 0 and idx % args.checkpoint_every == 0:
            _save_partial(
                cache,
                embeddings,
                labels,
                paths,
                args.clip_model,
                mode=args.mode,
                augment=args.augment,
            )

    if not embeddings:
        raise SystemExit(f"No videos embedded under {args.data_root}")

    _save_partial(
        cache,
        embeddings,
        labels,
        paths,
        args.clip_model,
        mode=args.mode,
        augment=args.augment,
    )
    print(f"Wrote {len(embeddings)} embeddings to {cache}")


if __name__ == "__main__":
    main()
