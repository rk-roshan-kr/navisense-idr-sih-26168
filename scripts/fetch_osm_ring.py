import urllib.request
import json

overpass_url = 'https://overpass-api.de/api/interpreter'
q = '[out:json];way["ref"="A4053"](52.395,-1.53,52.42,-1.49);(._;>;);out skel;'
req = urllib.request.Request(overpass_url, data=q.encode('utf-8'), headers={'User-Agent': 'NaviSense/1.0'})
try:
    resp = urllib.request.urlopen(req, timeout=10)
    data = json.loads(resp.read().decode('utf-8'))
    nodes = {n['id']: (n['lat'], n['lon']) for n in data.get('elements', []) if n['type'] == 'node'}
    ways = [w for w in data.get('elements', []) if w['type'] == 'way']
    print(f'Found {len(ways)} ways, {len(nodes)} nodes on A4053 Ring Road!')
    for i, w in enumerate(ways[:3]):
        coords = [nodes[nid] for nid in w['nodes'] if nid in nodes]
        print(f'Way {i}: {len(coords)} points, first: {coords[0]}')
except Exception as e:
    print('Overpass error:', e)
