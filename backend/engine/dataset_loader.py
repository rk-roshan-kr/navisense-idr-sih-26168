"""
IOVNBDLoader — loads real phone sensor sessions from the IO-VNBD dataset
for use in the 180s personalization calibration window (Phase 2).

Column mapping verified from S-S1.csv (Driver A, Session 1):
  row 0 (ax) <- col 9  ACCELEROMETER X  (mean=0.04, std=1.06 m/s^2)
  row 1 (ay) <- col 10 ACCELEROMETER Y  (mean=0.06, std=1.07 m/s^2)
  row 2 (az) <- col 11 ACCELEROMETER Z  (mean=9.85, std=0.51 m/s^2)
  row 3 (gx) <- col 15 GYROSCOPE Yaw   (mean=0.002, std=0.100 rad/s)
  row 4 (gy) <- col 16 GYROSCOPE Pitch  (mean=-0.007, std=0.142 rad/s)
  row 5 (gz) <- col 17 GYROSCOPE Roll   (mean=0.003, std=0.052 rad/s)
  row 6 (mx) <- col 18 MAGNETIC FIELD X (mean=-15.9, std=12.3 uT)
  row 7 (my) <- col 19 MAGNETIC FIELD Y (mean=-27.9, std=2.9 uT)
  row 8 (mz) <- col 20 MAGNETIC FIELD Z (mean=17.0, std=13.0 uT)

Sample rate: 100ms +/- 0.8ms (matches our dt=0.1s exactly).
Total S-S1 length: 51,746 samples = 5,174s ~ 86 minutes.
"""

import numpy as np
from pathlib import Path

# Verified column positions in S-S1.csv (0-indexed, after header row)
_SENSOR_COLS = [9, 10, 11, 15, 16, 17, 18, 19, 20]

_DEFAULT_PATH = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "IO-VNBD"
    / "Synchronised V abd S datasets"
    / "Categorised IOVNB Dataset"
    / "S (Driver A)"
    / "S1"
    / "S-S1.csv"
)


class IOVNBDLoader:
    """
    Loads real phone sensor data from IO-VNBD S-S1.csv for adapter calibration.
    Provides sliding-window access to the (9, N) sensor array.
    Falls back gracefully to None if the file is missing.
    """

    def __init__(self, path: Path = None):
        self.data = None   # shape (9, N) float32
        self.N = 0
        self._load(path or _DEFAULT_PATH)

    def _load(self, path: Path):
        if not path.exists():
            print(f"[DATASET] WARNING: IO-VNBD not found at {path}. Calibration will use synthesized IMU.")
            return

        try:
            import pandas as pd
            df = pd.read_csv(path, encoding="latin-1", usecols=_SENSOR_COLS)
            arr = df.values.T.astype(np.float32)   # (9, N)

            # Sanitize NaNs per row
            for r in range(arr.shape[0]):
                nan_mask = np.isnan(arr[r])
                if nan_mask.any():
                    col_mean = float(np.nanmean(arr[r]))
                    arr[r, nan_mask] = col_mean

            self.data = arr
            self.N = arr.shape[1]
            print(
                f"[DATASET] Loaded IO-VNBD S-S1: {self.N:,} samples "
                f"({self.N * 0.1:.0f}s @ 10 Hz) -- real phone sensor data ready for calibration."
            )
        except Exception as exc:
            print(f"[DATASET] WARNING: Failed to load IO-VNBD ({exc}). Falling back to synthesized IMU.")
            self.data = None
            self.N = 0

    @property
    def available(self):
        return self.data is not None and self.N > 0

    def get_window(self, center_idx: int, window: int):
        """
        Returns a (9, window) sensor window ending at center_idx.
        Wraps circularly at the end of the dataset so calibration never runs out of data.
        Returns None if dataset is not available (caller falls back to synthesized IMU).
        """
        if not self.available:
            return None

        end_idx = center_idx % self.N
        start_idx = end_idx - window

        if start_idx >= 0:
            return self.data[:, start_idx:end_idx].copy()
        else:
            # Wrap-around: concatenate tail + head
            tail = self.data[:, start_idx:]
            head = self.data[:, :end_idx]
            chunk = np.concatenate([tail, head], axis=1)
            if chunk.shape[1] < window:
                pad = np.tile(self.data[:, :1], window - chunk.shape[1])
                chunk = np.concatenate([pad, chunk], axis=1)
            return chunk
