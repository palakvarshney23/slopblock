"""Uniformly sample frames from a video file."""

from __future__ import annotations

import numpy as np

try:
    from decord import VideoReader, cpu
except ImportError:  # pragma: no cover - optional dependency fallback
    VideoReader = None
    cpu = None

import cv2


NUM_FRAMES = 8


def _sample_with_decord(path: str, num_frames: int) -> np.ndarray:
    vr = VideoReader(path, ctx=cpu(0))
    total = len(vr)
    if total <= 0:
        raise ValueError(f"Video has no frames: {path}")
    indices = np.linspace(0, max(total - 1, 0), num=num_frames, dtype=int)
    frames = vr.get_batch(indices).asnumpy()
    return frames


def _sample_with_opencv(path: str, num_frames: int) -> np.ndarray:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError(f"Unable to open video: {path}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total <= 0:
        cap.release()
        raise ValueError(f"Video has no frames: {path}")
    indices = np.linspace(0, max(total - 1, 0), num=num_frames, dtype=int)
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    cap.release()
    if not frames:
        raise ValueError(f"Failed to read frames from: {path}")
    return np.stack(frames, axis=0)


def sample_frames(path: str, num_frames: int = NUM_FRAMES) -> np.ndarray:
    """Return RGB frames shaped (N, H, W, 3) as uint8."""
    if VideoReader is not None:
        try:
            return _sample_with_decord(path, num_frames)
        except Exception:
            pass
    return _sample_with_opencv(path, num_frames)


def sample_browser_frames(path: str) -> np.ndarray:
    """Return browser-identical RGB frames (N, H, W, 3) as uint8."""
    from browser_frame_sampler import sample_browser_frames as _sample_browser

    frames = _sample_browser(path)
    if not frames:
        return np.zeros((0, 180, 320, 3), dtype=np.uint8)
    return np.stack(frames, axis=0)
