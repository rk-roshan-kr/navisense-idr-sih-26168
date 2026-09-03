import urllib.request
import json

routes = [
  {
    "id": "bangalore",
    "name": "Bangalore: ISRO Tracking Centre ➔ Indiranagar Flats",
    "orig": [77.5186, 13.0334], # ISRO ISTRAC Peenya
    "dest": [77.6400, 12.9780], # Indiranagar
    "city": "Bengaluru, Karnataka",
    "lockdown": [0.35, 0.70] # GPS blackout between 35% and 70% of route
  },
  {
    "id": "delhi",
    "name": "Delhi: Connaught Place ➔ Aerocity Gateway",
    "orig": [77.2167, 28.6315], # Connaught Place
    "dest": [77.1215, 28.5521], # Aerocity Gateway
    "city": "New Delhi, Delhi",
    "lockdown": [0.30, 0.65] # GPS blackout in underpass / airport tunnel
  },
  {
    "id": "chandigarh",
    "name": "Chandigarh: Sector 1 Capitol ➔ Sector 35 Hub",
    "orig": [76.8066, 30.7525], # Sector 1 Capitol Complex / Rock Garden
    "dest": [76.7670, 30.7240], # Sector 35 Hub
    "city": "Chandigarh, UT",
    "lockdown": [0.40, 0.75] # GPS blackout under canopy / underpass
  }
]

out = {}
for r in routes:
    orig = r["orig"]
    dest = r["dest"]
    url = f"https://router.project-osrm.org/route/v1/driving/{orig[0]},{orig[1]};{dest[0]},{dest[1]}?geometries=geojson&overview=full"
    req = urllib.request.Request(url, headers={'User-Agent': 'NaviSense/1.0'})
    resp = urllib.request.urlopen(req, timeout=10)
    data = json.loads(resp.read().decode('utf-8'))
    pts = [[round(c[1], 6), round(c[0], 6)] for c in data['routes'][0]['geometry']['coordinates']]
    dist_km = data['routes'][0]['distance'] / 1000.0
    print(f"Loaded {r['id']}: {len(pts)} points, {dist_km:.2f} km")
    out[r["id"]] = {
        "id": r["id"],
        "name": r["name"],
        "city": r["city"],
        "distance_km": round(dist_km, 2),
        "origin": [round(orig[1], 6), round(orig[0], 6)],
        "destination": [round(dest[1], 6), round(dest[0], 6)],
        "lockdown": r["lockdown"],
        "coordinates": pts
    }

with open("data/indian_preset_routes.json", "w") as f:
    json.dump(out, f, indent=2)
with open("frontend/src/utils/indianPresetRoutes.json", "w") as f:
    json.dump(out, f, indent=2)
print("Saved routes to data/indian_preset_routes.json and frontend/src/utils/indianPresetRoutes.json successfully!")
