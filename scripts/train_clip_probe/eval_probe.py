"""Evaluate a trained probe on cached embeddings (offline metrics)."""

from __future__ import annotations

import argparse
import pickle
from pathlib import Path

import joblib
import numpy as np
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split


DEFAULT_CACHE = Path("cache/train_embs.pkl")
DEFAULT_MODEL = Path("cache/clip_probe.joblib")
THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.9]


def _percentile(arr: np.ndarray, pct: float) -> float:
    if not len(arr):
        return 0.0
    return float(np.percentile(arr, pct))


def _metrics_at_threshold(probs: np.ndarray, labels: np.ndarray, threshold: float) -> dict:
    pred = (probs >= threshold).astype(int)
    fake_mask = labels == 1
    real_mask = labels == 0
    fake_recall = float(pred[fake_mask].mean()) if fake_mask.any() else 0.0
    real_spec = float(1.0 - pred[real_mask].mean()) if real_mask.any() else 0.0
    return {
        "threshold": threshold,
        "accuracy": float(accuracy_score(labels, pred)),
        "fake_recall": fake_recall,
        "real_specificity": real_spec,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--model", type=Path, default=None, help="Optional joblib pipeline")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    with args.cache.open("rb") as fh:
        data = pickle.load(fh)

    x = np.asarray(data["embeddings"], dtype=np.float32)
    y = np.asarray(data["labels"], dtype=np.int32)

    if args.model and args.model.is_file():
        pipe = joblib.load(args.model)["pipeline"]
        probs = pipe.predict_proba(x)[:, 1]
        split_label = "full-set (trained model)"
    else:
        _, x_test, _, y_test = train_test_split(
            x, y, test_size=args.test_size, random_state=args.seed, stratify=y
        )
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        x_train, _, y_train, _ = train_test_split(
            x, y, test_size=args.test_size, random_state=args.seed, stratify=y
        )
        pipe = Pipeline([
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(class_weight="balanced", max_iter=2000)),
        ])
        pipe.fit(x_train, y_train)
        probs = pipe.predict_proba(x_test)[:, 1]
        y = y_test
        split_label = f"held-out {int(args.test_size * 100)}%"

    auc = roc_auc_score(y, probs)
    fake_probs = probs[y == 1]
    real_probs = probs[y == 0]

    print(f"Eval split: {split_label}")
    print(f"Samples: {len(y)} (fake={int((y == 1).sum())}, real={int((y == 0).sum())})")
    print(f"AUC-ROC: {auc:.4f}")
    print()
    print("Score distribution:")
    print(
        f"  fake  mean={fake_probs.mean():.3f}  p50={_percentile(fake_probs, 50):.3f}  "
        f"p90={_percentile(fake_probs, 90):.3f}"
    )
    print(
        f"  real  mean={real_probs.mean():.3f}  p50={_percentile(real_probs, 50):.3f}  "
        f"p90={_percentile(real_probs, 90):.3f}"
    )
    print(
        f"  fake >=90%: {(fake_probs >= 0.9).mean():.1%}  "
        f"real >=90%: {(real_probs >= 0.9).mean():.1%}"
    )
    print()
    print("Threshold sweep:")
    for threshold in THRESHOLDS:
        m = _metrics_at_threshold(probs, y, threshold)
        print(
            f"  t={m['threshold']:.1f}  acc={m['accuracy']:.3f}  "
            f"fake_recall={m['fake_recall']:.3f}  real_spec={m['real_specificity']:.3f}"
        )


if __name__ == "__main__":
    main()
