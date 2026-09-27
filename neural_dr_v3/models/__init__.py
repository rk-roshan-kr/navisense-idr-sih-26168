"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/models/__init__.py
Description: Neural DR v3 architectures, causal backbone, and kinematic integrator.
================================================================================
"""

from .causal_backbone import CausalConv1d, TemporalLayerNorm, CausalTCNBackbone
from .kinematic_integrator import KinematicIntegrator, WGS84AnchorProjector
from .model_b_neural_dr import NeuralDeadReckoningNetV3
from .model_a_vel_yaw import VelYawBaselineNet
from .model_c_direct_cartesian import DirectCartesianBaselineNet
