"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/training/scheduled_sampler.py
Description: Scheduled sampling curriculum manager for closed-loop error exposure.
================================================================================
"""

import math


class ScheduledSamplingCurriculum:
    """
    Manages the curriculum for scheduled sampling during closed-loop rollout training.
    
    Probability eps(epoch) of feeding model's OWN predicted state back into the next step
    rather than teacher-forcing with ground truth state:
      - Epoch 0 to warmup: eps = initial_prob (0.0) -> teacher forcing
      - Warms up to final_prob (0.8 - 1.0) -> model experiences its own accumulated drift
    """
    def __init__(
        self,
        initial_prob: float = 0.0,
        final_prob: float = 0.8,
        warmup_epochs: int = 3,
        total_epochs: int = 15
    ):
        self.initial_prob = initial_prob
        self.final_prob = final_prob
        self.warmup_epochs = warmup_epochs
        self.total_epochs = total_epochs

    def get_probability(self, epoch: int) -> float:
        """Returns sampling probability for current epoch."""
        if epoch < self.warmup_epochs:
            return self.initial_prob

        span = max(self.total_epochs - self.warmup_epochs, 1)
        progress = (epoch - self.warmup_epochs) / span
        progress = min(max(progress, 0.0), 1.0)

        # Smooth cosine ramp from initial_prob to final_prob
        factor = 0.5 * (1.0 - math.cos(math.pi * progress))
        prob = self.initial_prob + factor * (self.final_prob - self.initial_prob)
        return float(prob)
