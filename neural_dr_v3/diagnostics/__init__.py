"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/diagnostics/__init__.py
Description: Visual diagnostics, trajectory overlays, and error decomposition tools.
================================================================================
"""

from .plot_trajectories import plot_trajectory_comparison, plot_multi_horizon_drift_curves
from .error_forensics import decompose_trajectory_errors
