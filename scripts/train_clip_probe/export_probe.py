"""Export sklearn probe pipeline to models/clip_video_probe.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np


DEFAULT_MODEL = Path("cache/clip_probe.joblib")
DEFAULT_BROWSER_MODEL = Path("cache/clip_probe_browser.joblib")
DEFAULT_OUT = Path("models/clip_video_probe.json")
DEFAULT_THRESHOLDS = Path("cache/video_thresholds.json")
JS_CLIP_MODEL = "Xenova/clip-vit-base-patch32"


def _load_thresholds(path: Path, args) -> dict:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "threshold": args.threshold,
        "warn_threshold": args.warn_threshold,
        "block_threshold": args.block_threshold,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=DEFAULT_BROWSER_MODEL)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--warn-threshold", type=float, default=0.30)
    parser.add_argument("--block-threshold", type=float, default=0.60)
    parser.add_argument("--thresholds-file", type=Path, default=DEFAULT_THRESHOLDS)
    args = parser.parse_args()

    if not args.model.is_file():
        args.model = DEFAULT_MODEL

    bundle = joblib.load(args.model)
    pipe = bundle["pipeline"]
    meta = bundle.get("metadata", {})
    thresholds = _load_thresholds(args.thresholds_file, args)

    scaler = pipe.named_steps["scaler"]
    clf = pipe.named_steps["clf"]

    weights = clf.coef_.reshape(-1).astype(float)
    bias = float(clf.intercept_.reshape(-1)[0])
    embedding_dim = int(weights.shape[0])

    payload = {
        "ready": True,
        "scaler_mean": scaler.mean_.astype(float).tolist(),
        "scaler_scale": scaler.scale_.astype(float).tolist(),
        "weights": weights.tolist(),
        "bias": bias,
        "threshold": float(thresholds.get("threshold", args.threshold)),
        "warn_threshold": float(thresholds.get("warn_threshold", args.warn_threshold)),
        "block_threshold": float(thresholds.get("block_threshold", args.block_threshold)),
        "clip_model": JS_CLIP_MODEL,
        "embedding_dim": embedding_dim,
        "trained_with": meta.get("clip_model", "openai/clip-vit-base-patch32"),
        "frame_mode": meta.get("frame_mode", "native"),
        "samples": int(len(meta.get("labels", []))),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Exported probe to {args.out} (dim={embedding_dim})")
    print(
        f"  threshold={payload['threshold']:.3f}  "
        f"warn={payload['warn_threshold']:.3f}  block={payload['block_threshold']:.3f}"
    )


if __name__ == "__main__":
    main()
