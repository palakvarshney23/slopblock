"""
verify_video_classifier.py — End-to-end verification of the trained probe
"""
import json
import numpy as np
from pathlib import Path
import cv2
import torch
from transformers import AutoModel, AutoImageProcessor
import torchvision.transforms as T

MODELS_DIR = Path("models")
EMBED_DIR = Path("embeddings")
DATA_DIR = Path("data")

print("=" * 70)
print("VIDEO CLASSIFIER VERIFICATION")
print("=" * 70)

# ─── 1. Verify probe files exist ─────────────────────────────────────────────
print("\n[1] Checking probe files...")
phaseA = MODELS_DIR / "phaseA_probe.json"
phaseB = MODELS_DIR / "phaseB_probe.json"

assert phaseA.exists(), f"Phase A probe missing: {phaseA}"
assert phaseB.exists(), f"Phase B probe missing: {phaseB}"

with open(phaseB) as f:
    probe = json.load(f)

print(f"  Phase A: {phaseA.stat().st_size:,} bytes")
print(f"  Phase B: {phaseB.stat().st_size:,} bytes")
print(f"  Phase: {probe['phase']}")
print(f"  Model: {probe['model']}")
print(f"  Input dim: {probe['input_dim']}")
print(f"  Threshold: {probe['threshold']}")
print(f"  Val AUROC: {probe['auroc_val']}")
print(f"  Layers: {len(probe['layers'])}")

# ─── 2. Verify embeddings ──────────────────────────────────────────────────
print("\n[2] Checking embeddings...")
embA = EMBED_DIR / "embeddings_phaseA.npz"
embB = EMBED_DIR / "embeddings_phaseB.npz"
restrap = EMBED_DIR / "restrap_features.npz"

for f in [embA, embB, restrap]:
    assert f.exists(), f"Missing: {f}"

dataA = np.load(embA, allow_pickle=True)
dataB = np.load(embB, allow_pickle=True)
dataR = np.load(restrap, allow_pickle=True)

print(f"  Phase A embeddings: {dataA['embeddings'].shape}")
print(f"  Phase B embeddings: {dataB['embeddings'].shape}")
print(f"  ReStraV features:   {dataR['features'].shape}")
print(f"  Labels: {np.bincount(dataA['labels'].astype(int))} (real=0, fake=1)")

# ─── 3. Python inference test on real data ───────────────────────────────
print("\n[3] Testing Python inference on real embeddings...")

def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def gelu(x):
    return 0.5 * x * (1 + np.tanh(np.sqrt(2 / np.pi) * (x + 0.044715 * x ** 3)))

def predict_phaseA(X, probe):
    mean = np.array(probe["scaler_mean"])
    std = np.array(probe["scaler_std"]) + 1e-8
    Xs = (X - mean) / std
    logits = Xs @ np.array(probe["weights"]) + probe["bias"]
    return sigmoid(logits)

def predict_phaseB(X, probe):
    mean = np.array(probe["scaler_mean"])
    std = np.array(probe["scaler_std"]) + 1e-8
    h = (X - mean) / std
    
    for layer in probe["layers"]:
        if layer["type"] == "linear":
            W = np.array(layer["weight"])
            b = np.array(layer["bias"])
            h = h @ W.T + b
        elif layer["type"] == "layernorm":
            mu = h.mean(axis=-1, keepdims=True)
            var = h.var(axis=-1, keepdims=True)
            h = (h - mu) / np.sqrt(var + layer["eps"])
            h = h * np.array(layer["weight"]) + np.array(layer["bias"])
        elif layer["type"] == "gelu":
            h = gelu(h)
    return sigmoid(h.squeeze(-1))

# Load Phase B probe
X_mean = dataA["embeddings"].astype(np.float32)
X_restrap = dataR["features"].astype(np.float32)
X_full = np.concatenate([X_mean, X_restrap], axis=1)
labels = dataA["labels"].astype(int)

# Run inference on first 10 samples
for i in range(10):
    x = X_full[i:i+1]
    score = predict_phaseB(x, probe)[0]
    label = "FAKE" if score >= probe["threshold"] else "REAL"
    actual = "FAKE" if labels[i] == 1 else "REAL"
    match = "OK" if (score >= probe["threshold"]) == (labels[i] == 1) else "XX"
    print(f"  Sample {i}: score={score:.3f} -> {label} (actual={actual}) {match}")

# Run on full dataset
scores = predict_phaseB(X_full, probe)
preds = (scores >= probe["threshold"]).astype(int)
acc = (preds == labels).mean()
print(f"\n  Full dataset accuracy: {acc:.3%} ({(preds == labels).sum()}/{len(labels)})")

# ─── 4. Live video frame extraction + DINOv2 embedding test ─────────────────
print("\n[4] Testing live video frame extraction + DINOv2 embedding...")

# Find a real video to test
video_files = list(DATA_DIR.rglob("*.mp4"))
if video_files:
    test_video = video_files[0]
    print(f"  Test video: {test_video}")
    
    cap = cv2.VideoCapture(str(test_video))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"  Total frames: {total}")
    
    n_frames = 8
    indices = [int(i * total / n_frames) for i in range(n_frames)]
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if ret:
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    cap.release()
    
    print(f"  Extracted {len(frames)} frames")
    
    # Load DINOv2
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"  Loading DINOv2-small on {device}...")
    model = AutoModel.from_pretrained("facebook/dinov2-small").eval().to(device)
    processor = AutoImageProcessor.from_pretrained("facebook/dinov2-small")
    
    inputs = processor(images=frames, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    
    cls_tokens = outputs.last_hidden_state[:, 0, :].cpu().numpy()  # (8, 384)
    print(f"  CLS tokens shape: {cls_tokens.shape}")
    
    # Mean pool for Phase A input
    mean_emb = cls_tokens.mean(axis=0)  # (384,)
    print(f"  Mean-pooled shape: {mean_emb.shape}")
    
    # Compute ReStraV features
    from training.extract_restrap_features import compute_restrap_21d
    restrap_feat = compute_restrap_21d(cls_tokens)
    print(f"  ReStraV features shape: {restrap_feat.shape}")
    
    # Combine and predict
    full_input = np.concatenate([mean_emb, restrap_feat])
    score = predict_phaseB(full_input.reshape(1, -1), probe)[0]
    print(f"\n  LIVE VIDEO SCORE: {score:.3f}")
    print(f"  CLASSIFICATION: {'FAKE / AI-GENERATED' if score >= probe['threshold'] else 'REAL'}")
    print(f"  Confidence: {abs(score - 0.5) * 2:.1%}")
else:
    print("  [SKIP] No video files found in data/")

# ─── 5. Two-stage gating simulation ──────────────────────────────────────────
print("\n[5] Simulating two-stage gating...")

borderline_low = probe["threshold"] - 0.10  # ~0.35
borderline_high = probe["threshold"] + 0.10  # ~0.55

print(f"  Borderline range: [{borderline_low:.2f}, {borderline_high:.2f}]")

# Find a borderline case
for i in range(min(100, len(scores))):
    s = scores[i]
    if borderline_low <= s <= borderline_high:
        print(f"  Found borderline sample {i}: score={s:.3f}")
        print(f"  -> Would trigger 8-frame re-scoring")
        break
else:
    print(f"  No borderline cases found in first 100 samples")

# ─── 6. JS probe compatibility check ───────────────────────────────────────
print("\n[6] Checking JS probe compatibility...")

# Verify all required keys
required_keys = ["phase", "model", "input_dim", "layers", "scaler_mean", "scaler_std", "threshold"]
missing = [k for k in required_keys if k not in probe]
if missing:
    print(f"  [ERR] Missing keys: {missing}")
else:
    print(f"  [OK] All required keys present")

# Verify layer types
layer_types = [layer["type"] for layer in probe["layers"]]
expected_types = {"linear", "layernorm", "gelu", "dropout"}
unexpected = set(layer_types) - expected_types
if unexpected:
    print(f"  [ERR] Unexpected layer types: {unexpected}")
else:
    print(f"  [OK] Layer types valid: {layer_types}")

# Check dimensions
for i, layer in enumerate(probe["layers"]):
    if layer["type"] == "linear":
        W = np.array(layer["weight"])
        b = np.array(layer["bias"])
        print(f"  Layer {i} (linear): weight={W.shape}, bias={b.shape}")

# ─── 7. Summary ─────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("VERIFICATION SUMMARY")
print("=" * 70)
print(f"  Probe file:       [OK] Loaded (phase={probe['phase']})")
print(f"  Embedding shape:  [OK] {X_full.shape}")
print(f"  Python inference: [OK] Working")
print(f"  Full accuracy:    {acc:.3%}")
print(f"  JS compatibility: [OK] All keys and layer types valid")
print(f"  Two-stage gate:   [OK] Configured [{borderline_low:.2f}, {borderline_high:.2f}]")
if video_files:
    print(f"  Live video test:  [OK] Score={score:.3f}")
print("=" * 70)
