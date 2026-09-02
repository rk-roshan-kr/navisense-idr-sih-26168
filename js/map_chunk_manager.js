/**
 * MapChunkManager — Offline tile caching with Minecraft-style chunk eviction
 *
 * How it works:
 *   1. planRoute()   → pre-fetches all OSM tiles for the route at z13-z16
 *   2. updatePos()   → keeps only tiles within 3km radius, evicts the rest
 *   3. CachedTileLayer → serves tiles from Cache API first, network as fallback
 *
 * No internet required after initial tile fetch.
 */

class MapChunkManager {
  constructor() {
    this.CACHE_NAME    = 'navisense-map-tiles-v1';
    this.CHUNK_RADIUS  = 3000;   // metres — keep chunks within 3km of vehicle
    this.ZOOM_LEVELS   = [13, 14, 15, 16];
    this.OSM_URL       = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.SUBDOMAINS    = ['a', 'b', 'c'];

    this.cachedTiles   = new Set();  // track which URLs are cached
    this.fetchQueue    = [];
    this.fetching      = false;
    this.totalTiles    = 0;
    this.fetchedTiles  = 0;

    this.onProgress    = null;  // callback(pct, fetched, total)
  }

  // ── Tile math ─────────────────────────────────────────────────────────────

  _tileX(lng, z) {
    return Math.floor((lng + 180) / 360 * Math.pow(2, z));
  }

  _tileY(lat, z) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
  }

  _tileLat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  _tileLng(x, z) {
    return x / Math.pow(2, z) * 360 - 180;
  }

  _tileUrl(x, y, z) {
    const s = this.SUBDOMAINS[(x + y) % 3];
    return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }

  _haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ── Get all tile coords covering a bounding box ───────────────────────────

  _tilesForBounds(minLat, maxLat, minLng, maxLng, z) {
    const x0 = this._tileX(minLng, z);
    const x1 = this._tileX(maxLng, z);
    const y0 = this._tileY(maxLat, z);  // note: tile Y is flipped
    const y1 = this._tileY(minLat, z);
    const tiles = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        tiles.push({ x, y, z });
      }
    }
    return tiles;
  }

  // ── Pre-load route tiles (call with internet available) ───────────────────

  async preloadRoute(coords) {
    // Compute bounding box of entire route + 400m buffer
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    const BUF  = 0.004; // ~400m in degrees
    const bounds = {
      minLat: Math.min(...lats) - BUF,
      maxLat: Math.max(...lats) + BUF,
      minLng: Math.min(...lngs) - BUF,
      maxLng: Math.max(...lngs) + BUF
    };

    // Collect all tile URLs
    const allTiles = [];
    for (const z of this.ZOOM_LEVELS) {
      const tiles = this._tilesForBounds(bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng, z);
      for (const t of tiles) allTiles.push(this._tileUrl(t.x, t.y, t.z));
    }

    this.totalTiles  = allTiles.length;
    this.fetchedTiles = 0;
    console.log(`[MapChunk] Pre-fetching ${this.totalTiles} tiles for offline use...`);

    const cache = await caches.open(this.CACHE_NAME);

    // Fetch in parallel batches of 8
    const BATCH = 8;
    for (let i = 0; i < allTiles.length; i += BATCH) {
      const batch = allTiles.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async url => {
        try {
          const existing = await cache.match(url);
          if (!existing) {
            const resp = await fetch(url, { mode: 'cors' });
            if (resp.ok) await cache.put(url, resp);
          }
          this.cachedTiles.add(url);
        } catch (e) { /* network may be slow, skip tile */ }
        this.fetchedTiles++;
        if (this.onProgress) {
          this.onProgress(this.fetchedTiles / this.totalTiles, this.fetchedTiles, this.totalTiles);
        }
      }));
    }

    console.log(`[MapChunk] Done. ${this.cachedTiles.size} tiles cached.`);
    return this.cachedTiles.size;
  }

  // ── Chunk eviction — call periodically as vehicle moves ──────────────────

  async evictDistantTiles(vehicleLat, vehicleLng) {
    if (!('caches' in window)) return;
    const cache = await caches.open(this.CACHE_NAME);
    const keys  = await cache.keys();

    let evicted = 0;
    for (const req of keys) {
      const url = req.url;
      // Parse z/x/y from URL: .../z/x/y.png
      const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png/);
      if (!m) continue;
      const z = parseInt(m[1]), x = parseInt(m[2]), y = parseInt(m[3]);
      // Only evict at high zoom (z14+) to save memory
      if (z < 14) continue;

      // Tile centre lat/lng
      const tileLat = this._tileLat(y + 0.5, z);
      const tileLng = this._tileLng(x + 0.5, z);
      const dist    = this._haversineM(vehicleLat, vehicleLng, tileLat, tileLng);

      if (dist > this.CHUNK_RADIUS) {
        await cache.delete(req);
        this.cachedTiles.delete(url);
        evicted++;
      }
    }
    if (evicted > 0) console.log(`[MapChunk] Evicted ${evicted} distant tiles (${this.cachedTiles.size} remain).`);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getCacheStats() {
    if (!('caches' in window)) return { count: 0, sizeMB: '?' };
    const cache = await caches.open(this.CACHE_NAME);
    const keys  = await cache.keys();
    return { count: keys.length };
  }
}

// ── Cached Tile Layer for Leaflet ─────────────────────────────────────────────

class CachedTileLayer extends L.TileLayer {
  createTile(coords, done) {
    const img = document.createElement('img');
    img.alt   = '';
    const url = this.getTileUrl(coords);

    if ('caches' in window) {
      caches.open('navisense-map-tiles-v1').then(cache => {
        cache.match(url).then(resp => {
          if (resp) {
            // Serve from cache
            resp.blob().then(blob => {
              img.src = URL.createObjectURL(blob);
              done(null, img);
            });
          } else {
            // Network fallback + opportunistic cache
            img.crossOrigin = '';
            img.src = url;
            img.onload  = () => {
              done(null, img);
              fetch(url, { mode: 'cors' }).then(r => { if (r.ok) cache.put(url, r); }).catch(()=>{});
            };
            img.onerror = e => done(e, img);
          }
        }).catch(() => {
          img.src = url;
          img.onload  = () => done(null, img);
          img.onerror = e => done(e, img);
        });
      });
    } else {
      img.src = url;
      img.onload  = () => done(null, img);
      img.onerror = e => done(e, img);
    }

    return img;
  }
}

window.MapChunkManager = MapChunkManager;
window.CachedTileLayer = CachedTileLayer;
