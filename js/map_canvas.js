/**
 * NAVISENSE — Clean Vector Navigation Map Renderer
 */

class MapCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    
    this.zoom = 1.25;
    this.panX = 0;
    this.panY = 0;
    this.followVehicle = true;
    
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas || !this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(this.dpr, this.dpr);
    }
  }

  recenter(targetPos = [0, 0]) {
    this.panX = targetPos[0];
    this.panY = targetPos[1];
  }

  render(data) {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const road = data.road || {};
    const gnssPath = data.gnssPath || [];
    const idrPath = data.idrPath || [];
    const vehiclePose = data.vehiclePose || { position: [0, 0], heading: 0 };
    const isBlackout = !!data.isBlackout;

    if (this.followVehicle && vehiclePose.position) {
      this.panX += (vehiclePose.position[0] - this.panX) * 0.18;
      this.panY += (vehiclePose.position[1] - this.panY) * 0.18;
    }

    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const scale = 2.8 * this.zoom;

    const toScreen = (x, y) => ({
      x: centerX + (x - this.panX) * scale,
      y: centerY - (y - this.panY) * scale
    });

    // 1. Dark Map Surface
    ctx.fillStyle = '#04070c';
    ctx.fillRect(0, 0, this.width, this.height);

    // Grid
    this._drawGrid(ctx, toScreen, scale);

    // 2. Physical Road
    if (road.centerline && road.centerline.length > 1) {
      this._drawRoad(ctx, road.centerline, toScreen);
    }

    // 3. Corridor Glow during Blackout
    if (isBlackout && idrPath.length > 2) {
      this._drawCorridorGlow(ctx, idrPath, toScreen);
    }

    // 4. Green GPS Reference Line (stops during blackout)
    if (gnssPath.length > 1 && !isBlackout) {
      this._drawPolyline(ctx, gnssPath, toScreen, '#00ff66', 2.8);
    }

    // 5. Blue IDR Navigation Line (continuous)
    if (idrPath.length > 1) {
      this._drawPolyline(ctx, idrPath, toScreen, '#0088ff', 3.4);
    }

    // 6. Directional Vehicle
    if (vehiclePose.position) {
      this._drawVehicle(ctx, vehiclePose.position, vehiclePose.heading, toScreen, isBlackout);
    }
  }

  _drawGrid(ctx, toScreen, scale) {
    ctx.save();
    ctx.strokeStyle = '#0a0f18';
    ctx.lineWidth = 1;

    const step = 60;
    const minX = this.panX - (this.width / (2 * scale));
    const maxX = this.panX + (this.width / (2 * scale));
    const minY = this.panY - (this.height / (2 * scale));
    const maxY = this.panY + (this.height / (2 * scale));

    const startX = Math.floor(minX / step) * step;
    const startY = Math.floor(minY / step) * step;

    for (let x = startX; x <= maxX; x += step) {
      const p1 = toScreen(x, minY);
      ctx.beginPath();
      ctx.moveTo(p1.x, 0);
      ctx.lineTo(p1.x, this.height);
      ctx.stroke();
    }

    for (let y = startY; y <= maxY; y += step) {
      const p1 = toScreen(minX, y);
      ctx.beginPath();
      ctx.moveTo(0, p1.y);
      ctx.lineTo(this.width, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawRoad(ctx, center, toScreen) {
    if (!center || center.length < 2) return;
    ctx.save();

    // Asphalt bed
    ctx.strokeStyle = '#121722';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const p0 = toScreen(center[0][0], center[0][1]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < center.length; i++) {
      const p = toScreen(center[i][0], center[i][1]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Curb
    ctx.strokeStyle = '#222d3d';
    ctx.lineWidth = 28;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    // Dashed Centerline
    ctx.strokeStyle = '#384860';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < center.length; i++) {
      const p = toScreen(center[i][0], center[i][1]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    ctx.restore();
  }

  _drawCorridorGlow(ctx, path, toScreen) {
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 136, 255, 0.18)';
    ctx.lineWidth = 32;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const p0 = toScreen(path[0][0], path[0][1]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < path.length; i++) {
      const p = toScreen(path[i][0], path[i][1]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }

  _drawPolyline(ctx, points, toScreen, color, width) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const p0 = toScreen(points[0][0], points[0][1]);
    ctx.moveTo(p0.x, p0.y);

    for (let i = 1; i < points.length; i++) {
      const p = toScreen(points[i][0], points[i][1]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawVehicle(ctx, pos, headingDeg, toScreen, isBlackout) {
    const pt = toScreen(pos[0], pos[1]);
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate((headingDeg * Math.PI) / 180);

    // Headlight cone
    const grad = ctx.createRadialGradient(0, 0, 2, 0, -40, 32);
    grad.addColorStop(0, isBlackout ? 'rgba(255, 50, 60, 0.4)' : 'rgba(0, 229, 255, 0.4)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-16, -40);
    ctx.lineTo(16, -40);
    ctx.closePath();
    ctx.fill();

    // Directional car body
    ctx.fillStyle = isBlackout ? '#ff2233' : '#0088ff';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Pivot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

window.MapCanvas = MapCanvas;
