"""Calibrate video probe thresholds on a validation split."""

from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


DEFAULT_MODEL = Path("cache/clip_probe_browser.joblib")
DEFAULT_CACHE = Path("cache/train_embs_browser.pkl")
DEFAULT_OUT = Path("cache/video_thresholds.json")


def _build_pipeline() -> Pipeline:
    return Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(class_weight="balanced", max_iter=2000)),
    ])


def _fake_recall_at_real_fpr(probs: np.ndarray, labels: np.ndarray, max_real_fpr: float) -> tuple[float, float]:
    best_t = 0.5
    best_recall = 0.0
    real_mask = labels == 0
    fake_mask = labels == 1
    for threshold in np.linspace(0.05, 0.95, 91):
        pred = probs >= threshold
        real_fpr = float(pred[real_mask].mean()) if real_mask.any() else 1.0
        if real_fpr <= max_real_fpr:
            recall = float(pred[fake_mask].mean()) if fake_mask.any() else 0.0
            if recall >= best_recall:
                best_recall = recall
                best_t = float(threshold)
    return best_t, best_recall


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not args.cache.is_file():
        args.cache = Path("cache/train_embs.pkl")

    with args.cache.open("rb") as fh:
        data = pickle.load(fh)
    x = np.asarray(data["embeddings"], dtype=np.float32)
    y = np.asarray(data["labels"], dtype=np.int32)

    x_train, x_holdout, y_train, y_holdout = train_test_split(
        x, y, test_size=0.4, random_state=args.seed, stratify=y
    )
    x_val, x_test, y_val, y_test = train_test_split(
        x_holdout, y_holdout, test_size=0.5, random_state=args.seed, stratify=y_holdout
    )

    if args.model.is_file():
        pipe = joblib.load(args.model)["pipeline"]
    else:
        pipe = _build_pipeline()
        pipe.fit(x_train, y_train)

    val_probs = pipe.predict_proba(x_val)[:, 1]
    test_probs = pipe.predict_proba(x_test)[:, 1]

    warn_t, warn_recall = _fake_recall_at_real_fpr(val_probs, y_val, max_real_fpr=0.10)
    block_t, block_recall = _fake_recall_at_real_fpr(val_probs, y_val, max_real_fpr=0.03)

    best_f1 = -1.0
    server_t = 0.5
    for threshold in np.linspace(0.05, 0.95, 91):
        pred = (val_probs >= threshold).astype(int)
        score = f1_score(y_val, pred, zero_division=0)
        if score > best_f1:
            best_f1 = float(score)
            server_t = float(threshold)

    test_pred = (test_probs >= server_t).astype(int)
    test_f1 = f1_score(y_test, test_pred, zero_division=0)

    payload = {
        "threshold": round(server_t, 4),
        "warn_threshold": round(warn_t, 4),
        "block_threshold": round(block_t, 4),
        "warn_fake_recall_at_val": round(warn_recall, 4),
        "block_fake_recall_at_val": round(block_recall, 4),
        "val_f1_at_threshold": round(best_f1, 4),
        "test_f1_at_threshold": round(float(test_f1), 4),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
