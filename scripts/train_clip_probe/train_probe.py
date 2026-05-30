"""Train a logistic regression probe on cached CLIP video embeddings."""

from __future__ import annotations

import argparse
import pickle
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


DEFAULT_CACHE = Path("cache/train_embs.pkl")
DEFAULT_BROWSER_CACHE = Path("cache/train_embs_browser.pkl")
DEFAULT_MODEL = Path("cache/clip_probe.joblib")
DEFAULT_BROWSER_MODEL = Path("cache/clip_probe_browser.joblib")


def _build_logistic_pipeline() -> Pipeline:
    return Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(class_weight="balanced", max_iter=2000)),
    ])


def _build_xgb_pipeline(y_train: np.ndarray):
    try:
        from xgboost import XGBClassifier
    except ImportError as err:
        raise SystemExit("xgboost is required for --use-xgboost (pip install xgboost)") from err

    pos = max(1, int((y_train == 1).sum()))
    neg = max(1, int((y_train == 0).sum()))
    return Pipeline([
        ("scaler", StandardScaler()),
        ("clf", XGBClassifier(
            max_depth=4,
            n_estimators=200,
            learning_rate=0.05,
            scale_pos_weight=neg / pos,
            eval_metric="logloss",
            random_state=42,
        )),
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--use-xgboost", action="store_true")
    args = parser.parse_args()

    out = args.out or (
        DEFAULT_BROWSER_MODEL if "browser" in args.cache.name else DEFAULT_MODEL
    )

    with args.cache.open("rb") as fh:
        data = pickle.load(fh)

    x = data["embeddings"]
    y = data["labels"]
    if len(np.unique(y)) < 2:
        raise SystemExit("Need both positive and negative labels to train.")

    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=args.test_size, random_state=args.seed, stratify=y
    )

    logistic = _build_logistic_pipeline()
    logistic.fit(x_train, y_train)
    logistic_probs = logistic.predict_proba(x_test)[:, 1]
    logistic_auc = roc_auc_score(y_test, logistic_probs)
    print(f"LogisticRegression AUC-ROC: {logistic_auc:.4f}")

    chosen = logistic
    if args.use_xgboost:
        xgb = _build_xgb_pipeline(y_train)
        xgb.fit(x_train, y_train)
        xgb_probs = xgb.predict_proba(x_test)[:, 1]
        xgb_auc = roc_auc_score(y_test, xgb_probs)
        print(f"XGBoost AUC-ROC: {xgb_auc:.4f}")
        if xgb_auc > logistic_auc:
            print("XGBoost wins on held-out AUC (still exporting linear probe for runtime)")
        else:
            print("LogisticRegression wins on held-out AUC")

    out.parent.mkdir(parents=True, exist_ok=True)
    bundle = {
        "pipeline": chosen,
        "metadata": data,
        "metrics": {"logistic_auc": float(logistic_auc)},
    }
    if args.use_xgboost:
        bundle["xgb_pipeline"] = xgb
        bundle["metrics"]["xgb_auc"] = float(xgb_auc)
    joblib.dump(bundle, out)
    print(f"Saved probe pipeline to {out}")


if __name__ == "__main__":
    main()
