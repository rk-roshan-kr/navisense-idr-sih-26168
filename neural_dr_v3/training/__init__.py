"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/training/__init__.py
Description: Trajectory rollout losses, curriculum scheduled sampling, and
PyTorch training loop for Neural DR v3.
================================================================================
"""

from .losses import MultiHorizonTrajectoryLoss
from .scheduled_sampler import ScheduledSamplingCurriculum
from .trainer import NeuralDRTrainer
