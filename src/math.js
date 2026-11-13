// ============================================================================
// math.js — 3D Math, Noise, Splines, Raycasting & Spring Physics Kernel
// ============================================================================

const M = (() => {
  const PI = Math.PI;
  const TAU = Math.PI * 2;
  const HALF_PI = Math.PI * 0.5;
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const saturate = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = saturate((x - e0) / (e1 - e0 || 1e-6));
    return t * t * (3 - 2 * t);
  };
  const smootherstep = (e0, e1, x) => {
    const t = saturate((x - e0) / (e1 - e0 || 1e-6));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const wrapAngle = (a) => {
    a = (a + PI) % TAU;
    if (a < 0) a += TAU;
    return a - PI;
  };
  const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

  const distSq2D = (x1, z1, x2, z2) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    return dx * dx + dz * dz;
  };
  const dist2D = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);

  // Closest point on 2D segment AB to point P: returns { t, x, z, distSq, dist }
  function closestOnSegment2D(px, pz, ax, az, bx, bz) {
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz;
    let t = lenSq > 1e-8 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
    t = saturate(t);
    const x = ax + abx * t;
    const z = az + abz * t;
    const dx = px - x;
    const dz = pz - z;
    const d2 = dx * dx + dz * dz;
    return { t, x, z, distSq: d2, dist: Math.sqrt(d2) };
  }

  // 2D segment intersection AB vs CD -> returns { hit, t, u, x, z }
  function intersectSegments2D(ax, az, bx, bz, cx, cz, dx, dz) {
    const rX = bx - ax, rZ = bz - az;
    const sX = dx - cx, sZ = dz - cz;
    const denom = rX * sZ - rZ * sX;
    if (Math.abs(denom) < 1e-7) return { hit: false };
    const qpX = cx - ax, qpZ = cz - az;
    const t = (qpX * sZ - qpZ * sX) / denom;
    const u = (qpX * rZ - qpZ * rX) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { hit: true, t, u, x: ax + t * rX, z: az + t * rZ };
    }
    return { hit: false };
  }

  // Deterministic PRNG
  function mulberry32(seed) {
    let a = (seed | 0) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2D(ix, iz) {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function noise2D(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2D(ix, iz);
    const b = hash2D(ix + 1, iz);
    const c = hash2D(ix, iz + 1);
    const d = hash2D(ix + 1, iz + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
  }

  function fbm2D(x, z, octaves = 4, lacunarity = 2.03, gain = 0.5) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise2D(x * freq, z * freq);
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / (norm || 1);
  }

  // Color helpers (linear <-> sRGB & hex)
  function hexToRgb(hex) {
    const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function hexToLinear(hex) {
    const [r, g, b] = hexToRgb(hex);
    return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
  }

  function mixColor(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }

  // Vec3 utilities
  const V3 = {
    create: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
    set: (out, x, y, z) => { out[0] = x; out[1] = y; out[2] = z; return out; },
    copy: (out, a) => { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; },
    add: (out, a, b) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; },
    sub: (out, a, b) => { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; },
    scale: (out, a, s) => { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; },
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (out, a, b) => {
      const ax = a[0], ay = a[1], az = a[2];
      const bx = b[0], by = b[1], bz = b[2];
      out[0] = ay * bz - az * by;
      out[1] = az * bx - ax * bz;
      out[2] = ax * by - ay * bx;
      return out;
    },
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    normalize: (out, a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      out[0] = a[0] / l; out[1] = a[1] / l; out[2] = a[2] / l;
      return out;
    }
  };

  // Column-major 4x4 Matrix utilities
  const Mat4 = {
    create: () => {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    },
    identity: (out) => {
      out.fill(0);
      out[0] = out[5] = out[10] = out[15] = 1;
      return out;
    },
    copy: (out, a) => {
      out.set(a);
      return out;
    },
    multiply: (out, a, b) => {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      let b0, b1, b2, b3;
      b0 = b[0]; b1 = b[1]; b2 = b[2]; b3 = b[3];
      out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
      out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
      out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
      out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      return out;
    },
    perspective: (out, fovy, aspect, near, far) => {
      const f = 1.0 / Math.tan(fovy * 0.5);
      const nf = 1.0 / (near - far);
      out.fill(0);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[14] = 2 * far * near * nf;
      return out;
    },
    ortho: (out, left, right, bottom, top, near, far) => {
      const lr = 1 / (left - right);
      const bt = 1 / (bottom - top);
      const nf = 1 / (near - far);
      out.fill(0);
      out[0] = -2 * lr;
      out[5] = -2 * bt;
      out[10] = 2 * nf;
      out[12] = (left + right) * lr;
      out[13] = (top + bottom) * bt;
      out[14] = (far + near) * nf;
      out[15] = 1;
      return out;
    },
    lookAt: (out, eye, center, up) => {
      let z0 = eye[0] - center[0];
      let z1 = eye[1] - center[1];
      let z2 = eye[2] - center[2];
      let len = Math.hypot(z0, z1, z2) || 1;
      z0 /= len; z1 /= len; z2 /= len;

      let x0 = up[1] * z2 - up[2] * z1;
      let x1 = up[2] * z0 - up[0] * z2;
      let x2 = up[0] * z1 - up[1] * z0;
      len = Math.hypot(x0, x1, x2);
      if (len < 1e-6) { x0 = 1; x1 = 0; x2 = 0; }
      else { x0 /= len; x1 /= len; x2 /= len; }

      const y0 = z1 * x2 - z2 * x1;
      const y1 = z2 * x0 - z0 * x2;
      const y2 = z0 * x1 - z1 * x0;

      out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
      out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
      out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
      out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
      out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
      out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
      out[15] = 1;
      return out;
    },
    invert: (out, a) => {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

      const b00 = a00 * a11 - a01 * a10;
      const b01 = a00 * a12 - a02 * a10;
      const b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11;
      const b04 = a01 * a13 - a03 * a11;
      const b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30;
      const b07 = a20 * a32 - a22 * a30;
      const b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31;
      const b10 = a21 * a33 - a23 * a31;
      const b11 = a22 * a33 - a23 * a32;

      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return Mat4.identity(out);
      det = 1.0 / det;

      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return out;
    }
  };

  // Project 3D world point -> screen pixel { x, y, ndcZ, visible }
  function projectToScreen(wx, wy, wz, viewProj, viewportW, viewportH) {
    const m = viewProj;
    const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
    const cy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
    const cz = m[2] * wx + m[6] * wy + m[10] * wz + m[14];
    const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
    if (cw <= 0.05) return { x: -9999, y: -9999, ndcZ: 2, visible: false };
    const invW = 1 / cw;
    const nx = cx * invW;
    const ny = cy * invW;
    const nz = cz * invW;
    return {
      x: (nx * 0.5 + 0.5) * viewportW,
      y: (0.5 - ny * 0.5) * viewportH,
      ndcZ: nz,
      visible: nx >= -1.15 && nx <= 1.15 && ny >= -1.15 && ny <= 1.15 && nz >= -1 && nz <= 1
    };
  }

  // Unproject screen pixel -> world ray { ox, oy, oz, dx, dy, dz }
  function screenToRay(px, py, viewportW, viewportH, invViewProj) {
    const nx = (px / viewportW) * 2 - 1;
    const ny = 1 - (py / viewportH) * 2;
    const unproj = (z) => {
      const m = invViewProj;
      const x = m[0] * nx + m[4] * ny + m[8] * z + m[12];
      const y = m[1] * nx + m[5] * ny + m[9] * z + m[13];
      const zz = m[2] * nx + m[6] * ny + m[10] * z + m[14];
      const w = m[3] * nx + m[7] * ny + m[11] * z + m[15] || 1;
      return [x / w, y / w, zz / w];
    };
    const pNear = unproj(-1);
    const pFar = unproj(1);
    let dx = pFar[0] - pNear[0];
    let dy = pFar[1] - pNear[1];
    let dz = pFar[2] - pNear[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    return { ox: pNear[0], oy: pNear[1], oz: pNear[2], dx, dy, dz };
  }

  function rayPlaneY(ray, planeY) {
    if (Math.abs(ray.dy) < 1e-6) return null;
    const t = (planeY - ray.oy) / ray.dy;
    if (t < 0) return null;
    return {
      t,
      x: ray.ox + ray.dx * t,
      y: planeY,
      z: ray.oz + ray.dz * t
    };
  }

  // Ray vs oriented box centered at (bx, 0, bz) with yaw, y in [yMin, yMax], half-extents (hx, hz)
  function rayOBB(ray, bx, bz, yaw, hx, hz, yMin, yMax) {
    const c = Math.cos(-yaw);
    const s = Math.sin(-yaw);
    const rox = (ray.ox - bx) * c - (ray.oz - bz) * s;
    const roz = (ray.ox - bx) * s + (ray.oz - bz) * c;
    const rdx = ray.dx * c - ray.dz * s;
    const rdz = ray.dx * s + ray.dz * c;
    const roy = ray.oy;
    const rdy = ray.dy;

    let tMin = -Infinity;
    let tMax = Infinity;
    let hitAxis = 0;
    let hitSign = 1;

    const axes = [
      [rox, rdx, -hx, hx, 0],
      [roy, rdy, yMin, yMax, 1],
      [roz, rdz, -hz, hz, 2]
    ];
    for (let i = 0; i < 3; i++) {
      const [ro, rd, mn, mx, axis] = axes[i];
      if (Math.abs(rd) < 1e-7) {
        if (ro < mn || ro > mx) return null;
      } else {
        let t1 = (mn - ro) / rd;
        let t2 = (mx - ro) / rd;
        let sgn = -1;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sgn = 1; }
        if (t1 > tMin) { tMin = t1; hitAxis = axis; hitSign = sgn; }
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return null;
      }
    }
    if (tMax < 0) return null;
    const t = tMin >= 0 ? tMin : tMax;
    const lx = rox + rdx * t;
    const ly = roy + rdy * t;
    const lz = roz + rdz * t;

    let lnx = 0, lny = 0, lnz = 0;
    if (hitAxis === 0) lnx = hitSign;
    else if (hitAxis === 1) lny = hitSign;
    else lnz = hitSign;

    const wc = Math.cos(yaw), ws = Math.sin(yaw);
    const nx = lnx * wc - lnz * ws;
    const nz = lnx * ws + lnz * wc;
    return {
      t,
      x: ray.ox + ray.dx * t,
      y: ly,
      z: ray.oz + ray.dz * t,
      lx, ly, lz,
      nx, ny: lny, nz,
      hitAxis, hitSign
    };
  }

  // Ray vs vertical cylinder at (cx, cz), radius r, y in [yMin, yMax]
  function rayCylinder(ray, cx, cz, r, yMin, yMax) {
    const ox = ray.ox - cx;
    const oz = ray.oz - cz;
    const a = ray.dx * ray.dx + ray.dz * ray.dz;
    const b = 2 * (ox * ray.dx + oz * ray.dz);
    const c = ox * ox + oz * oz - r * r;
    let bestT = Infinity;
    let bestN = [0, 1, 0];

    if (a > 1e-7) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a);
        const t2 = (-b + sq) / (2 * a);
        for (const t of [t1, t2]) {
          if (t > 0 && t < bestT) {
            const y = ray.oy + ray.dy * t;
            if (y >= yMin && y <= yMax) {
              bestT = t;
              const hx = ox + ray.dx * t;
              const hz = oz + ray.dz * t;
              const inv = 1 / (Math.hypot(hx, hz) || 1);
              bestN = [hx * inv, 0, hz * inv];
            }
          }
        }
      }
    }
    if (Math.abs(ray.dy) > 1e-7) {
      const tTop = (yMax - ray.oy) / ray.dy;
      if (tTop > 0 && tTop < bestT) {
        const hx = ox + ray.dx * tTop;
        const hz = oz + ray.dz * tTop;
        if (hx * hx + hz * hz <= r * r) {
          bestT = tTop;
          bestN = [0, 1, 0];
        }
      }
    }
    if (!Number.isFinite(bestT)) return null;
    return {
      t: bestT,
      x: ray.ox + ray.dx * bestT,
      y: ray.oy + ray.dy * bestT,
      z: ray.oz + ray.dz * bestT,
      nx: bestN[0], ny: bestN[1], nz: bestN[2]
    };
  }

  // Catmull-Rom 2D spline resampling into smooth evenly spaced points [{x, z, tx, tz, u}]
  function resampleSpline2D(ctrlPts, stepDist = 0.45) {
    if (!ctrlPts || ctrlPts.length === 0) return [];
    if (ctrlPts.length === 1) return [{ x: ctrlPts[0].x, z: ctrlPts[0].z, tx: 1, tz: 0, s: 0 }];

    const dense = [];
    const n = ctrlPts.length;
    const getPt = (i) => ctrlPts[clamp(i, 0, n - 1)];

    for (let i = 0; i < n - 1; i++) {
      const p0 = getPt(i - 1);
      const p1 = getPt(i);
      const p2 = getPt(i + 1);
      const p3 = getPt(i + 2);
      const segLen = dist2D(p1.x, p1.z, p2.x, p2.z);
      const steps = Math.max(4, Math.ceil(segLen / (stepDist * 0.45)));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * (
          2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        );
        const z = 0.5 * (
          2 * p1.z +
          (-p0.z + p2.z) * t +
          (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
          (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
        );
        dense.push({ x, z });
      }
    }
    dense.push({ x: ctrlPts[n - 1].x, z: ctrlPts[n - 1].z });

    // Arc-length uniform resampling
    const out = [];
    let acc = 0;
    let nextS = 0;
    out.push({ x: dense[0].x, z: dense[0].z, s: 0, tx: 1, tz: 0 });
    nextS = stepDist;

    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i];
      const d = dist2D(a.x, a.z, b.x, b.z);
      if (d < 1e-5) continue;
      while (acc + d >= nextS) {
        const f = (nextS - acc) / d;
        out.push({ x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), s: nextS, tx: 1, tz: 0 });
        nextS += stepDist;
      }
      acc += d;
    }
    const last = dense[dense.length - 1];
    if (dist2D(out[out.length - 1].x, out[out.length - 1].z, last.x, last.z) > stepDist * 0.25) {
      out.push({ x: last.x, z: last.z, s: acc, tx: 1, tz: 0 });
    } else if (out.length > 1) {
      out[out.length - 1].x = last.x;
      out[out.length - 1].z = last.z;
      out[out.length - 1].s = acc;
    }

    for (let i = 0; i < out.length; i++) {
      const prev = out[Math.max(0, i - 1)];
      const next = out[Math.min(out.length - 1, i + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const l = Math.hypot(tx, tz) || 1;
      out[i].tx = tx / l;
      out[i].tz = tz / l;
    }
    return out;
  }

  return {
    PI, TAU, HALF_PI, DEG2RAD, RAD2DEG,
    clamp, saturate, lerp, smoothstep, smootherstep, wrapAngle, lerpAngle,
    distSq2D, dist2D, closestOnSegment2D, intersectSegments2D,
    mulberry32, hash2D, noise2D, fbm2D,
    hexToRgb, hexToLinear, mixColor,
    V3, Mat4, projectToScreen, screenToRay, rayPlaneY, rayOBB, rayCylinder,
    resampleSpline2D
  };
})();
