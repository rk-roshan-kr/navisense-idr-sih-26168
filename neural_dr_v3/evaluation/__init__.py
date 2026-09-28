"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/evaluation/__init__.py
Description: Scientific navigation evaluation, blackout rollout testing, and
head-to-head benchmarking against the V2.2 baseline.
================================================================================
"""

from .metrics import compute_navigation_metrics, NavigationMetrics
from .evaluator import AutonomousRolloutEvaluator
from .benchmark_vs_v2 import run_comprehensive_benchmark
