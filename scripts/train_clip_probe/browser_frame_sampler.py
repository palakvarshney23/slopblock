"""Sample video frames using the same logic as extension/content.js."""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import cv2
import numpy as np

try:
    from decord import VideoReader, cpu
except ImportError:  # pragma: no cover
    VideoReader = None
    cpu = None


FRAME_SAMPLE_COUNT = 5
FRAME_SAMPLE_WINDOW_SEC = 5.0
FRAME_SKIP_START_SEC = 1.5
FRAME_WIDTH = 320
FRAME_HEIGHT = 180
JPEG_QUALITY = 72  # cv2 uses 0-100; canvas uses 0.72 -> ~72
VIDEO_MIN_DURATION = 3.0


def _seek_times(duration_sec: float) -> list[float]:
    sample_window = min(FRAME_SAMPLE_WINDOW_SEC, max(0.0, duration_sec - 0.1))
    window_start = min(FRAME_SKIP_START_SEC, sample_window * 0.5)
    effective_window = max(0.0, sample_window - window_start)
    if FRAME_SAMPLE_COUNT <= 0:
        return []
    return [
        window_start + ((i + 1) / (FRAME_SAMPLE_COUNT + 1)) * effective_window
        for i in range(FRAME_SAMPLE_COUNT)
    ]


def _resize_cover_rgb(frame_rgb: np.ndarray, width: int, height: int) -> np.ndarray:
    """Match sharp.resize(..., { fit: 'cover' })."""
    h, w = frame_rgb.shape[:2]
    if h <= 0 or w <= 0:
        raise ValueError("Invalid frame dimensions")
    scale = max(width / w, height / h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = cv2.resize(frame_rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)
    x0 = max(0, (new_w - width) // 2)
    y0 = max(0, (new_h - height) // 2)
    cropped = resized[y0 : y0 + height, x0 : x0 + width]
    if cropped.shape[0] != height or cropped.shape[1] != width:
        cropped = cv2.resize(cropped, (width, height), interpolation=cv2.INTER_AREA)
    return cropped


def _jpeg_roundtrip(frame_rgb: np.ndarray, quality: int = JPEG_QUALITY) -> np.ndarray:
    bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    ok, encoded = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise ValueError("JPEG encode failed")
    decoded = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError("JPEG decode failed")
    return cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)


def _frame_fingerprint(frame_rgb: np.ndarray) -> int:
    small = cv2.resize(frame_rgb, (32, 18), interpolation=cv2.INTER_AREA)
    flat = small.reshape(-1, 3)
    step = max(1, len(flat) // 64)
    hash_val = 0
    for i in range(64):
        idx = min(i * step, len(flat) - 1)
        hash_val = ((hash_val << 5) - hash_val + int(flat[idx, 0])) & 0xFFFFFFFF
    return hash_val


def _read_frame_at_time(path: str, seek_sec: float, fps: float, frame_count: int) -> np.ndarray | None:
    if VideoReader is not None:
        try:
            vr = VideoReader(path, ctx=cpu(0))
            if len(vr) <= 0:
                return None
            idx = int(round(seek_sec * fps))
            idx = max(0, min(len(vr) - 1, idx))
            frame = vr[idx].asnumpy()
            return frame
        except Exception:
            pass

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return None
    if fps <= 0:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    idx = int(round(seek_sec * fps))
    idx = max(0, min(max(frame_count - 1, 0), idx))
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        return None
    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)


def _video_duration_sec(path: str) -> tuple[float, float, int]:
    if VideoReader is not None:
        try:
            vr = VideoReader(path, ctx=cpu(0))
            fps = float(vr.get_avg_fps() or 25.0)
            count = len(vr)
            if fps > 0 and count > 0:
                return count / fps, fps, count
        except Exception:
            pass

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError(f"Unable to open video: {path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    if fps <= 0 or count <= 0:
        raise ValueError(f"Video has no frames: {path}")
    return count / fps, fps, count


def sample_browser_frames(path: str) -> list[np.ndarray]:
    """Return browser-like RGB frames (uint8) or empty list if too short."""
    duration, fps, frame_count = _video_duration_sec(path)
    if duration < VIDEO_MIN_DURATION:
        return []

    seen: set[int] = set()
    frames: list[np.ndarray] = []
    for seek_time in _seek_times(duration):
        raw = _read_frame_at_time(path, seek_time, fps, frame_count)
        if raw is None:
            continue
        covered = _resize_cover_rgb(raw, FRAME_WIDTH, FRAME_HEIGHT)
        jpeg = _jpeg_roundtrip(covered, JPEG_QUALITY)
        fp = _frame_fingerprint(jpeg)
        if fp in seen:
            continue
        seen.add(fp)
        frames.append(jpeg)
    return frames


def frames_to_jpeg_buffers(frames: list[np.ndarray]) -> list[bytes]:
    buffers: list[bytes] = []
    for frame in frames:
        bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        ok, encoded = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
        if ok:
            buffers.append(encoded.tobytes())
    return buffers


def augment_frame(frame_rgb: np.ndarray, mode: str) -> np.ndarray:
    if mode == "jpeg60":
        return _jpeg_roundtrip(frame_rgb, quality=60)
    if mode == "dark":
        dark = np.clip(frame_rgb.astype(np.float32) * 0.9, 0, 255).astype(np.uint8)
        return _jpeg_roundtrip(dark, JPEG_QUALITY)
    return frame_rgb


def sample_browser_frames_augmented(path: str) -> list[np.ndarray]:
    base = sample_browser_frames(path)
    if not base:
        return []
    out: list[np.ndarray] = []
    for frame in base:
        out.append(augment_frame(frame, "orig"))
        out.append(augment_frame(frame, "jpeg60"))
        out.append(augment_frame(frame, "dark"))
    return out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: browser_frame_sampler.py <video_path> [--augment]")
    video_path = sys.argv[1]
    augment = "--augment" in sys.argv[2:]
    frames = sample_browser_frames_augmented(video_path) if augment else sample_browser_frames(video_path)
    payload = [
        base64.b64encode(buf).decode("ascii")
        for buf in frames_to_jpeg_buffers(frames)
    ]
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
