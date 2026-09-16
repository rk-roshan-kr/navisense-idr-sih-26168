"""
Progressive Rollout Curriculum Engine for Drift Suppression.

Forces the neural dead-reckoning engine to remain drift-stable over extended blackout horizons:
- Stage 1: 5s – 10s   (100–200 steps @ 20 Hz)  -> Local step mechanics
- Stage 2: 10s – 20s  (200–400 steps @ 20 Hz)  -> Cornering & turn stability
- Stage 3: 20s – 40s  (400–800 steps @ 20 Hz)  -> 40m blackout horizon
- Stage 4: 40s – 60s  (800–1200 steps @ 20 Hz) -> Long-range cumulative drift suppression
- Stage 5: 60s – 120s (1200–2400 steps @ 20 Hz)-> Stress-testing extreme horizons

Memory Management on RTX 5070 Ti 16 GB:
- Dynamically scales batch size with sequence length to maintain 80–95% VRAM saturation.
- Activates PyTorch gradient checkpointing for horizons >= 400 steps (20s).
"""

from typing import List, Dict
import numpy as np
from preprocessing.window_builder import build_rollout_windows


class RolloutCurriculum:
    """
    Manages multi-stage curriculum rollout window slicing and batch sizing.
    """
    STAGES = [
        {'stage': 1, 'name': '5s-10s',   'steps': 150,  'batch_size': 32, 'stride': 30,  'use_checkpointing': False},
        {'stage': 2, 'name': '10s-20s',  'steps': 300,  'batch_size': 24, 'stride': 60,  'use_checkpointing': False},
        {'stage': 3, 'name': '20s-40s',  'steps': 600,  'batch_size': 16, 'stride': 100, 'use_checkpointing': True},
        {'stage': 4, 'name': '40s-60s',  'steps': 1000, 'batch_size': 12, 'stride': 150, 'use_checkpointing': True},
        {'stage': 5, 'name': '60s-120s', 'steps': 1800, 'batch_size': 8,  'stride': 200, 'use_checkpointing': True},
    ]

    @classmethod
    def get_stage_config(cls, stage_idx: int) -> dict:
        idx = max(0, min(stage_idx, len(cls.STAGES) - 1))
        return cls.STAGES[idx]

    @classmethod
    def slice_curriculum_windows(
        cls,
        sync_sessions: List[dict],
        stage_idx: int = 0,
        imu_hz: int = 100,
        pred_hz: int = 20
    ) -> List[dict]:
        """
        Slices synchronized contributor sessions into windows tailored to the current curriculum stage.
        """
        cfg = cls.get_stage_config(stage_idx)
        target_steps = cfg['steps']
        target_stride = cfg['stride']

        all_windows = []
        for sess in sync_sessions:
            total_pred = len(sess['sync_data']['ref_enu_20hz'])
            # Only slice if session has at least target_steps to ensure uniform batch shapes
            if total_pred < target_steps:
                continue

            actual_stride = max(20, target_stride)
            windows = build_rollout_windows(
                sync_session=sess['sync_data'],
                session_id=sess['session_id'],
                physical_device_id=sess['physical_device_id'],
                participant_id=sess['participant_id'],
                rollout_steps=target_steps,
                stride_steps=actual_stride,
                imu_hz=imu_hz,
                pred_hz=pred_hz,
                placement=sess.get('placement', 'HAND')
            )
            all_windows.extend(windows)

        return all_windows
