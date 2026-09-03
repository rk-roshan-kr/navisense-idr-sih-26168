"""Vehicle/mount vibration profiling for smartphone IMU conditioning.

Important sampling constraint:
    The IO-VNBD smartphone IMU used by the current pipeline is ~10 Hz, so its
    Nyquist frequency is ~5 Hz. This module therefore does NOT claim to identify
    12-35 Hz engine harmonics from the current dataset. It profiles only the
    observable low-frequency noise / impulse statistics and provides optional
    adaptive conditioning hooks. A higher-rate IMU stream can later be attached
    to the same API for genuine spectral profiling.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class VibrationProfile:
    """Online profile accumulated during a stationary/low-dynamics interval."""

    samples: int = 0
    mean: np.ndarray = field(default_factory=lambda: np.zeros(3, dtype=np.float64))
    m2: np.ndarray = field(default_factory=lambda: np.zeros(3, dtype=np.float64))
    abs_peak: np.ndarray = field(default_factory=lambda: np.zeros(3, dtype=np.float64))

    @property
    def variance(self) -> np.ndarray:
        if self.samples < 2:
            return np.zeros(3, dtype=np.float64)
        return self.m2 / (self.samples - 1)

    @property
    def std(self) -> np.ndarray:
        return np.sqrt(np.maximum(self.variance, 0.0))


class VehicleVibrationProfiler:
    """Causal profile + conservative conditioning for smartphone IMU streams.

    At the current 10 Hz sampling rate we can observe only 0-5 Hz. The profiler
    therefore estimates a stationary noise envelope and rejects isolated shocks
    without inventing an unobservable high-frequency engine spectrum.

    The returned conditioned signal is intentionally conservative: genuine
    vehicle dynamics remain available to the learned model, while extreme
    single-sample impulses can be clipped using a learned robust envelope.
    """

    def __init__(
        self,
        gravity_mps2: float = 9.80665,
        accel_clip_mps2: float = 8.0,
        robust_sigma: float = 4.0,
    ) -> None:
        self.gravity_mps2 = float(gravity_mps2)
        self.accel_clip_mps2 = float(accel_clip_mps2)
        self.robust_sigma = float(robust_sigma)
        self.profile = VibrationProfile()
        self._last_accel: Optional[np.ndarray] = None

    def reset(self) -> None:
        self.profile = VibrationProfile()
        self._last_accel = None

    def update_profile(self, accel: np.ndarray, stationary: bool) -> None:
        """Update noise statistics only during trusted stationary samples."""
        x = np.asarray(accel, dtype=np.float64)
        if x.shape != (3,) or not np.all(np.isfinite(x)) or not stationary:
            return

        p = self.profile
        p.samples += 1
        delta = x - p.mean
        p.mean += delta / p.samples
        delta2 = x - p.mean
        p.m2 += delta * delta2
        p.abs_peak = np.maximum(p.abs_peak, np.abs(x - p.mean))

    def condition_accel(self, accel: np.ndarray) -> tuple[np.ndarray, bool]:
        """Return causally conditioned acceleration and an impulse flag.

        The profile is used as an adaptive robust envelope. We do not apply a
        fixed spectral subtraction because the current 10 Hz data cannot expose
        engine frequencies above 5 Hz.
        """
        x = np.asarray(accel, dtype=np.float64).copy()
        if x.shape != (3,) or not np.all(np.isfinite(x)):
            raise ValueError("accel must be a finite 3-vector")

        impulse = False
        if self._last_accel is not None and self.profile.samples >= 10:
            innovation = x - self._last_accel
            threshold = self.robust_sigma * (self.profile.std + 1e-6)
            # Only classify unusually large sample-to-sample innovations as
            # shocks. This avoids suppressing ordinary braking/cornering.
            impulse = bool(np.any(np.abs(innovation) > threshold))

        x = np.clip(x, -self.accel_clip_mps2, self.accel_clip_mps2)
        self._last_accel = x.copy()
        return x, impulse

    def state(self) -> dict:
        return {
            "samples": self.profile.samples,
            "mean": self.profile.mean.copy(),
            "std": self.profile.std.copy(),
            "observable_band_hz": [0.0, 5.0],
            "spectral_engine_profile_available": False,
        }
