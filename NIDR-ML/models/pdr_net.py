"""
NaviSense PDR-Net V1 Architecture (Aliased to Mobile Student Model).

Maintains backward compatibility while leveraging the 63-step (3.15s) receptive field,
4D vector uncertainty, and signed yaw heading increments.
"""

import torch
from .student.pdr_mobile import NaviSensePDRMobile

# Primary alias
NaviSensePDRNetV1 = NaviSensePDRMobile
