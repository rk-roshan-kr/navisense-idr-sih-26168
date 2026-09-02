"""
Export universal_motion_net.pt → universal_motion_net.onnx
Run: python src/training/export_onnx.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import torch
from src.models.nn_models import UniversalMotionNet

MODEL_PT   = Path("models/universal_motion_net.pt")
MODEL_ONNX = Path("models/universal_motion_net.onnx")
WINDOW     = 100   # 10 s × 10 Hz

assert MODEL_PT.exists(), f"Checkpoint not found: {MODEL_PT}"

model = UniversalMotionNet(in_channels=6, hidden_dim=64, rnn_dim=64)
model.load_state_dict(torch.load(MODEL_PT, map_location="cpu"))
model.eval().cpu()

dummy = torch.randn(1, 6, WINDOW)

print(f"Exporting {MODEL_PT} -> {MODEL_ONNX} ...")

torch.onnx.export(
    model,
    dummy,
    str(MODEL_ONNX),
    input_names=["imu_window"],
    output_names=["speed", "yaw_rate", "long_accel", "log_var"],
    dynamic_axes={"imu_window": {0: "batch"}},
    opset_version=17,
)

size_kb = MODEL_ONNX.stat().st_size / 1024
print(f"Done! ONNX size: {size_kb:.1f} KB → {MODEL_ONNX}")
