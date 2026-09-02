"""
Navisense IDR - FastAPI Live Streaming Server
Provides REST endpoints and high-frequency WebSocket telemetry stream.
"""

import sys, asyncio, json
from pathlib import Path
from typing import Optional, Set

# Ensure project root is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.engine.runtime import NaviSenseRuntime, SCENARIOS
from backend.engine.telemetry_schema import TelemetryPacket, ScenarioInfo

app = FastAPI(
    title="Navisense IDR Live Navigation API",
    description="Real-time PyTorch learned inertial navigation engine and telemetry streaming server."
)

# Enable CORS for frontend Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Runtime Instance
runtime = NaviSenseRuntime(device="cpu")

# Active WebSocket connections
active_connections: Set[WebSocket] = set()

class SelectScenarioRequest(BaseModel):
    scenario_id: str

class PlaybackControlRequest(BaseModel):
    action: str  # "play", "pause", "reset", "step"
    speed: Optional[float] = None

class BlackoutToggleRequest(BaseModel):
    blackout_active: Optional[bool] = None

@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "engine": "Navisense PyTorch IDR",
        "scenario": runtime.current_scenario_id,
        "step": runtime.current_step,
        "blackout_active": runtime.blackout_active
    }

@app.get("/api/scenarios")
async def list_scenarios():
    items = []
    for s_id, s_cfg in SCENARIOS.items():
        items.append({
            "id": s_id,
            "name": s_cfg["name"],
            "description": s_cfg["description"],
            "metrics": s_cfg["canonical_metrics"]
        })
    return {
        "scenarios": items,
        "active_scenario": runtime.get_scenario_info()
    }

@app.post("/api/scenario/select")
async def select_scenario(req: SelectScenarioRequest):
    runtime.load_scenario(req.scenario_id)
    return {
        "status": "scenario_loaded",
        "active_scenario": runtime.get_scenario_info()
    }

@app.post("/api/blackout/toggle")
async def toggle_blackout(req: BlackoutToggleRequest):
    new_state = runtime.toggle_blackout(req.blackout_active)
    return {
        "blackout_active": new_state,
        "timestamp_s": round(runtime.current_step * runtime.dt, 2)
    }

@app.post("/api/playback/control")
async def control_playback(req: PlaybackControlRequest):
    if req.action == "play":
        runtime.is_playing = True
    elif req.action == "pause":
        runtime.is_playing = False
    elif req.action == "reset":
        runtime.load_scenario(runtime.current_scenario_id)
    elif req.action == "step":
        runtime.is_playing = False
        runtime.step()

    if req.speed is not None:
        runtime.playback_speed = max(0.2, min(10.0, float(req.speed)))

    return {
        "is_playing": runtime.is_playing,
        "playback_speed": runtime.playback_speed,
        "current_step": runtime.current_step
    }

@app.websocket("/ws/telemetry")
async def websocket_telemetry_stream(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    print(f"[WS] Client connected! Total active connections: {len(active_connections)}")

    # Send scenario info and initial stationary frame upon connection
    await websocket.send_text(json.dumps({
        "type": "scenario_info",
        "data": runtime.get_scenario_info().model_dump()
    }))
    init_pkt = runtime.get_initial_packet()
    await websocket.send_text(json.dumps({
        "type": "telemetry",
        "data": init_pkt.model_dump()
    }))

    try:
        # Background task to listen for client commands (e.g. blackout toggle)
        async def receive_commands():
            while True:
                msg = await websocket.receive_text()
                try:
                    data = json.loads(msg)
                    cmd = data.get("command")
                    if cmd == "toggle_blackout":
                        runtime.toggle_blackout()
                    elif cmd == "set_blackout":
                        runtime.toggle_blackout(data.get("active", False))
                    elif cmd == "set_speed":
                        runtime.playback_speed = float(data.get("speed", 1.0))
                    elif cmd == "select_scenario":
                        runtime.load_scenario(data.get("scenario_id", "highway"))
                        await websocket.send_text(json.dumps({
                            "type": "scenario_info",
                            "data": runtime.get_scenario_info().model_dump()
                        }))
                except Exception as e:
                    print(f"[WS] Command error: {e}")

        asyncio.create_task(receive_commands())

        # Streaming loop at 10 Hz scaled by playback speed
        while True:
            if runtime.is_playing:
                packet = runtime.step()
                if packet is not None:
                    payload = json.dumps({
                        "type": "telemetry",
                        "data": packet.model_dump()
                    })
                    await websocket.send_text(payload)

            sleep_time = max(0.01, (runtime.dt / max(0.1, runtime.playback_speed)))
            await asyncio.sleep(sleep_time)

    except WebSocketDisconnect:
        active_connections.remove(websocket)
        print(f"[WS] Client disconnected. Remaining: {len(active_connections)}")
    except Exception as e:
        if websocket in active_connections:
            active_connections.remove(websocket)
        print(f"[WS] Stream closed: {e}")

from fastapi.staticfiles import StaticFiles

# Mount frontend production build if available
frontend_dist = ROOT_DIR / "frontend/dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
    print(f"[SERVER] Mounted frontend UI from {frontend_dist}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
