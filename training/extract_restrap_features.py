"""
extract_restrap_features.py — ReStraV Geometry Features (Phase B)
==================================================================
Computes the 21-dimensional ReStraV feature vector from per-frame
DINOv2-small CLS embeddings. These capture temporal trajectory geometry
that CLIP mean-pooling discards.

The 21 features (browser-aligned, 8-10 frames):
    [0-5]   Step statistics: mean, std, min, max, median, IQR of L2 distances
    [6-11]  Curvature stats: mean, std, min, max, median, IQR (angle at each triplet)
    [12-14] Displacement: total path length, net displacement, tortuosity
    [15-17] Speed stats: mean acceleration, jerk (2nd derivative), speed variance
    [18]    PCA variance ratio (1st component explains X% of trajectory)
    [19]    Self-similarity: mean cosine similarity of non-adjacent frames
    [20]    Reversal score: fraction of steps with negative displacement

Input : embeddings/embeddings_phaseB.npz  (N, n_frames, 384)
Output: embeddings/restrap_features.npz   (N, 21)

Usage:
    python training/extract_restrap_features.py
"""

import numpy as np
from pathlib import Path
from tqdm import tqdm
from sklearn.decomposition import PCA

EMBED_DIR = Path("embeddings")


def compute_restrap_21d(traj: np.ndarray) -> np.ndarray:
    """
    traj: (n_frames, 384) L2-normalized DINOv2 CLS embeddings
    Returns: (21,) float32 feature vector
    """
    T, D = traj.shape
    assert T >= 3, "Need at least 3 frames for ReStraV"

    # ─── Step vectors ─────────────────────────────────────────────────────────
    steps = np.diff(traj, axis=0)                # (T-1, D)
    step_norms = np.linalg.norm(steps, axis=1)   # (T-1,)

    # Features 0-5: step distance statistics
    f0 = float(step_norms.mean())
    f1 = float(step_norms.std())
    f2 = float(step_norms.min())
    f3 = float(step_norms.max())
    f4 = float(np.median(step_norms))
    f5 = float(np.percentile(step_norms, 75) - np.percentile(step_norms, 25))

    # ─── Curvature (angle at each interior point) ─────────────────────────────
    angles = []
    for i in range(1, T - 1):
        v1 = steps[i - 1]
        v2 = steps[i]
        n1 = np.linalg.norm(v1)
        n2 = np.linalg.norm(v2)
        if n1 < 1e-8 or n2 < 1e-8:
            angles.append(0.0)
            continue
        cos_a = np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0)
        angles.append(float(np.arccos(cos_a)))
    angles = np.array(angles)

    # Features 6-11: curvature statistics
    f6 = float(angles.mean())
    f7 = float(angles.std())
    f8 = float(angles.min())
    f9 = float(angles.max())
    f10 = float(np.median(angles))
    f11 = float(np.percentile(angles, 75) - np.percentile(angles, 25))

    # ─── Path shape ───────────────────────────────────────────────────────────
    total_path_length = float(step_norms.sum())
    net_displacement = float(np.linalg.norm(traj[-1] - traj[0]))
    tortuosity = total_path_length / (net_displacement + 1e-8)

    # Features 12-14
    f12 = total_path_length
    f13 = net_displacement
    f14 = float(np.clip(tortuosity, 0, 50))  # clip outliers

    # ─── Temporal dynamics ────────────────────────────────────────────────────
    # Acceleration: second derivative of position (diff of step norms)
    accels = np.diff(step_norms)            # (T-2,)
    jerks = np.diff(accels) if len(accels) > 1 else np.array([0.0])

    # Features 15-17
    f15 = float(np.abs(accels).mean())
    f16 = float(np.abs(jerks).mean()) if len(jerks) > 0 else 0.0
    f17 = float(step_norms.var())

    # ─── PCA variance ratio ───────────────────────────────────────────────────
    # How much variance the first PCA component explains
    if T >= 3 and D >= 2:
        pca = PCA(n_components=min(T, 3))
        pca.fit(traj)
        f18 = float(pca.explained_variance_ratio_[0])
    else:
        f18 = 1.0

    # ─── Self-similarity (non-adjacent frames) ────────────────────────────────
    sim_scores = []
    for i in range(T):
        for j in range(i + 2, T):   # skip adjacent
            sim = float(np.dot(traj[i], traj[j]))   # already L2-normalized
            sim_scores.append(sim)
    f19 = float(np.mean(sim_scores)) if sim_scores else 0.0

    # ─── Reversal score ───────────────────────────────────────────────────────
    # Fraction of consecutive step pairs that "reverse" direction (cos < 0)
    reversals = (np.cos([a for a in angles]) < 0).mean() if len(angles) > 0 else 0.0
    f20 = float(reversals)

    feat = np.array([
        f0, f1, f2, f3, f4, f5,       # step stats
        f6, f7, f8, f9, f10, f11,     # curvature stats
        f12, f13, f14,                 # path shape
        f15, f16, f17,                 # dynamics
        f18, f19, f20,                 # PCA, self-sim, reversal
    ], dtype=np.float32)

    return feat


def extract_all():
    npz = EMBED_DIR / "embeddings_phaseB.npz"
    if not npz.exists():
        raise FileNotFoundError("Run embed_dataset.py first.")

    data = np.load(npz, allow_pickle=True)
    embeddings = data["embeddings"]   # (N, n_frames, 384)
    labels = data["labels"]
    paths = data["paths"]
    N = len(embeddings)

    print(f"Computing ReStraV features for {N} videos ...")
    features = []
    failed = 0

    for i in tqdm(range(N)):
        traj = embeddings[i].astype(np.float32)   # (n_frames, 384)
        try:
            feat = compute_restrap_21d(traj)
            features.append(feat)
        except Exception as e:
            features.append(np.zeros(21, dtype=np.float32))
            failed += 1

    features = np.stack(features, axis=0)   # (N, 21)
    print(f"\nFeatures: {features.shape}, failed: {failed}")
    print(f"Feature means: {features.mean(axis=0).round(4)}")

    out = EMBED_DIR / "restrap_features.npz"
    np.savez_compressed(out, features=features, labels=labels, paths=paths)
    print(f"Saved: {out}")
    print("\nNext: python training/train_phaseB.py")


if __name__ == "__main__":
    extract_all()
