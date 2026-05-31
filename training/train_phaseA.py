"""
train_phaseA.py — Phase A: DINOv2-small + Linear Probe
=======================================================
Input : embeddings/embeddings_phaseA.npz  (N, 384)
Output: models/phaseA_probe.json          (weights for video_classifier.js)

This is the fast baseline — confirms the DINOv2 backbone upgrade
before adding ReStraV plumbing in Phase B.

Usage:
    python training/train_phaseA.py
    python training/train_phaseA.py --val-split 0.2 --calibrate
"""

import argparse
import json
import numpy as np
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, classification_report
from sklearn.calibration import CalibratedClassifierCV
import joblib

EMBED_DIR = Path("embeddings")
MODELS_DIR = Path("models")


def load_embeddings(path):
    data = np.load(path, allow_pickle=True)
    X = data["embeddings"].astype(np.float32)   # (N, 384)
    y = data["labels"].astype(np.int32)
    paths = data["paths"]
    return X, y, paths


def train_phaseA(val_split: float, calibrate: bool, threshold: float):
    MODELS_DIR.mkdir(exist_ok=True)

    npz = EMBED_DIR / "embeddings_phaseA.npz"
    if not npz.exists():
        raise FileNotFoundError("Run embed_dataset.py first.")

    X, y, paths = load_embeddings(npz)
    print(f"Loaded: X={X.shape}, real={int((y==0).sum())}, fake={int((y==1).sum())}")

    # Train / Val split
    X_tr, X_val, y_tr, y_val, p_tr, p_val = train_test_split(
        X, y, paths, test_size=val_split, stratify=y, random_state=42
    )
    print(f"Train: {len(X_tr)}, Val: {len(X_val)}")

    # Scale
    scaler = StandardScaler()
    X_tr_s = scaler.fit_transform(X_tr)
    X_val_s = scaler.transform(X_val)

    # Logistic Regression (strong baseline, fast, exports cleanly)
    clf = LogisticRegression(
        C=1.0,
        max_iter=1000,
        class_weight="balanced",   # handles class imbalance
        solver="lbfgs",
        random_state=42,
    )

    if calibrate:
        # Isotonic calibration for better probability estimates
        clf = CalibratedClassifierCV(clf, method="isotonic", cv=5)

    clf.fit(X_tr_s, y_tr)

    # ─── Evaluation ───────────────────────────────────────────────────────────
    proba_val = clf.predict_proba(X_val_s)[:, 1]
    auc = roc_auc_score(y_val, proba_val)
    pred_val = (proba_val >= threshold).astype(int)

    print(f"\n=== Phase A Val Results ===")
    print(f"AUROC: {auc:.4f}")
    print(f"Threshold: {threshold}")
    print(classification_report(y_val, pred_val, target_names=["real", "fake"]))

    # Per-source breakdown
    _source_breakdown(p_val, y_val, proba_val, threshold)

    # ─── Export probe weights for video_classifier.js ─────────────────────────
    # video_classifier.js expects: { weights, bias, scaler_mean, scaler_std, threshold }
    if calibrate:
        # Extract underlying LR from CalibratedClassifierCV
        inner = clf.calibrated_classifiers_[0].estimator
    else:
        inner = clf

    probe = {
        "phase": "A",
        "model": "dinov2-small",
        "embed_dim": 384,
        "weights": inner.coef_[0].tolist(),       # (384,)
        "bias": float(inner.intercept_[0]),
        "scaler_mean": scaler.mean_.tolist(),      # (384,)
        "scaler_std": scaler.scale_.tolist(),      # (384,)
        "threshold": threshold,
        "auroc_val": round(auc, 4),
        "calibrated": calibrate,
    }

    out_json = MODELS_DIR / "phaseA_probe.json"
    with open(out_json, "w") as f:
        json.dump(probe, f, indent=2)
    print(f"\nExported: {out_json}")

    # Also save sklearn model for eval scripts
    joblib.dump({"clf": clf, "scaler": scaler}, MODELS_DIR / "phaseA_sklearn.pkl")
    print(f"Sklearn model: {MODELS_DIR}/phaseA_sklearn.pkl")
    print("\nNext: python training/extract_restrap_features.py   (Phase B)")


def _source_breakdown(paths, labels, probas, threshold):
    """Print per-source AUC based on path keywords."""
    sources = {
        "celeb_df": [],
        "genvidbench_t2v": [],
        "genvidbench_real": [],
        "vript": [],
        "other": [],
    }
    for p, l, prob in zip(paths, labels, probas):
        p = str(p)
        if "celeb_df/real" in p or "celeb_df/fake" in p:
            k = "celeb_df"
        elif "genvidbench/t2v" in p:
            k = "genvidbench_t2v"
        elif "genvidbench/real" in p:
            k = "genvidbench_real"
        elif "vript" in p:
            k = "vript"
        else:
            k = "other"
        sources[k].append((l, prob))

    print("\n--- Per-source breakdown ---")
    for src, items in sources.items():
        if len(items) < 2:
            continue
        ys = [i[0] for i in items]
        ps = [i[1] for i in items]
        if len(set(ys)) < 2:
            continue
        auc = roc_auc_score(ys, ps)
        fpr = sum(1 for l, p in items if l == 0 and p >= threshold) / max(1, sum(1 for l,_ in items if l==0))
        print(f"  {src:25s}: AUC={auc:.3f}  FPR@thresh={fpr:.3f}  n={len(items)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--calibrate", action="store_true",
                        help="Apply isotonic calibration to probabilities")
    parser.add_argument("--threshold", type=float, default=0.5,
                        help="Decision threshold (tune on val set)")
    args = parser.parse_args()
    train_phaseA(args.val_split, args.calibrate, args.threshold)
