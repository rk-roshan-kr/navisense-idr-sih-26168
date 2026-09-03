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

async def broadcast_ws(message: dict):
    payload = json.dumps(message)
    dead = []
    for ws in list(active_connections):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_connections.discard(ws)

# Single 10 Hz Background Engine Loop
async def engine_loop():
    while True:
        try:
            if runtime.is_playing:
                packet = runtime.step()
                if packet is not None:
                    await broadcast_ws({
                        "type": "telemetry",
                        "data": packet.model_dump()
                    })
            sleep_time = max(0.01, (runtime.dt / max(0.1, runtime.playback_speed)))
            await asyncio.sleep(sleep_time)
        except Exception as e:
            print(f"[ENGINE_LOOP] Error: {e}")
            await asyncio.sleep(0.1)

@app.on_event("startup")
async def on_startup():
    asyncio.create_task(engine_loop())

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
    runtime.is_playing = False
    runtime.load_scenario(req.scenario_id)
    sc_info = runtime.get_scenario_info()
    init_pkt = runtime.get_initial_packet()
    await broadcast_ws({"type": "scenario_info", "data": sc_info.model_dump()})
    await broadcast_ws({"type": "telemetry", "data": init_pkt.model_dump()})
    return {
        "status": "scenario_loaded",
        "active_scenario": sc_info
    }

@app.post("/api/blackout/toggle")
async def toggle_blackout(req: BlackoutToggleRequest):
    new_state = runtime.toggle_blackout(req.blackout_active)
    init_pkt = runtime.get_initial_packet()
    await broadcast_ws({"type": "telemetry", "data": init_pkt.model_dump()})
    return {
        "blackout_active": new_state,
        "timestamp_s": round(runtime.current_step * runtime.dt, 2)
    }

@app.post("/api/playback/control")
async def control_playback(req: PlaybackControlRequest):
    if req.action == "play":
        runtime.is_playing = True
        print(f"[PLAYBACK] Play started at step {runtime.current_step}")
    elif req.action == "pause":
        runtime.is_playing = False
        print(f"[PLAYBACK] Play paused at step {runtime.current_step}")
    elif req.action == "reset":
        runtime.is_playing = False
        runtime.load_scenario(runtime.current_scenario_id)
        init_pkt = runtime.get_initial_packet()
        await broadcast_ws({"type": "telemetry", "data": init_pkt.model_dump()})
    elif req.action == "step":
        runtime.is_playing = False
        pkt = runtime.step()
        if pkt:
            await broadcast_ws({"type": "telemetry", "data": pkt.model_dump()})

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

    # Send current scenario info and initial stationary frame upon connection
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
        while True:
            msg = await websocket.receive_text()
            try:
                data = json.loads(msg)
                cmd = data.get("command")
                if cmd == "play":
                    runtime.is_playing = True
                    print(f"[WS] Playback STARTED! Step {runtime.current_step}")
                elif cmd == "pause":
                    runtime.is_playing = False
                    print(f"[WS] Playback PAUSED! Step {runtime.current_step}")
                elif cmd == "toggle_play":
                    runtime.is_playing = not runtime.is_playing
                    print(f"[WS] Playback TOGGLED: {runtime.is_playing}")
                elif cmd == "toggle_blackout":
                    runtime.toggle_blackout()
                    pkt = runtime.get_initial_packet()
                    await broadcast_ws({"type": "telemetry", "data": pkt.model_dump()})
                elif cmd == "set_blackout":
                    runtime.toggle_blackout(data.get("active", False))
                    pkt = runtime.get_initial_packet()
                    await broadcast_ws({"type": "telemetry", "data": pkt.model_dump()})
                elif cmd == "set_speed":
                    runtime.playback_speed = float(data.get("speed", 1.0))
                elif cmd == "select_scenario":
                    s_id = data.get("scenario_id", "bangalore")
                    runtime.is_playing = False
                    runtime.load_scenario(s_id)
                    print(f"[WS] Switched scenario to: {s_id}")
                    sc_info = runtime.get_scenario_info()
                    init_pkt = runtime.get_initial_packet()
                    await broadcast_ws({"type": "scenario_info", "data": sc_info.model_dump()})
                    await broadcast_ws({"type": "telemetry", "data": init_pkt.model_dump()})
            except Exception as e:
                print(f"[WS] Command error: {e}")
    except WebSocketDisconnect:
        pass
    finally:
        active_connections.discard(websocket)
        print(f"[WS] Client disconnected. Remaining: {len(active_connections)}")

from fastapi.staticfiles import StaticFiles

# Mount frontend production build if available
frontend_dist = ROOT_DIR / "frontend/dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
    print(f"[SERVER] Mounted frontend UI from {frontend_dist}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
