// ============================================================================
// geo.js — High-Speed TypedArray 3D Mesh Builder & Stylized Primitives
// Vertex Layout (12 floats / 48 bytes):
//   [0..2] aPos (x,y,z)
//   [3..5] aNormal (nx,ny,nz)
//   [6..8] aColor (sRGB 0..1)
//   [9..11] aParam (matId, vertexAO, extra/windWeight)
// ============================================================================

const GEO = (() => {
  const STRIDE = 12;

  class MeshBuilder {
    constructor(initialVerts = 4096) {
      this.data = new Float32Array(initialVerts * STRIDE);
      this.vertCount = 0;
    }

    clear() {
      this.vertCount = 0;
    }

    ensure(addVerts) {
      const needed = (this.vertCount + addVerts) * STRIDE;
      if (needed <= this.data.length) return;
      let nextLen = this.data.length * 2;
      while (nextLen < needed) nextLen *= 2;
      const next = new Float32Array(nextLen);
      next.set(this.data.subarray(0, this.vertCount * STRIDE));
      this.data = next;
    }

    pushVert(x, y, z, nx, ny, nz, r, g, b, matId, ao = 1.0, extra = 0.0) {
      this.ensure(1);
      const o = this.vertCount * STRIDE;
      const d = this.data;
      d[o] = x; d[o + 1] = y; d[o + 2] = z;
      d[o + 3] = nx; d[o + 4] = ny; d[o + 5] = nz;
      d[o + 6] = r; d[o + 7] = g; d[o + 8] = b;
      d[o + 9] = matId; d[o + 10] = ao; d[o + 11] = extra;
      this.vertCount++;
    }

    appendFloatArray(arr) {
      if (!arr || arr.length === 0) return;
      const vCount = (arr.length / STRIDE) | 0;
      this.ensure(vCount);
      this.data.set(arr.subarray(0, vCount * STRIDE), this.vertCount * STRIDE);
      this.vertCount += vCount;
    }

    toFloat32Array() {
      return this.data.slice(0, this.vertCount * STRIDE);
    }

    subarrayView() {
      return this.data.subarray(0, this.vertCount * STRIDE);
    }

    // Counter-clockwise triangle with automatic face normal
    addTri(
      x0, y0, z0,
      x1, y1, z1,
      x2, y2, z2,
      r, g, b, matId,
      ao0 = 1, ao1 = 1, ao2 = 1,
      extra = 0
    ) {
      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
      const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      this.ensure(3);
      this.pushVert(x0, y0, z0, nx, ny, nz, r, g, b, matId, ao0, extra);
      this.pushVert(x1, y1, z1, nx, ny, nz, r, g, b, matId, ao1, extra);
      this.pushVert(x2, y2, z2, nx, ny, nz, r, g, b, matId, ao2, extra);
    }

    // Quad p0(BL) -> p1(BR) -> p2(TR) -> p3(TL) CCW when viewed from front
    addQuad(
      x0, y0, z0,
      x1, y1, z1,
      x2, y2, z2,
      x3, y3, z3,
      r, g, b, matId,
      aoBot = 0.85, aoTop = 1.0,
      extra = 0
    ) {
      this.addTri(x0, y0, z0, x1, y1, z1, x2, y2, z2, r, g, b, matId, aoBot, aoBot, aoTop, extra);
      this.addTri(x0, y0, z0, x2, y2, z2, x3, y3, z3, r, g, b, matId, aoBot, aoTop, aoTop, extra);
    }

    // Oriented box in world space centered at (cx, cy, cz), full sizes (sx, sy, sz), rotated around Y by yaw
    addBox(cx, cy, cz, sx, sy, sz, yaw, r, g, b, matId, aoBot = 0.78, aoTop = 1.0, extra = 0, omitBottom = true) {
      const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const wx = (lx, lz) => cx + lx * c - lz * s;
      const wz = (lx, lz) => cz + lx * s + lz * c;

      const y0 = cy - hy, y1 = cy + hy;
      // 4 bottom & 4 top corners
      const xNN = wx(-hx, -hz), zNN = wz(-hx, -hz);
      const xPN = wx(hx, -hz),  zPN = wz(hx, -hz);
      const xPP = wx(hx, hz),   zPP = wz(hx, hz);
      const xNP = wx(-hx, hz),  zNP = wz(-hx, hz);

      // +Z face
      this.addQuad(xNP, y0, zNP, xPP, y0, zPP, xPP, y1, zPP, xNP, y1, zNP, r, g, b, matId, aoBot, aoTop, extra);
      // -Z face
      this.addQuad(xPN, y0, zPN, xNN, y0, zNN, xNN, y1, zNN, xPN, y1, zPN, r, g, b, matId, aoBot, aoTop, extra);
      // +X face
      this.addQuad(xPP, y0, zPP, xPN, y0, zPN, xPN, y1, zPN, xPP, y1, zPP, r, g, b, matId, aoBot, aoTop, extra);
      // -X face
      this.addQuad(xNN, y0, zNN, xNP, y0, zNP, xNP, y1, zNP, xNN, y1, zNN, r, g, b, matId, aoBot, aoTop, extra);
      // +Y top
      this.addQuad(xNP, y1, zNP, xPP, y1, zPP, xPN, y1, zPN, xNN, y1, zNN, r, g, b, matId, aoTop, aoTop, extra);
      if (!omitBottom) {
        this.addQuad(xNN, y0, zNN, xPN, y0, zPN, xPP, y0, zPP, xNP, y0, zNP, r, g, b, matId, aoBot * 0.85, aoBot * 0.85, extra);
      }
    }

    // Box placed in a building's local coordinate frame (origin ox,oy,oz, yaw)
    addLocalBox(ox, oy, oz, yaw, lx, ly, lz, sx, sy, sz, localYaw, r, g, b, matId, aoBot = 0.78, aoTop = 1.0, extra = 0, omitBottom = true) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const wx = ox + lx * c - lz * s;
      const wz = oz + lx * s + lz * c;
      this.addBox(wx, oy + ly, wz, sx, sy, sz, yaw + (localYaw || 0), r, g, b, matId, aoBot, aoTop, extra, omitBottom);
    }

    // Smooth-shaded tapered cylinder/branch between P0 and P1
    addTaperedTube(x0, y0, z0, r0, x1, y1, z1, r1, segs, r, g, b, matId, ao0 = 0.75, ao1 = 1.0, extra = 0, capTop = true) {
      let ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
      const len = Math.hypot(ax, ay, az);
      if (len < 1e-5) return;
      ax /= len; ay /= len; az /= len;

      // Orthogonal basis (u, v) around axis a
      let refX = Math.abs(ay) > 0.9 ? 1 : 0;
      let refY = Math.abs(ay) > 0.9 ? 0 : 1;
      let ux = ay * 0 - az * refY;
      let uy = az * refX - ax * 0;
      let uz = ax * refY - ay * refX;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;

      const vx = ay * uz - az * uy;
      const vy = az * ux - ax * uz;
      const vz = ax * uy - ay * ux;

      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * M.TAU;
        const a1 = ((i + 1) / segs) * M.TAU;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);

        const n0x = ux * c0 + vx * s0, n0y = uy * c0 + vy * s0, n0z = uz * c0 + vz * s0;
        const n1x = ux * c1 + vx * s1, n1y = uy * c1 + vy * s1, n1z = uz * c1 + vz * s1;

        const p00x = x0 + n0x * r0, p00y = y0 + n0y * r0, p00z = z0 + n0z * r0;
        const p10x = x0 + n1x * r0, p10y = y0 + n1y * r0, p10z = z0 + n1z * r0;
        const p11x = x1 + n1x * r1, p11y = y1 + n1y * r1, p11z = z1 + n1z * r1;
        const p01x = x1 + n0x * r1, p01y = y1 + n0y * r1, p01z = z1 + n0z * r1;

        this.ensure(6);
        this.pushVert(p00x, p00y, p00z, n0x, n0y, n0z, r, g, b, matId, ao0, extra);
        this.pushVert(p10x, p10y, p10z, n1x, n1y, n1z, r, g, b, matId, ao0, extra);
        this.pushVert(p11x, p11y, p11z, n1x, n1y, n1z, r, g, b, matId, ao1, extra);

        this.pushVert(p00x, p00y, p00z, n0x, n0y, n0z, r, g, b, matId, ao0, extra);
        this.pushVert(p11x, p11y, p11z, n1x, n1y, n1z, r, g, b, matId, ao1, extra);
        this.pushVert(p01x, p01y, p01z, n0x, n0y, n0z, r, g, b, matId, ao1, extra);

        if (capTop && r1 > 0.005) {
          this.pushVert(x1, y1, z1, ax, ay, az, r, g, b, matId, ao1, extra);
          this.pushVert(p01x, p01y, p01z, ax, ay, az, r, g, b, matId, ao1, extra);
          this.pushVert(p11x, p11y, p11z, ax, ay, az, r, g, b, matId, ao1, extra);
        }
      }
    }

    // Stylized sphere/ellipsoid puff (for Ghibli tree foliage, bushes, sheep wool, rocks)
    // normalBlend = 0 -> pure ellipsoid normal; normalBlend > 0 -> blends toward canopy center for Ghibli shading!
    addPuff(
      cx, cy, cz, rx, ry, rz,
      latSegs, lonSegs,
      r, g, b, matId,
      ao = 0.92, extra = 0,
      lumpSeed = 0, lumpAmp = 0.12,
      canopyCenter = null, normalBlend = 0.0
    ) {
      const pt = (iLat, iLon) => {
        const v = iLat / latSegs;
        const phi = v * Math.PI;
        const theta = (iLon / lonSegs) * M.TAU;
        const sp = Math.sin(phi), cp = Math.cos(phi);
        const ct = Math.cos(theta), st = Math.sin(theta);
        const dx = sp * ct;
        const dy = cp;
        const dz = sp * st;

        let disp = 1.0;
        if (lumpAmp > 0) {
          const n = M.noise2D(dx * 2.4 + lumpSeed * 7.13, dz * 2.4 + dy * 1.9 + lumpSeed * 3.7);
          disp = 1.0 + (n - 0.5) * 2.0 * lumpAmp;
        }
        const px = cx + dx * rx * disp;
        const py = cy + dy * ry * disp;
        const pz = cz + dz * rz * disp;

        let nx = dx / (rx || 1);
        let ny = dy / (ry || 1);
        let nz = dz / (rz || 1);
        let nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;

        if (canopyCenter && normalBlend > 0) {
          let gx = px - canopyCenter[0];
          let gy = py - canopyCenter[1];
          let gz = pz - canopyCenter[2];
          const gl = Math.hypot(gx, gy, gz) || 1;
          gx /= gl; gy /= gl; gz /= gl;
          nx = M.lerp(nx, gx, normalBlend);
          ny = M.lerp(ny, gy, normalBlend);
          nz = M.lerp(nz, gz, normalBlend);
          nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
        }

        const vao = ao * M.lerp(0.62, 1.06, dy * 0.5 + 0.5);
        return { px, py, pz, nx, ny, nz, vao };
      };

      for (let i = 0; i < latSegs; i++) {
        for (let j = 0; j < lonSegs; j++) {
          const p00 = pt(i, j);
          const p10 = pt(i + 1, j);
          const p11 = pt(i + 1, j + 1);
          const p01 = pt(i, j + 1);
          // Notice: phi=0 is +Y pole, increasing i goes down to -Y; theta goes +X -> +Z (CW from top), so swap winding for outward CCW!
          if (i > 0) {
            this.ensure(3);
            this.pushVert(p00.px, p00.py, p00.pz, p00.nx, p00.ny, p00.nz, r, g, b, matId, p00.vao, extra);
            this.pushVert(p01.px, p01.py, p01.pz, p01.nx, p01.ny, p01.nz, r, g, b, matId, p01.vao, extra);
            this.pushVert(p11.px, p11.py, p11.pz, p11.nx, p11.ny, p11.nz, r, g, b, matId, p11.vao, extra);
          }
          if (i < latSegs - 1) {
            this.ensure(3);
            this.pushVert(p00.px, p00.py, p00.pz, p00.nx, p00.ny, p00.nz, r, g, b, matId, p00.vao, extra);
            this.pushVert(p11.px, p11.py, p11.pz, p11.nx, p11.ny, p11.nz, r, g, b, matId, p11.vao, extra);
            this.pushVert(p10.px, p10.py, p10.pz, p10.nx, p10.ny, p10.nz, r, g, b, matId, p10.vao, extra);
          }
        }
      }
    }
  }

  return { STRIDE, MeshBuilder };
})();
