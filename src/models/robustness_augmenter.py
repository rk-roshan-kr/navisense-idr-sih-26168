"""
SIH 26168 - Physical Sensor Perturbation & Robustness Augmentation Engine
"""

import numpy as np


class SensorPerturbationAugmenter:
    def __init__(self, p_bias=0.8, p_vibration=0.7, p_pothole=0.4, p_tilt=0.5):
        self.p_bias = p_bias
        self.p_vibration = p_vibration
        self.p_pothole = p_pothole
        self.p_tilt = p_tilt

    def augment(self, imu_window):
        aug_window = imu_window.copy()
        C, W = aug_window.shape

        if np.random.rand() < self.p_bias:
            ba = (np.random.rand(3, 1) - 0.5) * 0.3
            bg = (np.random.rand(3, 1) - 0.5) * 0.03
            aug_window[0:3, :] += ba
            aug_window[3:6, :] += bg

        if np.random.rand() < self.p_vibration:
            t = np.linspace(0, 0.1 * W, W)
            freq = np.random.uniform(15.0, 45.0)
            amp = np.random.uniform(0.1, 0.4)
            harmonic = amp * np.sin(2 * np.pi * freq * t)
            aug_window[0, :] += harmonic * 0.5
            aug_window[1, :] += harmonic * 0.7
            aug_window[2, :] += harmonic

        if np.random.rand() < self.p_pothole:
            bump_idx = np.random.randint(2, W - 2)
            bump_amp = np.random.uniform(2.0, 5.0)
            aug_window[2, bump_idx] += bump_amp
            aug_window[1, bump_idx] += (np.random.rand() - 0.5) * 1.5

        if np.random.rand() < self.p_tilt:
            d_pitch = np.radians(np.random.uniform(-4.0, 4.0))
            d_roll = np.radians(np.random.uniform(-4.0, 4.0))
            cp, sp = np.cos(d_pitch), np.sin(d_pitch)
            cr, sr = np.cos(d_roll), np.sin(d_roll)
            R_perturb = np.array([
                [cp, sp * sr, sp * cr],
                [0, cr, -sr],
                [-sp, cp * sr, cp * cr]
            ])
            aug_window[0:3, :] = np.dot(R_perturb, aug_window[0:3, :])
            aug_window[3:6, :] = np.dot(R_perturb, aug_window[3:6, :])

        aug_window[0:3, :] += np.random.normal(0, 0.05, (3, W))
        aug_window[3:6, :] += np.random.normal(0, 0.002, (3, W))

        return aug_window
