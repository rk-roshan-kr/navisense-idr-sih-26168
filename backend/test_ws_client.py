import asyncio
import websockets
import json

async def test_ws():
    uri = 'ws://127.0.0.1:8000/ws/telemetry'
    async with websockets.connect(uri) as ws:
        info_msg = await ws.recv()
        info_data = json.loads(info_msg)
        print("1. Received scenario info packet:", info_data["type"])

        for i in range(3):
            t_msg = await ws.recv()
            t_data = json.loads(t_msg)["data"]
            mode = t_data["mode"]
            spd = t_data["speed_kmh"]
            drift = t_data["drift_pct"]
            lat = t_data["idr_position"]["lat"]
            print(f"2. Telemetry {i+1}: mode={mode}, speed={spd} km/h, drift={drift}%, lat={lat:.5f}")

        print("3. Sending toggle_blackout command...")
        await ws.send(json.dumps({"command": "toggle_blackout"}))

        bo_msg = await ws.recv()
        bo_data = json.loads(bo_msg)["data"]
        print(f"4. Post-blackout: mode={bo_data['mode']}, blackout_active={bo_data['blackout_active']}")

if __name__ == "__main__":
    asyncio.run(test_ws())
