# SlopProx — DINOv2 + ReStraV Integration
## Phase A (linear probe) + Phase B (21-d temporal MLP)

This replaces the CLIP video probe with a two-phase detector:
- **Phase A**: DINOv2-small + linear probe (fast backbone upgrade)
- **Phase B**: DINOv2-small + ReStraV 21-d temporal MLP (full accuracy upgrade)

---

## Directory layout

```
slopprox-dinov2/
  datasets/
    download_datasets.py      ← dataset download & manifest builder
  training/
    embed_dataset.py          ← DINOv2 frame embedding (GPU)
    train_phaseA.py           ← Phase A: linear probe → phaseA_probe.json
    extract_restrap_features.py ← ReStraV 21-d features
    train_phaseB.py           ← Phase B: MLP → phaseB_probe.json
  eval/
    eval_probe.py             ← AUC, per-source breakdown, threshold sweep
  js/
    video_classifier.js       ← drop-in replacement (Electron service)
    background_patch.js       ← changes needed in background.js + content.js
  models/                     ← created by training scripts
  embeddings/                 ← created by embed_dataset.py
  data/                       ← created by download_datasets.py
  requirements.txt
```

---

## Step 0 — Install dependencies

```bash
pip install -r requirements.txt
```

Verify GPU:
```python
import torch; print(torch.cuda.get_device_name(0))
# → NVIDIA GeForce RTX 3050
```

---

## Step 1 — Get datasets

```bash
# Guided instructions + HuggingFace auto-download where possible
python datasets/download_datasets.py --all
```

**Celeb-DF v2** requires manual form request:
1. Go to https://github.com/yuezunli/celeb-deepfakeforensics
2. Fill the form → you'll receive Google Drive links
3. Download `Celeb-real.zip` + `Celeb-synthesis.zip` → place in `data/celeb_df/`
4. Re-run the script → it auto-extracts

**GenVidBench/AEGIS** and **Vript** download automatically via `huggingface_hub`.

After all downloads, rebuild the manifest:
```bash
python datasets/download_datasets.py --manifest
# → data/manifest.json: X real clips, Y fake/AI clips
```

Recommended minimum for good results:
- ≥ 2,000 real clips (mix of Celeb-real + Vript)
- ≥ 1,500 fake clips (mix of Celeb-synthesis + GenVidBench T2V)

---

## Step 2 — Embed with DINOv2-small (RTX 3050 GPU)

```bash
# 8 frames per video — browser-aligned, comfortable on 3050
python training/embed_dataset.py --frames 8 --batch 16

# If VRAM is tight (e.g. other processes running):
python training/embed_dataset.py --frames 8 --batch 8

# Cap per class if very imbalanced:
python training/embed_dataset.py --frames 8 --batch 16 --max-per-class 5000
```

Outputs:
- `embeddings/embeddings_phaseA.npz` — (N, 384) mean-pooled
- `embeddings/embeddings_phaseB.npz` — (N, 8, 384) per-frame

Expected time on RTX 3050 @ batch 16: ~30–60 min for 5k videos.

---

## Step 3a — Phase A: DINOv2 linear probe

```bash
python training/train_phaseA.py --calibrate
```

Outputs `models/phaseA_probe.json`. This is a valid drop-in for `video_classifier.js` already.

Expected AUROC: 0.78–0.85 (mixed test set with T2V included).

**Threshold tuning:**
```bash
python training/train_phaseA.py --calibrate --threshold 0.45
```
Lower threshold → higher recall (catches more AI), higher FPR.
Target: FPR ≤ 0.10 on social-real val set.

---

## Step 3b — Phase B: ReStraV features

```bash
# Extract 21-d temporal geometry features from per-frame embeddings
python training/extract_restrap_features.py
```

Outputs `embeddings/restrap_features.npz` (N, 21).

```bash
# Train MLP
python training/train_phaseB.py --epochs 60 --threshold 0.45
```

Outputs `models/phaseB_probe.json` — this is the production model.

Expected AUROC: 0.83–0.90 on mixed test, notably better on T2V vs Phase A.

**Hyperparameter tips for RTX 3050:**
- `--hidden 128` is default (fast, good enough)
- `--hidden 256` for +0.5–1% AUC if you have ≥5k samples
- `--dropout 0.35` if overfitting (val AUC diverges from train after epoch 20)

---

## Step 4 — Evaluate

```bash
# Full eval with per-source breakdown
python eval/eval_probe.py --phase B --from-embeddings --sweep

# Pick threshold from the sweep output:
# Look for the row with FPR ≤ 0.10 and highest F1/TPR
python eval/eval_probe.py --phase B --from-embeddings --threshold 0.42
```

Target operating points:
| Source       | Target TPR | Max FPR |
|--------------|-----------|---------|
| Celeb-DF fake | ≥ 0.85   | 0.10   |
| T2V (Sora/Runway/Pika) | ≥ 0.75 | 0.10 |
| Social real (Vript) | n/a | ≤ 0.08 |

---

## Step 5 — Drop into SlopProx

### Replace video_classifier.js

Copy `js/video_classifier.js` into your SlopProx repo, replacing the existing one.

The model auto-detects Phase B if `models/phaseB_probe.json` exists,
falls back to Phase A otherwise.

### Patch background.js + content.js

See `js/background_patch.js` for the exact diff:
1. Add `frames8` capture in `content.js` (3 extra frames, same seek logic)
2. Pass `frames8` in the `CLASSIFY_VIDEO` message
3. Replace the `classifyVideoMessage()` function in `background.js`

### Install Xenova/dinov2-small

In your Electron/extension package:
```bash
npm install @xenova/transformers
```

The model downloads automatically on first run (~80 MB, one-time).

---

## Two-stage gating

`video_classifier.js` implements borderline two-stage scoring:
- **5 frames** → quick score
- If score in **[0.35, 0.65]** (borderline): re-embed with **8 frames** → final score
- Otherwise: return immediately

This keeps average latency close to the 5-frame case while improving
accuracy on ambiguous videos.

Disable in `video_classifier.js` by setting `const TWO_STAGE = false`.

---

## Expected latency (CPU inference, typical user machine)

| Setup | Frames | Typical latency |
|-------|--------|-----------------|
| CLIP ViT-B/32 (current) | 5 | 0.8–2.5s |
| DINOv2-small Phase A | 5 | 0.7–2.0s |
| DINOv2-small Phase B (non-borderline) | 5 | 0.7–2.0s |
| DINOv2-small Phase B (borderline, two-stage) | 8 | 1.2–4.0s |

Always benchmark on a CPU-only laptop, not your RTX 3050 machine —
most users run CPU inference.

---

## Realistic accuracy expectations

| Metric | CLIP (current) | DINOv2 Phase A | DINOv2+ReStraV Phase B |
|--------|---------------|----------------|------------------------|
| Overall AUROC | ~0.80 | ~0.82–0.85 | ~0.85–0.90 |
| T2V recall @ 10% FPR | weak | moderate | clear gain |
| Faceless AI b-roll | weak | moderate | better |
| Paper 98% AUROC | N/A | not expected | not expected |

The paper's ~98% AUROC uses 24 frames, lab-clean VidProM data, no real social feed noise.
Your extension operates on messy real-world feeds with 8 frames — 0.85–0.90 is the realistic ceiling.
