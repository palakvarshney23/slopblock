"""
retrain_incremental.py — SlopBlock Incremental Retraining
==========================================================
1. Loads old embeddings from embeddings_phaseB.npz
2. Scans data/ai_generated/ and data/real/ for NEW videos (via MD5 hash)
3. Extracts 8 frames → DINOv2 embed → ReStraV 21-d features
4. Merges old + new embeddings (old knowledge never lost)
5. Fine-tunes from phaseB_model.pt checkpoint (warm start, low LR)
6. Saves versioned: phaseB_probe_v{N}.json, phaseB_model_v{N}.pt
7. Auto-deletes raw videos whose embeddings are safely stored

USAGE:
  python retrain_incremental.py
  python retrain_incremental.py --dry-run
"""
import os
import sys
import json
import hashlib
import time
import shutil
import argparse
from pathlib import Path
from datetime import datetime

import numpy as np
import cv2
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset
from transformers import AutoModel, AutoImageProcessor
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, roc_auc_score
from tqdm import tqdm

# -- Config ----------------------------------------------------------------
DATA_DIR       = Path("data")
EMBEDDINGS_DIR = Path("embeddings")
MODELS_DIR     = Path("models")

AI_SUBDIR   = "ai_generated"
REAL_SUBDIR = "real"
N_FRAMES    = 8
DINO_MODEL  = "facebook/dinov2-small"
EMBED_DIM   = 384          # DINOv2-small CLS
RESTRAV_DIM = 21           # ReStraV geometry features
INPUT_DIM   = EMBED_DIM + RESTRAV_DIM   # 405

EPOCHS     = 30
BATCH_SIZE = 64
LR         = 1e-4          # low LR to preserve old knowledge
HIDDEN     = 128
DROPOUT    = 0.3

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


# -- Model (matches existing train_phaseB.py exactly) --------------------
class ReStraVMLP(nn.Module):
    def __init__(self, in_dim=INPUT_DIM, hidden=HIDDEN, dropout=DROPOUT):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(64, 1),
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)


# -- Utilities -----------------------------------------------------------
def file_hash(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def extract_frames(video_path: Path, n_frames=N_FRAMES):
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total < n_frames:
        cap.release()
        return None
    indices = np.linspace(0, total - 1, n_frames, dtype=int)
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ret, frame = cap.read()
        if ret:
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    cap.release()
    return frames


def load_dino(device):
    print("  Loading DINOv2-small...")
    processor = AutoImageProcessor.from_pretrained(DINO_MODEL)
    model = AutoModel.from_pretrained(DINO_MODEL).to(device).eval()
    return processor, model


@torch.no_grad()
def embed_frames(frames, processor, dino_model, device):
    """Returns (n_frames, 384) CLS embeddings, L2-normalized."""
    pil_frames = [Image.fromarray(f) for f in frames]
    inputs = processor(images=pil_frames, return_tensors="pt").to(device)
    outputs = dino_model(**inputs)
    cls = outputs.last_hidden_state[:, 0, :]          # (N, 384)
    cls = F.normalize(cls, dim=-1)                    # L2-normalize
    return cls.cpu().float().numpy()


def compute_restrav21d(emb_traj):
    """
    Compute 21-d ReStraV geometry from (T, 384) embedding trajectory.
    Matches training/extract_restrap_features.py exactly.
    """
    T = emb_traj.shape[0]
    D = emb_traj.shape[1]

    # Step vectors and norms
    steps = []
    for i in range(T - 1):
        s = emb_traj[i + 1] - emb_traj[i]
        steps.append(s)
    stepNorms = [np.linalg.norm(s) for s in steps]

    def stats(arr):
        arr = np.array(arr)
        n = len(arr)
        mean = arr.mean()
        std = arr.std()
        minv = arr.min()
        maxv = arr.max()
        sorted_arr = np.sort(arr)
        median = sorted_arr[n // 2] if n % 2 else (sorted_arr[n // 2 - 1] + sorted_arr[n // 2]) / 2
        q1 = sorted_arr[int(n * 0.25)]
        q3 = sorted_arr[int(n * 0.75)]
        iqr = q3 - q1
        return [mean, std, minv, maxv, median, iqr]

    # 0-5: step stats
    stepStats = stats(stepNorms)

    # 6-11: curvature angles
    angles = []
    for i in range(1, T - 1):
        v1 = steps[i - 1]
        v2 = steps[i]
        n1 = np.linalg.norm(v1)
        n2 = np.linalg.norm(v2)
        if n1 < 1e-8 or n2 < 1e-8:
            angles.append(0)
            continue
        cosA = np.clip(np.dot(v1, v2) / (n1 * n2), -1, 1)
        angles.append(np.arccos(cosA))
    angleStats = stats(angles if angles else [0])

    # 12-14: path shape
    totalLen = sum(stepNorms)
    diff = emb_traj[-1] - emb_traj[0]
    netDisp = np.linalg.norm(diff)
    tortuosity = min(50, totalLen / (netDisp + 1e-8))

    # 15-17: temporal dynamics
    accels = [abs(stepNorms[i + 1] - stepNorms[i]) for i in range(len(stepNorms) - 1)]
    jerks = [abs(accels[i + 1] - accels[i]) for i in range(len(accels) - 1)]
    meanAccel = np.mean(accels) if accels else 0
    meanJerk = np.mean(jerks) if jerks else 0
    meanSpeed = np.mean(stepNorms)
    speedVar = np.var(stepNorms)

    # 18: PCA variance ratio (first PC) — power iteration
    centered = emb_traj - emb_traj.mean(axis=0)
    vec = np.random.randn(D)
    vec = vec / (np.linalg.norm(vec) + 1e-8)
    for _ in range(5):
        mv = centered @ vec
        new_vec = centered.T @ mv
        vecNorm = np.linalg.norm(new_vec)
        vec = new_vec / (vecNorm + 1e-8)
    projVar = np.sum((centered @ vec) ** 2)
    totalVar = np.sum(centered ** 2)
    f18 = min(1, projVar / (totalVar + 1e-8)) if totalVar > 0 else 1

    # 19: self-similarity (non-adjacent)
    simScores = []
    for i in range(T):
        for j in range(i + 2, T):
            simScores.append(np.dot(emb_traj[i], emb_traj[j]))
    f19 = np.mean(simScores) if simScores else 0

    # 20: reversal score
    cosCurv = [np.cos(a) for a in angles]
    f20 = sum(1 for c in cosCurv if c < 0) / len(cosCurv) if cosCurv else 0

    return np.array([
        *stepStats,      # 0-5
        *angleStats,     # 6-11
        totalLen, netDisp, tortuosity,  # 12-14
        meanAccel, meanJerk, speedVar,  # 15-17
        f18, f19, f20,                   # 18-20
    ], dtype=np.float32)


def find_new_videos(data_dir: Path, old_hashes: set) -> dict:
    result = {"ai": [], "real": []}
    for subdir, label_key in [(AI_SUBDIR, "ai"), (REAL_SUBDIR, "real")]:
        folder = data_dir / subdir
        if not folder.exists():
            continue
        for ext in VIDEO_EXTS:
            for vpath in folder.rglob(f"*{ext}"):
                if vpath.is_file():
                    h = file_hash(vpath)
                    if h not in old_hashes:
                        result[label_key].append((vpath, h))
    return result


def load_old_embeddings():
    npz_path = EMBEDDINGS_DIR / "embeddings_phaseB.npz"
    if not npz_path.exists():
        print("  No existing embeddings — starting fresh.")
        return np.zeros((0, N_FRAMES, EMBED_DIM), np.float32), \
               np.zeros((0, RESTRAV_DIM), np.float32), \
               np.zeros(0, np.int64), set()

    data = np.load(npz_path, allow_pickle=True)
    emb = data["embeddings"]      # (N, 8, 384)
    labels = data["labels"]       # (N,)
    paths = data["paths"]         # (N,)

    # Compute hashes from paths (re-hashing for consistency)
    hashes = set()
    for p in paths:
        p = Path(str(p))
        if p.exists():
            hashes.add(file_hash(p))
        else:
            # Fallback: hash the path string itself
            hashes.add(hashlib.md5(str(p).encode()).hexdigest())

    # Compute ReStraV from per-frame embeddings
    restrav = np.array([compute_restrav21d(e) for e in emb], dtype=np.float32)

    print(f"  Loaded old: {len(labels)} samples ({int(labels.sum())} AI, {int((labels==0).sum())} real)")
    return emb, restrav, labels, hashes


def embed_new_videos(new_videos: dict, processor, dino_model, device):
    all_emb, all_rstv, all_lbl, all_ids, failed = [], [], [], [], []

    entries = [(p, h, 1) for p, h in new_videos["ai"]] + \
              [(p, h, 0) for p, h in new_videos["real"]]

    if not entries:
        return None, None, None, None, []

    for vpath, vid_hash, label in tqdm(entries, desc="  Embedding new videos"):
        frames = extract_frames(vpath)
        if frames is None or len(frames) != N_FRAMES:
            failed.append(vpath)
            continue

        try:
            frame_embs = embed_frames(frames, processor, dino_model, device)  # (8, 384)
            rstv = compute_restrav21d(frame_embs)

            all_emb.append(frame_embs)
            all_rstv.append(rstv)
            all_lbl.append(label)
            all_ids.append(vid_hash)
        except Exception as e:
            print(f"    Error embedding {vpath.name}: {e}")
            failed.append(vpath)

    if not all_emb:
        return None, None, None, None, failed

    return (np.stack(all_emb, axis=0),
            np.array(all_rstv, dtype=np.float32),
            np.array(all_lbl, dtype=np.int64),
            all_ids, failed)


def export_probe_json(model, scaler, threshold, version, out_path: Path):
    """Export probe in the exact format video_classifier.js expects."""
    probe = {
        "phase": "B",
        "model": "dinov2-small+restrap21",
        "embed_dim": EMBED_DIM,
        "restrap_dim": RESTRAV_DIM,
        "input_dim": INPUT_DIM,
        "threshold": threshold,
        "version": version,
        "trained_at": datetime.now().isoformat(),
        "layers": [],
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_std": scaler.scale_.tolist(),
    }

    for name, module in model.net.named_children():
        if isinstance(module, nn.Linear):
            probe["layers"].append({
                "type": "linear",
                "weight": module.weight.detach().cpu().tolist(),
                "bias": module.bias.detach().cpu().tolist(),
            })
        elif isinstance(module, nn.LayerNorm):
            probe["layers"].append({
                "type": "layernorm",
                "weight": module.weight.detach().cpu().tolist(),
                "bias": module.bias.detach().cpu().tolist(),
                "eps": module.eps,
            })
        elif isinstance(module, nn.GELU):
            probe["layers"].append({"type": "gelu"})
        elif isinstance(module, nn.Dropout):
            probe["layers"].append({"type": "dropout"})

    with open(out_path, "w") as f:
        json.dump(probe, f, indent=2)
    return out_path


def finetune(emb, restrav, labels, version, device):
    # Mean-pool embeddings for Phase A input
    mean_emb = emb.mean(axis=1)  # (N, 384)
    X = np.concatenate([mean_emb, restrav], axis=1).astype(np.float32)
    y = labels.astype(np.float32)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Train/val split (stratified)
    from sklearn.model_selection import train_test_split
    n = len(y)
    indices = np.arange(n)
    idx_tr, idx_val = train_test_split(indices, test_size=0.2, stratify=y, random_state=42)

    X_tr, X_val = X_scaled[idx_tr], X_scaled[idx_val]
    y_tr, y_val = y[idx_tr], y[idx_val]

    # Datasets
    tr_ds = TensorDataset(torch.from_numpy(X_tr), torch.from_numpy(y_tr))
    tr_dl = DataLoader(tr_ds, batch_size=BATCH_SIZE, shuffle=True)
    X_val_t = torch.from_numpy(X_val).to(device)
    y_val_np = y_val

    # Class weights for imbalance
    n_real = int((y_tr == 0).sum())
    n_fake = int((y_tr == 1).sum())
    pos_weight = torch.tensor([n_real / max(n_fake, 1)], device=device)

    model = ReStraVMLP().to(device)

    # Load checkpoint
    ckpt_path = MODELS_DIR / "phaseB_model.pt"
    if ckpt_path.exists():
        try:
            state = torch.load(ckpt_path, map_location=device)
            model.load_state_dict(state)
            print(f"  Warm-started from {ckpt_path.name}")
        except Exception as e:
            print(f"  Could not load checkpoint: {e}")
    else:
        print("  No checkpoint found — training from scratch")

    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)

    best_auc = 0.0
    best_state = None

    print(f"\n  Fine-tuning {EPOCHS} epochs (LR={LR}, hidden={HIDDEN})...")
    for epoch in range(1, EPOCHS + 1):
        model.train()
        total_loss = 0.0
        for xb, yb in tr_dl:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(xb)
        scheduler.step()

        # Val
        model.eval()
        with torch.no_grad():
            logits_val = model(X_val_t).cpu().numpy()
        proba_val = torch.sigmoid(torch.from_numpy(logits_val)).numpy()
        auc = roc_auc_score(y_val_np, proba_val)

        if auc > best_auc:
            best_auc = auc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

        if epoch % 5 == 0 or epoch == 1:
            avg_loss = total_loss / len(tr_ds)
            print(f"    Epoch {epoch:3d}: loss={avg_loss:.4f}, val_AUC={auc:.4f}")

    # Load best
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        logits_val = model(X_val_t).cpu().numpy()
    proba_val = torch.sigmoid(torch.from_numpy(logits_val)).numpy()

    # Youden's J for threshold
    from sklearn.metrics import roc_curve
    fpr, tpr, thresholds = roc_curve(y_val_np, proba_val)
    j_scores = tpr - fpr
    best_thresh = thresholds[np.argmax(j_scores)]

    # Evaluate
    pred_val = (proba_val >= best_thresh).astype(int)
    acc = accuracy_score(y_val_np, pred_val)
    print(f"\n  Best val AUROC: {best_auc:.4f}")
    print(f"  Threshold: {best_thresh:.3f}, Accuracy: {acc:.3f}")

    # Save versioned outputs
    suffix = f"_v{version}" if version > 1 else ""

    # Checkpoint
    ckpt_out = MODELS_DIR / f"phaseB_model{suffix}.pt"
    torch.save(best_state, ckpt_out)
    print(f"  Saved: {ckpt_out.name}")

    # Probe JSON
    probe_out = MODELS_DIR / f"phaseB_probe{suffix}.json"
    export_probe_json(model, scaler, float(best_thresh), version, probe_out)
    size_kb = probe_out.stat().st_size / 1024
    print(f"  Saved: {probe_out.name} ({size_kb:.1f} KB)")

    # Scaler
    import joblib
    scaler_out = MODELS_DIR / f"phaseB_scaler{suffix}.pkl"
    joblib.dump(scaler, scaler_out)

    return model, scaler, probe_out, ckpt_out


def save_merged_embeddings(emb, restrav, labels, video_ids, version):
    suffix = f"_v{version}" if version > 1 else ""
    out_path = EMBEDDINGS_DIR / f"embeddings_phaseB{suffix}.npz"

    np.savez_compressed(
        out_path,
        embeddings=emb,          # (N, 8, 384)
        labels=labels,
        video_ids=np.array(video_ids),
    )
    size_mb = out_path.stat().st_size / (1024 ** 2)
    print(f"  Saved embeddings: {out_path.name} ({len(labels)} samples, {size_mb:.1f} MB)")
    return out_path


def delete_processed_videos(new_videos: dict, failed: list):
    failed_set = set(str(p) for p in failed)
    deleted, skipped = 0, 0

    entries = [(p, h) for p, h in new_videos["ai"]] + \
              [(p, h) for p, h in new_videos["real"]]

    for vpath, _ in entries:
        if str(vpath) in failed_set:
            skipped += 1
            continue
        try:
            vpath.unlink()
            deleted += 1
        except Exception as e:
            print(f"  Could not delete {vpath.name}: {e}")
            skipped += 1

    print(f"  Deleted {deleted} videos, kept {skipped} (failed/skipped)")


def next_version() -> int:
    existing = list(MODELS_DIR.glob("phaseB_probe_v*.json"))
    if not existing:
        return 2
    nums = []
    for p in existing:
        try:
            nums.append(int(p.stem.split("_v")[-1]))
        except ValueError:
            pass
    return max(nums, default=1) + 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    dry = args.dry_run

    print("=" * 60)
    print("  SlopBlock Incremental Retraining")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if dry:
        print("  [DRY RUN — no files modified]")
    print("=" * 60)

    # Safety checks
    for d in [DATA_DIR, EMBEDDINGS_DIR, MODELS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    essential = MODELS_DIR / "phaseB_probe.json"
    if not essential.exists():
        print(f"\n  ERROR: {essential} not found. Cannot retrain.")
        sys.exit(1)

    version = next_version()
    print(f"\n  Output version: v{version}")

    # Load old embeddings
    print("\n[1/5] Loading old embeddings...")
    old_emb, old_rstv, old_lbl, old_hashes = load_old_embeddings()

    # Find new videos
    print("\n[2/5] Scanning for new videos...")
    new_videos = find_new_videos(DATA_DIR, old_hashes)
    n_new = len(new_videos["ai"]) + len(new_videos["real"])
    print(f"  New AI: {len(new_videos['ai'])}, New real: {len(new_videos['real'])} (total: {n_new})")

    if n_new == 0:
        print("\n  Nothing to do — all videos already embedded.")
        sys.exit(0)

    if dry:
        print(f"\n  [DRY RUN] Would embed {n_new} videos and retrain.")
        sys.exit(0)

    # Device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n  Device: {device}")

    # Load DINOv2
    print("\n[3/5] Loading DINOv2...")
    processor, dino_model = load_dino(device)

    # Embed new videos
    print(f"\n[4/5] Embedding {n_new} new videos...")
    new_emb, new_rstv, new_lbl, new_ids, failed = embed_new_videos(
        new_videos, processor, dino_model, device
    )

    if new_emb is None or len(new_lbl) == 0:
        print("\n  ERROR: No new embeddings produced. Aborting.")
        sys.exit(1)

    print(f"  Embedded {len(new_lbl)}/{n_new} videos successfully")
    if failed:
        print(f"  {len(failed)} videos failed (kept, not deleted)")

    # Merge
    print("\n[5/5] Merging & fine-tuning...")
    merged_emb  = np.concatenate([old_emb, new_emb], axis=0) if len(old_lbl) > 0 else new_emb
    merged_rstv = np.concatenate([old_rstv, new_rstv], axis=0) if len(old_lbl) > 0 else new_rstv
    merged_lbl  = np.concatenate([old_lbl, new_lbl], axis=0) if len(old_lbl) > 0 else new_lbl
    merged_ids  = list(old_hashes) + list(new_ids) if len(old_lbl) > 0 else list(new_ids)

    # Save merged embeddings
    emb_path = save_merged_embeddings(merged_emb, merged_rstv, merged_lbl, merged_ids, version)

    # Fine-tune
    model, scaler, probe_path, ckpt_path = finetune(
        merged_emb, merged_rstv, merged_lbl, version, device
    )

    # Delete processed videos (newly embedded ones)
    print("\n  Cleaning up raw videos...")
    delete_processed_videos(new_videos, failed)

    # Delete ALL remaining raw videos (old ones already in .npz are safe to remove)
    print("\n  Removing all remaining raw video files...")
    all_deleted = 0
    for subdir in (DATA_DIR / AI_SUBDIR, DATA_DIR / REAL_SUBDIR):
        if subdir.exists():
            for f in subdir.rglob("*"):
                if f.is_file() and f.suffix.lower() in {".mp4",".avi",".mov",".mkv",".webm"}:
                    try:
                        f.unlink()
                        all_deleted += 1
                    except Exception as e:
                        print(f"    Could not delete {f.name}: {e}")
    print(f"  Deleted {all_deleted} remaining raw videos.")

    # Summary
    print("\n" + "=" * 60)
    print("  ✅ Incremental retraining complete!")
    print(f"  Version:        v{version}")
    print(f"  New probe:      {probe_path.name}")
    print(f"  New checkpoint: {ckpt_path.name}")
    print(f"  New embeddings: {emb_path.name}")
    print(f"  Total samples:  {len(merged_lbl)} ({int(merged_lbl.sum())} AI / {int((merged_lbl==0).sum())} real)")
    print(f"\n  Update video_classifier.js to load:")
    print(f"    '{probe_path.name}'")
    print("=" * 60)


if __name__ == "__main__":
    main()
