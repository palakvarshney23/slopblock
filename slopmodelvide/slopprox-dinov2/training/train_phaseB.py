"""
train_phaseB.py — Phase B: DINOv2-small + ReStraV MLP
=======================================================
Combines:
  - Mean-pooled DINOv2 CLS embedding (384-d)
  - ReStraV 21-d temporal geometry features

Trains a small MLP head and exports weights to JSON for video_classifier.js.

Usage:
    python training/train_phaseB.py
    python training/train_phaseB.py --epochs 50 --lr 1e-3 --threshold 0.45
"""

import argparse
import json
import numpy as np
from pathlib import Path
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, classification_report
import joblib

EMBED_DIR = Path("embeddings")
MODELS_DIR = Path("models")


# ─── Model ────────────────────────────────────────────────────────────────────

class ReStraVMLP(nn.Module):
    """
    Input: 384 (DINOv2 CLS mean-pooled) + 21 (ReStraV) = 405-d
    Three-layer MLP with dropout, exports cleanly to JSON.
    """
    def __init__(self, in_dim: int = 405, hidden: int = 128, dropout: float = 0.3):
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


# ─── Training ─────────────────────────────────────────────────────────────────

def load_data():
    a_npz = EMBED_DIR / "embeddings_phaseA.npz"
    b_npz = EMBED_DIR / "restrap_features.npz"
    if not a_npz.exists() or not b_npz.exists():
        raise FileNotFoundError(
            "Run embed_dataset.py and extract_restrap_features.py first."
        )
    data_a = np.load(a_npz, allow_pickle=True)
    data_b = np.load(b_npz, allow_pickle=True)

    # Align (same ordering guaranteed if both produced from same manifest)
    emb = data_a["embeddings"].astype(np.float32)    # (N, 384)
    rst = data_b["features"].astype(np.float32)       # (N, 21)
    labels = data_a["labels"].astype(np.float32)
    paths = data_a["paths"]

    assert len(emb) == len(rst), "Embedding/feature count mismatch — re-run both scripts."
    X = np.concatenate([emb, rst], axis=1)            # (N, 405)
    return X, labels, paths


def train_phaseB(
    val_split: float,
    epochs: int,
    lr: float,
    batch_size: int,
    hidden: int,
    dropout: float,
    threshold: float,
):
    MODELS_DIR.mkdir(exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    X, y, paths = load_data()
    print(f"Loaded: X={X.shape}, real={int((y==0).sum())}, fake={int((y==1).sum())}")

    X_tr, X_val, y_tr, y_val, p_tr, p_val = train_test_split(
        X, y, paths, test_size=val_split, stratify=y, random_state=42
    )

    # Scale
    scaler = StandardScaler()
    X_tr_s = scaler.fit_transform(X_tr).astype(np.float32)
    X_val_s = scaler.transform(X_val).astype(np.float32)

    # Datasets
    tr_ds = TensorDataset(
        torch.from_numpy(X_tr_s),
        torch.from_numpy(y_tr.astype(np.float32)),
    )
    tr_dl = DataLoader(tr_ds, batch_size=batch_size, shuffle=True, num_workers=2)

    # Class weights for imbalanced data
    n_real = int((y_tr == 0).sum())
    n_fake = int((y_tr == 1).sum())
    pos_weight = torch.tensor([n_real / max(n_fake, 1)], device=device)

    model = ReStraVMLP(in_dim=X.shape[1], hidden=hidden, dropout=dropout).to(device)
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    # ─── Training loop ────────────────────────────────────────────────────────
    best_auc = 0.0
    best_state = None

    X_val_t = torch.from_numpy(X_val_s).to(device)
    y_val_np = y_val

    print(f"\nTraining {epochs} epochs, lr={lr}, hidden={hidden}, batch={batch_size}")
    for epoch in range(1, epochs + 1):
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

        # Val AUC
        model.eval()
        with torch.no_grad():
            logits_val = model(X_val_t).cpu().numpy()
        proba_val = torch.sigmoid(torch.from_numpy(logits_val)).numpy()
        auc = roc_auc_score(y_val_np, proba_val)

        if epoch % 10 == 0 or epoch == 1:
            avg_loss = total_loss / len(tr_ds)
            print(f"  Epoch {epoch:3d}: loss={avg_loss:.4f}, val_AUC={auc:.4f}")

        if auc > best_auc:
            best_auc = auc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

    # Load best
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        logits_val = model(X_val_t).cpu().numpy()
    proba_val = torch.sigmoid(torch.from_numpy(logits_val)).numpy()
    pred_val = (proba_val >= threshold).astype(int)

    print(f"\n=== Phase B Best Val Results ===")
    print(f"AUROC: {best_auc:.4f}")
    print(f"Threshold: {threshold}")
    print(classification_report(y_val_np, pred_val, target_names=["real", "fake"]))

    _source_breakdown(p_val, y_val_np, proba_val, threshold)

    # ─── Export for video_classifier.js ──────────────────────────────────────
    # Serialize MLP weights layer by layer
    layers = []
    for name, module in model.net.named_children():
        if isinstance(module, nn.Linear):
            layers.append({
                "type": "linear",
                "weight": module.weight.detach().cpu().tolist(),
                "bias": module.bias.detach().cpu().tolist(),
            })
        elif isinstance(module, nn.LayerNorm):
            layers.append({
                "type": "layernorm",
                "weight": module.weight.detach().cpu().tolist(),
                "bias": module.bias.detach().cpu().tolist(),
                "eps": module.eps,
            })
        elif isinstance(module, nn.GELU):
            layers.append({"type": "gelu"})
        elif isinstance(module, nn.Dropout):
            layers.append({"type": "dropout"})   # skipped at inference

    probe = {
        "phase": "B",
        "model": "dinov2-small+restrap21",
        "embed_dim": 384,
        "restrap_dim": 21,
        "input_dim": X.shape[1],
        "layers": layers,
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_std": scaler.scale_.tolist(),
        "threshold": threshold,
        "auroc_val": round(best_auc, 4),
    }

    out_json = MODELS_DIR / "phaseB_probe.json"
    with open(out_json, "w") as f:
        json.dump(probe, f, indent=2)
    print(f"\nExported: {out_json}")

    # Save full sklearn scaler + torch model
    joblib.dump(scaler, MODELS_DIR / "phaseB_scaler.pkl")
    torch.save(best_state, MODELS_DIR / "phaseB_model.pt")
    print(f"Torch weights: {MODELS_DIR}/phaseB_model.pt")
    print("\nNext: node js/embed_and_classify.js   (test live video)")


def _source_breakdown(paths, labels, probas, threshold):
    sources = {"celeb_df": [], "t2v": [], "genvidbench_real": [], "vript": [], "other": []}
    for p, l, prob in zip(paths, labels, probas):
        p = str(p)
        if "celeb_df" in p:
            k = "celeb_df"
        elif "t2v" in p or "genvidbench/t2v" in p:
            k = "t2v"
        elif "genvidbench/real" in p:
            k = "genvidbench_real"
        elif "vript" in p:
            k = "vript"
        else:
            k = "other"
        sources[k].append((l, prob))

    print("\n--- Per-source breakdown ---")
    for src, items in sources.items():
        if len(items) < 2 or len(set(i[0] for i in items)) < 2:
            continue
        ys = [i[0] for i in items]
        ps = [i[1] for i in items]
        auc = roc_auc_score(ys, ps)
        fpr = sum(1 for l, p in items if l == 0 and p >= threshold) / max(1, sum(1 for l,_ in items if l==0))
        print(f"  {src:25s}: AUC={auc:.3f}  FPR@thresh={fpr:.3f}  n={len(items)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--lr", type=float, default=5e-4)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--hidden", type=int, default=128)
    parser.add_argument("--dropout", type=float, default=0.3)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()

    train_phaseB(
        args.val_split, args.epochs, args.lr,
        args.batch_size, args.hidden, args.dropout, args.threshold,
    )
