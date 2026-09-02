"""
SIH 26168 - Live Python ML Inference Server & Telemetry API
Provides live, real-time Python model inference (PyTorch UniversalMotionNet,
15-state ES-EKF, 3D Strapdown INS, ModularIDREngine) directly to the web console.

Endpoints:
- POST /api/step: Real-time inference on live IMU frame
- POST /api/personalize: Causal GNSS teacher calibration step
- POST /api/reset: Reset state estimators
- GET /api/status: Engine health, PyTorch model status, calibration parameters
- GET /*: Static web console assets (index.html, css, js, figures)
"""

import os
import sys
import json
import torch
import numpy as np
from http.server import HTTPServer, SimpleHTTPRequestHandler

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from src.core.idr_core import ModularIDREngine
from src.core.personalization import OnlinePersonalizer
from src.models.nn_models import UniversalMotionNet
from src.baselines.ins_physics import RawStrapdownINS
from src.baselines.ekf_nhc import ES_EKF_NHC


class LiveMLIDRServer:
    def __init__(self, data_root="data/IO-VNBD", model_path="experiments/models/base_motion_net.pt"):
        self.data_root = data_root
        self.device = torch.device("cpu")
        
        # 1. Base Deep Learned Model (PyTorch)
        self.base_model = UniversalMotionNet().to(self.device)
        self.model_loaded = False
        if os.path.exists(model_path):
            self.base_model.load_state_dict(torch.load(model_path, map_location=self.device))
            self.model_loaded = True
            print(f"[ML Server] Loaded PyTorch UniversalMotionNet from {model_path}")
        self.base_model.eval()

        # 2. Physics & Classical Baselines
        self.ins_b1 = None
        self.ekf_b2 = None

        # 3. 8-Component Modular IDR Engine (B5)
        self.engine_b5 = ModularIDREngine()
        self.personalizer = OnlinePersonalizer()

        # 4. IMU history window for deep temporal convolutions (1D-CNN)
        self.imu_window = []
        self.window_size = 20
        self.b4_speed = 0.0
        self.b4_heading_rad = 0.0
        self.b4_pos = np.array([0.0, 0.0, 0.0])

        self.reset(init_pos=[0.0, 0.0, 0.0], init_speed=12.5, init_heading_deg=0.0)

    def reset(self, init_pos=[0.0, 0.0, 0.0], init_speed=0.0, init_heading_deg=0.0):
        pos = np.array(init_pos, dtype=np.float64)
        head_rad = np.radians(90.0 - init_heading_deg)
        vel = np.array([init_speed * np.cos(head_rad), init_speed * np.sin(head_rad), 0.0])

        self.ins_b1 = RawStrapdownINS(pos, vel, init_heading_deg)
        self.ekf_b2 = ES_EKF_NHC(pos, vel, init_heading_deg)
        self.engine_b5.reset(pos, init_speed, init_heading_deg)

        self.b4_pos = pos.copy()
        self.b4_speed = float(init_speed)
        self.b4_heading_rad = head_rad
        self.imu_window = []

    def personalize_step(self, accel, gyro, gnss_speed, gnss_heading, dt=0.1):
        """Strictly causal calibration step (GNSS teacher available)."""
        self.personalizer.update_with_gnss_teacher(accel, gyro, gnss_speed, gnss_heading, dt)
        p = self.personalizer.state
        self.engine_b5.calibration.mount_pitch = p.mount_pitch
        self.engine_b5.calibration.mount_roll = p.mount_roll
        self.engine_b5.calibration.ba = p.accel_bias
        self.engine_b5.calibration.bg = p.gyro_bias
        self.engine_b5.calibration.accel_scale = p.accel_scale
        self.engine_b5.calibration.convergence_score = p.convergence_score
        self.engine_b5.transform.update_mounting_angles(p.mount_pitch, p.mount_roll)
        return p.to_dict()

    def step(self, accel_raw, gyro_raw, dt=0.1, is_blackout=False, gnss_speed=None):
        """
        Executes genuine Python & PyTorch inference across all 4 baseline models.
        HARD ISOLATION: When is_blackout is True, gnss_speed is None.
        """
        accel = np.array(accel_raw, dtype=np.float64)
        gyro = np.array(gyro_raw, dtype=np.float64)

        # 1. B1: 3D Strapdown INS
        pos_b1, vel_b1 = self.ins_b1.update(accel, gyro, dt)
        spd_b1 = np.linalg.norm(vel_b1[:2])

        # 2. B2: 15-state Error-State EKF + NHC
        self.ekf_b2.predict(accel, gyro, dt)
        self.ekf_b2.update_nhc()
        pos_b2 = self.ekf_b2.p_n
        spd_b2 = np.linalg.norm(self.ekf_b2.v_n[:2])

        # 3. B4: Deep PyTorch UniversalMotionNet
        imu_sample = np.hstack([accel, gyro])
        self.imu_window.append(imu_sample)
        if len(self.imu_window) > self.window_size:
            self.imu_window.pop(0)

        if len(self.imu_window) < self.window_size:
            pad = np.tile(self.imu_window[0], (self.window_size - len(self.imu_window), 1))
            win_arr = np.vstack([pad, self.imu_window])
        else:
            win_arr = np.array(self.imu_window)

        with torch.no_grad():
            x_tensor = torch.tensor(win_arr.T[np.newaxis, ...], dtype=torch.float32, device=self.device)
            net_out = self.base_model(x_tensor)
            pred_v = float(net_out["speed"].numpy()[0])
            pred_w = float(net_out["yaw_rate"].numpy()[0])

        self.b4_speed = 0.85 * self.b4_speed + 0.15 * pred_v
        self.b4_heading_rad += pred_w * dt
        self.b4_heading_rad = (self.b4_heading_rad + np.pi) % (2 * np.pi) - np.pi
        self.b4_pos[0] += self.b4_speed * np.cos(self.b4_heading_rad) * dt
        self.b4_pos[1] += self.b4_speed * np.sin(self.b4_heading_rad) * dt

        # 4. B5: Personalized IDR (Modular 8-Component Engine)
        b5_out = self.engine_b5.step(accel, gyro, dt, gnss_speed=None if is_blackout else gnss_speed)
        pos_b5 = b5_out["pos_enu"]
        spd_b5 = b5_out["speed_ms"]

        return {
            "b1_pos": pos_b1.tolist(),
            "b1_speed": float(spd_b1),
            "b2_pos": pos_b2.tolist(),
            "b2_speed": float(spd_b2),
            "b4_pos": self.b4_pos.tolist(),
            "b4_speed": float(self.b4_speed),
            "b5_pos": pos_b5.tolist(),
            "b5_speed": float(spd_b5),
            "b5_heading_deg": float(b5_out["heading_deg"]),
            "calibration_score": float(b5_out["calibration_score"]),
            "mount_pitch_deg": float(b5_out["mount_pitch_deg"]),
            "mount_roll_deg": float(b5_out["mount_roll_deg"])
        }


# Global Server Instance
ml_engine = LiveMLIDRServer()


class IDRRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            status = {
                "status": "ONLINE",
                "backend": "Python PyTorch Live Inference Server",
                "device": str(ml_engine.device),
                "pytorch_model_loaded": ml_engine.model_loaded,
                "personalization": ml_engine.personalizer.state.to_dict()
            }
            self.wfile.write(json.dumps(status).encode("utf-8"))
            return
            
        return super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        data = json.loads(body) if body else {}

        if self.path == "/api/reset":
            ml_engine.reset(
                init_pos=data.get("init_pos", [0.0, 0.0, 0.0]),
                init_speed=data.get("init_speed", 12.5),
                init_heading_deg=data.get("init_heading_deg", 0.0)
            )
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "RESET_OK"}).encode("utf-8"))
            return

        elif self.path == "/api/step":
            accel = data.get("accel", [0.0, 0.0, 9.806])
            gyro = data.get("gyro", [0.0, 0.0, 0.0])
            dt = float(data.get("dt", 0.1))
            is_blackout = bool(data.get("is_blackout", False))
            gnss_speed = data.get("gnss_speed", None)

            res = ml_engine.step(accel, gyro, dt, is_blackout, gnss_speed)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        elif self.path == "/api/personalize":
            accel = data.get("accel", [0.0, 0.0, 9.806])
            gyro = data.get("gyro", [0.0, 0.0, 0.0])
            gnss_spd = float(data.get("gnss_speed", 12.0))
            gnss_head = float(data.get("gnss_heading", 0.0))
            dt = float(data.get("dt", 0.1))

            res = ml_engine.personalize_step(accel, gyro, gnss_spd, gnss_head, dt)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()


def run_server(port=8080):
    print("=" * 80)
    print(f"SIH 26168 — PYTHON ML INFERENCE & WEB CONSOLE SERVER (PORT {port})")
    print("Live PyTorch Neural Models + 15-State ES-EKF + 3D Strapdown INS")
    print(f"Open: http://localhost:{port}")
    print("=" * 80)
    httpd = HTTPServer(("", port), IDRRequestHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    run_server(port)
