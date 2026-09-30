"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/data/__init__.py
Description: Data processing, blackout episode generation, and perturbation tools.
================================================================================
"""

from .sensor_perturbation import SensorPerturbationEngine
from .blackout_generator import BlackoutEpisode, generate_blackout_episodes_from_segment
from .episode_dataset import BlackoutEpisodeDataset, build_episode_dataloaders
