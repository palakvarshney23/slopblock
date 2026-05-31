"""
Hyperparameter sweep for Phase B to find best model
"""
import numpy as np
from pathlib import Path
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score
import json

EMBED_DIR = Path("embeddings")
MODELS_DIR = Path("models")

class ReStraVMLP(nn.Module):
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

def load_data():
    a_npz = EMBED_DIR / "embeddings_phaseA.npz"
    b_npz = EMBED_DIR / "restrap_features.npz"
    data_a = np.load(a_npz, allow_pickle=True)
    data_b = np.load(b_npz, allow_pickle=True)
    emb = data_a["embeddings"].astype(np.float32)
    rst = data_b["features"].astype(np.float32)
    labels = data_a["labels"].astype(np.float32)
    X = np.concatenate([emb, rst], axis=1)
    return X, labels

def train_and_eval(X, y, val_split, epochs, lr, batch_size, hidden, dropout, weight_decay):
    X_tr, X_val, y_tr, y_val = train_test_split(X, y, test_size=val_split, stratify=y, random_state=42)
    scaler = StandardScaler()
    X_tr_s = scaler.fit_transform(X_tr).astype(np.float32)
    X_val_s = scaler.transform(X_val).astype(np.float32)
    
    tr_ds = TensorDataset(torch.from_numpy(X_tr_s), torch.from_numpy(y_tr.astype(np.float32)))
    tr_dl = DataLoader(tr_ds, batch_size=batch_size, shuffle=True, num_workers=0)
    
    n_real = int((y_tr == 0).sum())
    n_fake = int((y_tr == 1).sum())
    pos_weight = torch.tensor([n_real / max(n_fake, 1)], device="cuda")
    
    model = ReStraVMLP(in_dim=X.shape[1], hidden=hidden, dropout=dropout).to("cuda")
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    
    X_val_t = torch.from_numpy(X_val_s).to("cuda")
    y_val_np = y_val
    
    best_auc = 0.0
    best_state = None
    patience = 15
    patience_counter = 0
    
    for epoch in range(1, epochs + 1):
        model.train()
        for xb, yb in tr_dl:
            xb, yb = xb.to("cuda"), yb.to("cuda")
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
        scheduler.step()
        
        model.eval()
        with torch.no_grad():
            logits_val = model(X_val_t).cpu().numpy()
        proba_val = torch.sigmoid(torch.from_numpy(logits_val)).numpy()
        auc = roc_auc_score(y_val_np, proba_val)
        
        if auc > best_auc:
            best_auc = auc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= patience:
                break
    
    return best_auc, best_state, scaler

if __name__ == "__main__":
    X, y = load_data()
    print(f"Loaded: X={X.shape}, real={int((y==0).sum())}, fake={int((y==1).sum())}")
    
    configs = [
        {"hidden": 128, "dropout": 0.2, "lr": 5e-4, "batch_size": 32, "weight_decay": 1e-4, "epochs": 100},
        {"hidden": 128, "dropout": 0.3, "lr": 5e-4, "batch_size": 32, "weight_decay": 1e-4, "epochs": 100},
        {"hidden": 256, "dropout": 0.2, "lr": 5e-4, "batch_size": 32, "weight_decay": 1e-4, "epochs": 100},
        {"hidden": 256, "dropout": 0.3, "lr": 5e-4, "batch_size": 32, "weight_decay": 1e-4, "epochs": 100},
        {"hidden": 256, "dropout": 0.2, "lr": 1e-3, "batch_size": 32, "weight_decay": 1e-4, "epochs": 100},
        {"hidden": 512, "dropout": 0.3, "lr": 5e-4, "batch_size": 32, "weight_decay": 1e-4, "epochs": 100},
        {"hidden": 128, "dropout": 0.2, "lr": 5e-4, "batch_size": 64, "weight_decay": 1e-3, "epochs": 100},
        {"hidden": 256, "dropout": 0.2, "lr": 5e-4, "batch_size": 16, "weight_decay": 1e-4, "epochs": 100},
    ]
    
    best_overall_auc = 0
    best_overall_config = None
    best_overall_state = None
    best_overall_scaler = None
    
    for cfg in configs:
        print(f"\nTrying: {cfg}")
        auc, state, scaler = train_and_eval(X, y, 0.2, **cfg)
        print(f"  -> Best val AUC: {auc:.4f}")
        if auc > best_overall_auc:
            best_overall_auc = auc
            best_overall_config = cfg
            best_overall_state = state
            best_overall_scaler = scaler
    
    print(f"\n=== BEST CONFIG ===")
    print(f"Config: {best_overall_config}")
    print(f"Best Val AUC: {best_overall_auc:.4f}")
    
    # Save best model
    MODELS_DIR.mkdir(exist_ok=True)
    model = ReStraVMLP(in_dim=X.shape[1], hidden=best_overall_config["hidden"], dropout=best_overall_config["dropout"]).to("cuda")
    model.load_state_dict(best_overall_state)
    model.eval()
    
    layers = []
    for name, module in model.net.named_children():
        if isinstance(module, nn.Linear):
            layers.append({"type": "linear", "weight": module.weight.detach().cpu().tolist(), "bias": module.bias.detach().cpu().tolist()})
        elif isinstance(module, nn.LayerNorm):
            layers.append({"type": "layernorm", "weight": module.weight.detach().cpu().tolist(), "bias": module.bias.detach().cpu().tolist(), "eps": module.eps})
        elif isinstance(module, nn.GELU):
            layers.append({"type": "gelu"})
        elif isinstance(module, nn.Dropout):
            layers.append({"type": "dropout"})
    
    probe = {
        "phase": "B",
        "model": "dinov2-small+restrap21",
        "embed_dim": 384,
        "restrap_dim": 21,
        "input_dim": X.shape[1],
        "layers": layers,
        "scaler_mean": best_overall_scaler.mean_.tolist(),
        "scaler_std": best_overall_scaler.scale_.tolist(),
        "threshold": 0.45,
        "auroc_val": round(best_overall_auc, 4),
        "best_config": best_overall_config,
    }
    
    with open(MODELS_DIR / "phaseB_probe.json", "w") as f:
        json.dump(probe, f, indent=2)
    print(f"\nSaved best model to models/phaseB_probe.json")
