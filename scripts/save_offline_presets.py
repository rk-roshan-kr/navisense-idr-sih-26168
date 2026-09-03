import urllib.request
import json

presets = [
  {"key": "ring", "name": "City Ring Expressway", "orig": [-1.5106, 52.4082], "dest": [-1.5020, 52.4180]},
  {"key": "a45", "name": "A45 Highway Corridor", "orig": [-1.5500, 52.3950], "dest": [-1.5200, 52.4120]},
  {"key": "uni", "name": "University Campus to Center", "orig": [-1.5030, 52.4060], "dest": [-1.5140, 52.4110]}
]

result = {}
for p in presets:
    url = f"https://router.project-osrm.org/route/v1/driving/{p['orig'][0]},{p['orig'][1]};{p['dest'][0]},{p['dest'][1]}?geometries=geojson&overview=full"
    req = urllib.request.Request(url, headers={'User-Agent': 'NaviSense/1.0'})
    resp = urllib.request.urlopen(req, timeout=5)
    data = json.loads(resp.read().decode('utf-8'))
    pts = [[round(c[1], 6), round(c[0], 6)] for c in data['routes'][0]['geometry']['coordinates']]
    print(f"{p['name']}: {len(pts)} points")
    result[p['key']] = pts

with open("frontend/src/utils/offlinePresets.json", "w") as f:
    json.dump(result, f)
print("Saved to frontend/src/utils/offlinePresets.json")
