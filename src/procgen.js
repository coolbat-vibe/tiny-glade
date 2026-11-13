// ============================================================================
// procgen.js — Procedural Tiny Glade Architecture, Emergent Arches/Doors/Bridges
// ============================================================================

const PROCGEN = (() => {
  const MAT = PALETTES.MAT;

  function jitterColor(rgb, amt, rng) {
    const d = (rng() - 0.5) * 2 * amt;
    return [
      M.clamp(rgb[0] + d, 0, 1),
      M.clamp(rgb[1] + d * 0.95, 0, 1),
      M.clamp(rgb[2] + d * 0.88, 0, 1)
    ];
  }

  // Transform local (lx, ly, lz) -> world [wx, wy, wz]
  function toWorld(ox, oy, oz, yaw, lx, ly, lz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [
      ox + lx * c - lz * s,
      oy + ly,
      oz + lx * s + lz * c
    ];
  }

  // Volume-preserving tactile squash & stretch deformation on a slice of vertex floats
  function applySpringDeformRange(floatBuf, startFloatIdx, endFloatIdx, cx, baseY, cz, scaleY) {
    if (!scaleY || Math.abs(scaleY - 1.0) <= 0.002) return;
    const clampedY = M.clamp(scaleY, 0.55, 1.45);
    const scaleXZ = 1.0 / Math.sqrt(clampedY);
    const stride = GEO.STRIDE;
    for (let o = startFloatIdx; o < endFloatIdx; o += stride) {
      floatBuf[o] = cx + (floatBuf[o] - cx) * scaleXZ;
      floatBuf[o + 1] = baseY + (floatBuf[o + 1] - baseY) * clampedY;
      floatBuf[o + 2] = cz + (floatBuf[o + 2] - cz) * scaleXZ;
    }
  }

  // Emit a cottage window in local coordinates on a wall whose outward normal points along local +Z
  // Local frame passed via (wallOx, wallOy, wallOz, wallYaw) where +Z is outward!
  function emitWallWindow(mb, wOx, wOy, wOz, wYaw, lx, ly, width, height, timberRgb, stoneRgb, shutterRgb, lightsOut, rng) {
    // Stone sill
    mb.addLocalBox(wOx, wOy, wOz, wYaw, lx, ly - height * 0.5 - 0.05, 0.07, width + 0.20, 0.09, 0.16, 0, stoneRgb[0], stoneRgb[1], stoneRgb[2], MAT.STONE, 0.75, 0.95, rng());
    // Timber outer frame
    mb.addLocalBox(wOx, wOy, wOz, wYaw, lx, ly, 0.03, width + 0.12, height + 0.10, 0.08, 0, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.72, 0.92, 0);
    // Glowing window pane
    mb.addLocalBox(wOx, wOy, wOz, wYaw, lx, ly, 0.055, width - 0.04, height - 0.04, 0.04, 0, 1.0, 0.80, 0.44, MAT.WINDOW_GLOW, 1.0, 1.0, 0.4 + rng() * 0.5);
    // Mullion crossbars
    mb.addLocalBox(wOx, wOy, wOz, wYaw, lx, ly, 0.075, 0.045, height, 0.04, 0, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.8, 0.95, 0);
    mb.addLocalBox(wOx, wOy, wOz, wYaw, lx, ly + height * 0.08, 0.075, width, 0.045, 0.04, 0, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.8, 0.95, 0);

    // Cozy open wooden shutters on sides
    const shW = Math.min(0.24, width * 0.36);
    mb.addLocalBox(wOx, wOy, wOz, wYaw, lx - width * 0.5 - shW * 0.55, ly, 0.055, shW, height - 0.02, 0.04, 0.18, shutterRgb[0], shutterRgb[1], shutterRgb[2], MAT.WOOD, 0.75, 0.95, 0);
    mb.addLocalBox(wOx, wOy, wOz, wYaw, lx + width * 0.5 + shW * 0.55, ly, 0.055, shW, height - 0.02, 0.04, -0.18, shutterRgb[0], shutterRgb[1], shutterRgb[2], MAT.WOOD, 0.75, 0.95, 0);

    // Tiny window flowerbox with blooms (50% chance)
    if (rng() < 0.65) {
      mb.addLocalBox(wOx, wOy, wOz, wYaw, lx, ly - height * 0.5 - 0.13, 0.13, width * 0.88, 0.11, 0.14, 0, timberRgb[0] * 1.08, timberRgb[1] * 1.05, timberRgb[2], MAT.WOOD, 0.7, 0.9, 0);
      const bushes = 3;
      for (let k = 0; k < bushes; k++) {
        const bx = lx + (k - 1) * (width * 0.26);
        const wp = toWorld(wOx, wOy, wOz, wYaw, bx, ly - height * 0.5 - 0.05, 0.14);
        mb.addPuff(wp[0], wp[1], wp[2], 0.12, 0.10, 0.11, 4, 6, 0.30, 0.56, 0.24, MAT.FOLIAGE, 0.9, 0.15, k, 0.1);
        const flCol = k % 2 === 0 ? [0.95, 0.42, 0.38] : [0.98, 0.84, 0.32];
        mb.addPuff(wp[0], wp[1] + 0.07, wp[2], 0.055, 0.05, 0.055, 3, 5, flCol[0], flCol[1], flCol[2], MAT.FOLIAGE, 1.0, 0.2, k + 5, 0);
      }
    }

    if (lightsOut) {
      const lp = toWorld(wOx, wOy, wOz, wYaw, lx, ly, 0.32);
      lightsOut.push({ x: lp[0], y: lp[1], z: lp[2], r: 1.0, g: 0.68, b: 0.30, radius: 4.8, kind: 'window' });
    }
  }

  // Emit an emergent arched wooden door + stone keystone surround + terrain steps + lantern + flower pot!
  function emitEmergentDoor(mb, wOx, wOy, wOz, wYaw, lx, floorY, timberRgb, stoneRgb, lightsOut, rng) {
    const doorW = 0.92;
    const doorH = 1.62;
    const archSegs = 7;

    // Dark recessed stone surround + oak door leaf
    const doorWood = [timberRgb[0] * 0.92, timberRgb[1] * 0.88, timberRgb[2] * 0.84];
    mb.addLocalBox(wOx, floorY, wOz, wYaw, lx, doorH * 0.48, 0.04, doorW, doorH * 0.92, 0.09, 0, doorWood[0], doorWood[1], doorWood[2], MAT.WOOD, 0.65, 0.9, 0);
    // Vertical plank grooves / iron strap hinges
    mb.addLocalBox(wOx, floorY, wOz, wYaw, lx - 0.18, doorH * 0.62, 0.09, 0.42, 0.045, 0.03, 0, 0.22, 0.22, 0.24, MAT.STONE, 0.7, 0.85, 0);
    mb.addLocalBox(wOx, floorY, wOz, wYaw, lx - 0.18, doorH * 0.28, 0.09, 0.42, 0.045, 0.03, 0, 0.22, 0.22, 0.24, MAT.STONE, 0.7, 0.85, 0);
    // Brass/iron ring handle
    mb.addLocalBox(wOx, floorY, wOz, wYaw, lx + 0.26, doorH * 0.46, 0.10, 0.07, 0.07, 0.04, 0, 0.78, 0.62, 0.28, MAT.WOOD, 0.9, 1.0, 0);

    // Stone jamb blocks on left & right
    for (let s = -1; s <= 1; s += 2) {
      for (let row = 0; row < 4; row++) {
        const bw = row % 2 === 0 ? 0.22 : 0.17;
        const sc = jitterColor(stoneRgb, 0.05, rng);
        mb.addLocalBox(
          wOx, floorY, wOz, wYaw,
          lx + s * (doorW * 0.5 + bw * 0.42), 0.18 + row * 0.30, 0.07,
          bw, 0.27, 0.16, 0,
          sc[0], sc[1], sc[2], MAT.STONE, 0.72, 0.95, rng()
        );
      }
    }

    // Stone arch voussoirs over top of door
    const archCy = doorH * 0.76;
    const archR = doorW * 0.54;
    for (let i = 0; i < archSegs; i++) {
      const a = Math.PI * (0.08 + 0.84 * (i / (archSegs - 1)));
      const vx = lx - Math.cos(a) * archR;
      const vy = archCy + Math.sin(a) * (archR * 0.78);
      const isKey = i === ((archSegs / 2) | 0);
      const sc = jitterColor(stoneRgb, 0.06, rng);
      mb.addLocalBox(
        wOx, floorY, wOz, wYaw,
        vx, vy, isKey ? 0.095 : 0.075,
        isKey ? 0.22 : 0.18, isKey ? 0.26 : 0.20, 0.17,
        0, sc[0], sc[1], sc[2], MAT.STONE, 0.78, 0.98, rng()
      );
    }

    // Automatic stone threshold steps adapting down to terrain!
    const frontProbe = toWorld(wOx, floorY, wOz, wYaw, lx, 0, 0.95);
    const groundY = TERRAIN.getLandHeight(frontProbe[0], frontProbe[2]);
    const drop = Math.max(0.14, Math.min(2.2, floorY - groundY + 0.08));
    const numSteps = M.clamp(Math.ceil(drop / 0.17), 1, 9);
    const stepRun = 0.21;
    for (let st = 0; st < numSteps; st++) {
      const stepH = drop / numSteps;
      const sy = -st * stepH - stepH * 0.5 + 0.03;
      const depth = 0.30 + st * stepRun;
      const sc = jitterColor(stoneRgb, 0.045, rng);
      mb.addLocalBox(
        wOx, floorY, wOz, wYaw,
        lx, sy, depth * 0.5 + 0.03,
        doorW + 0.30 + st * 0.05, stepH + 0.09, depth,
        0, sc[0], sc[1], sc[2], MAT.STONE, 0.65, 0.94, rng()
      );
    }
    // Stone side cheek-balustrades when stairs have 3+ steps!
    if (numSteps >= 3) {
      const totalDepth = 0.30 + (numSteps - 1) * stepRun;
      for (const sgn of [-1, 1]) {
        const bx = lx + sgn * (doorW * 0.5 + 0.22);
        const sc = jitterColor(stoneRgb, 0.04, rng);
        mb.addLocalBox(
          wOx, floorY, wOz, wYaw,
          bx, -drop * 0.42, totalDepth * 0.42,
          0.16, drop * 0.85 + 0.28, totalDepth * 0.82,
          0, sc[0], sc[1], sc[2], MAT.STONE, 0.68, 0.96, rng()
        );
      }
    }

    // Cozy wall lantern beside door!
    const lanternSide = rng() < 0.5 ? 1 : -1;
    const lLx = lx + lanternSide * (doorW * 0.5 + 0.34);
    const lLy = doorH * 0.78;
    mb.addLocalBox(wOx, floorY, wOz, wYaw, lLx, lLy + 0.12, 0.14, 0.05, 0.05, 0.28, 0, 0.20, 0.20, 0.22, MAT.STONE, 0.8, 0.9, 0);
    mb.addLocalBox(wOx, floorY, wOz, wYaw, lLx, lLy + 0.06, 0.24, 0.18, 0.06, 0.18, 0, 0.22, 0.22, 0.25, MAT.STONE, 0.8, 0.95, 0);
    mb.addLocalBox(wOx, floorY, wOz, wYaw, lLx, lLy - 0.04, 0.24, 0.13, 0.16, 0.13, 0, 1.0, 0.78, 0.36, MAT.LANTERN_GLOW, 1.0, 1.0, 0.9);

    if (lightsOut) {
      const lp = toWorld(wOx, floorY, wOz, wYaw, lLx, lLy - 0.04, 0.36);
      lightsOut.push({ x: lp[0], y: lp[1], z: lp[2], r: 1.0, g: 0.72, b: 0.32, radius: 6.8, kind: 'lantern' });
    }

    // Little terracotta pot with shrub on opposite side of steps
    const potPos = toWorld(wOx, groundY, wOz, wYaw, lx - lanternSide * (doorW * 0.5 + 0.38), 0.14, 0.42);
    mb.addTaperedTube(potPos[0], groundY, potPos[2], 0.11, potPos[0], groundY + 0.24, potPos[2], 0.16, 7, 0.74, 0.38, 0.26, MAT.ROOF_TILE, 0.65, 0.95, 0, true);
    mb.addPuff(potPos[0], groundY + 0.36, potPos[2], 0.19, 0.18, 0.19, 5, 7, 0.32, 0.56, 0.25, MAT.FOLIAGE, 0.92, 0.2, 3.1, 0.12);
  }

  // ==========================================================================
  // 1. RECTANGULAR COTTAGE / HALL / CASTLE KEEP / BRIDGE SPAN
  // ==========================================================================
  function buildRectBuilding(b, lightsOut) {
    const mb = new GEO.MeshBuilder(6144);
    const rng = M.mulberry32(((b.id || 1) * 7919) | 0);
    const roofSw = PALETTES.getRoofSwatch(b.roofId);
    const wallSt = PALETTES.getWallStyle(b.wallId);

    const wallRgb = M.hexToRgb(wallSt.wallHex);
    const stoneRgb = M.hexToRgb(wallSt.stoneHex);
    const timberRgb = M.hexToRgb(wallSt.timberHex);
    const roofRgb = M.hexToRgb(roofSw.hex);
    const roofAltRgb = M.hexToRgb(roofSw.altHex);
    const ridgeRgb = M.hexToRgb(roofSw.ridgeHex);
    const shutterRgb = M.mixColor(roofRgb, timberRgb, 0.35);

    const w = Math.max(1.6, b.w);
    const d = Math.max(1.6, b.d);
    const hx = w * 0.5;
    const hz = d * 0.5;
    const wallH = Math.max(0.9, b.wallH);
    const roofH = Math.max(0.0, b.roofH);
    const yaw = b.yaw || 0;

    // Sample terrain across footprint
    const corners = [
      toWorld(b.x, 0, b.z, yaw, -hx, 0, -hz),
      toWorld(b.x, 0, b.z, yaw, hx, 0, -hz),
      toWorld(b.x, 0, b.z, yaw, hx, 0, hz),
      toWorld(b.x, 0, b.z, yaw, -hx, 0, hz)
    ];
    let minG = TERRAIN.getHeight(b.x, b.z);
    let maxG = minG;
    for (const cp of corners) {
      const gh = TERRAIN.getHeight(cp[0], cp[2]);
      if (gh < minG) minG = gh;
      if (gh > maxG) maxG = gh;
    }
    const centerLandY = Math.max(TERRAIN.WATER_LEVEL + 0.12, TERRAIN.getHeight(b.x, b.z));
    const baseLift = Math.max(0, b.baseLift || 0);
    const floorY = centerLandY + baseLift;
    b._computedFloorY = floorY;
    b._computedTopY = floorY + wallH + roofH;
    b._doors = [];
    b._isBattlement = roofH <= 0.22;

    const overWater = TERRAIN.isWater(b.x, b.z, 0.02);

    // --- A. FOUNDATION / ARCHED COLONNADE / WATER STILTS ---
    if (baseLift > 0.55 || overWater) {
      if (overWater && baseLift < 1.3) {
        // Wooden dock deck + oak piers into water!
        mb.addBox(b.x, floorY - 0.08, b.z, w + 0.45, 0.16, d + 0.45, yaw, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.72, 0.95, 0, false);
        const nxP = Math.max(2, Math.round(w / 2.2) + 1);
        const nzP = Math.max(2, Math.round(d / 2.2) + 1);
        for (let ix = 0; ix < nxP; ix++) {
          for (let iz = 0; iz < nzP; iz++) {
            if (ix > 0 && ix < nxP - 1 && iz > 0 && iz < nzP - 1) continue;
            const lx = -hx + (ix / (nxP - 1)) * w;
            const lz = -hz + (iz / (nzP - 1)) * d;
            const wp = toWorld(b.x, 0, b.z, yaw, lx, 0, lz);
            const bedY = Math.min(TERRAIN.WATER_LEVEL - 0.8, TERRAIN.getHeight(wp[0], wp[2]) - 0.3);
            mb.addTaperedTube(wp[0], bedY, wp[2], 0.13, wp[0], floorY - 0.04, wp[2], 0.14, 6, timberRgb[0] * 0.82, timberRgb[1] * 0.8, timberRgb[2] * 0.78, MAT.WOOD, 0.55, 0.88, 0, false);
          }
        }
      } else {
        // Raised stone arch colonnade / bridge span!
        const plinthCol = jitterColor(stoneRgb, 0.03, rng);
        mb.addBox(b.x, floorY - 0.11, b.z, w + 0.24, 0.22, d + 0.24, yaw, plinthCol[0], plinthCol[1], plinthCol[2], MAT.STONE, 0.72, 0.95, 0.2, false);

        // Corner & mid stone piers + arches if not stacked purely inside another building
        const pierPositions = [
          [-hx + 0.28, -hz + 0.28], [hx - 0.28, -hz + 0.28],
          [hx - 0.28, hz - 0.28], [-hx + 0.28, hz - 0.28]
        ];
        if (w > 4.6) {
          pierPositions.push([0, -hz + 0.28], [0, hz - 0.28]);
        }
        for (const [plx, plz] of pierPositions) {
          const wp = toWorld(b.x, 0, b.z, yaw, plx, 0, plz);
          const gy = Math.min(minG, TERRAIN.getHeight(wp[0], wp[2])) - 0.35;
          const ph = floorY - gy;
          if (ph > 0.2) {
            const sc = jitterColor(stoneRgb, 0.04, rng);
            mb.addBox(wp[0], gy + ph * 0.5, wp[2], 0.56, ph, 0.56, yaw, sc[0], sc[1], sc[2], MAT.STONE, 0.58, 0.92, rng());
          }
        }
        // Timber corbel brackets under floor overhang
        for (let s = -1; s <= 1; s += 2) {
          mb.addLocalBox(b.x, floorY, b.z, yaw, s * (hx - 0.25), -0.32, 0, 0.16, 0.45, d + 0.18, 0, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.65, 0.88, 0, false);
        }
      }
    } else {
      // Solid grounded stone foundation plinth skirt down into hillside
      const skirtBottom = Math.min(minG - 0.45, floorY - 0.55);
      const skirtTop = floorY + 0.32;
      const skirtH = skirtTop - skirtBottom;
      const sc = jitterColor(stoneRgb, 0.03, rng);
      mb.addBox(b.x, skirtBottom + skirtH * 0.5, b.z, w + 0.16, skirtH, d + 0.16, yaw, sc[0], sc[1], sc[2], MAT.STONE, 0.58, 0.90, 0.35);
    }

    // --- B. MAIN BODY WALLS ---
    const wallMat = wallSt.isStone ? MAT.STONE : MAT.PLASTER;
    mb.addBox(b.x, floorY + wallH * 0.5, b.z, w, wallH, d, yaw, wallRgb[0], wallRgb[1], wallRgb[2], wallMat, 0.68, 0.96, (b.id || 1) * 0.17);

    // --- C. 3D ALTERNATING STONE CORNER QUOINS ---
    const quoinStep = 0.36;
    const quoinRows = Math.floor((wallH - 0.15) / quoinStep);
    const cornerSigns = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let r = 0; r < quoinRows; r++) {
      const qy = 0.20 + r * quoinStep;
      const even = r % 2 === 0;
      const sx = even ? 0.42 : 0.26;
      const sz = even ? 0.26 : 0.42;
      for (const [csx, csz] of cornerSigns) {
        const sc = jitterColor(stoneRgb, 0.055, rng);
        mb.addLocalBox(
          b.x, floorY, b.z, yaw,
          csx * (hx - sx * 0.5 + 0.045), qy, csz * (hz - sz * 0.5 + 0.045),
          sx, quoinStep * 0.86, sz, 0,
          sc[0], sc[1], sc[2], MAT.STONE, 0.75, 0.98, rng()
        );
      }
    }

    // --- D. TUDOR HALF-TIMBER BEAMS (if plaster/timber style) ---
    if (wallSt.hasTimber) {
      const beamT = 0.11;
      // Top eaves ring beam
      mb.addBox(b.x, floorY + wallH - 0.08, b.z, w + 0.10, 0.14, d + 0.10, yaw, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.72, 0.90, 0);
      if (wallH > 2.4) {
        // Mid-story belt beam
        mb.addBox(b.x, floorY + wallH * 0.52, b.z, w + 0.08, 0.11, d + 0.08, yaw, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.75, 0.94, 0);
      }
      // Vertical timber studs along front/back & sides
      const nStudX = Math.max(2, Math.round(w / 1.8));
      for (let i = 1; i < nStudX; i++) {
        const lx = -hx + (i / nStudX) * w;
        mb.addLocalBox(b.x, floorY, b.z, yaw, lx, wallH * 0.5, hz + 0.02, beamT, wallH, 0.06, 0, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.72, 0.94, 0);
        mb.addLocalBox(b.x, floorY, b.z, yaw, lx, wallH * 0.5, -hz - 0.02, beamT, wallH, 0.06, 0, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.72, 0.94, 0);
      }
    }

    // --- E. EMERGENT DOORS & AUTO COZY WINDOWS ---
    // Define the 4 walls: { sideYawOffset, halfNormalDist, wallSpan }
    const wallSides = [
      { yawOff: 0, dist: hz, span: w },
      { yawOff: Math.PI, dist: hz, span: w },
      { yawOff: M.HALF_PI, dist: hx, span: d },
      { yawOff: -M.HALF_PI, dist: hx, span: d }
    ];

    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const ws = wallSides[sIdx];
      const wYaw = yaw + ws.yawOff;
      const wCenter = toWorld(b.x, floorY, b.z, wYaw, 0, 0, ws.dist);

      // Probe for painted path in front of this wall!
      let doorPlaced = false;
      let doorLx = 0;
      if (baseLift < 0.95 && wallH >= 1.75 && ws.span >= 2.0) {
        const samples = Math.max(1, Math.floor(ws.span / 1.1));
        let bestPath = 0;
        for (let k = 0; k < samples; k++) {
          const testLx = samples === 1 ? 0 : (-ws.span * 0.32 + (k / (samples - 1)) * ws.span * 0.64);
          const probe = toWorld(wCenter[0], floorY, wCenter[2], wYaw, testLx, 0, 0.75);
          const pw = TERRAIN.getPath(probe[0], probe[2]);
          const probe2 = toWorld(wCenter[0], floorY, wCenter[2], wYaw, testLx, 0, 1.35);
          const pw2 = Math.max(pw, TERRAIN.getPath(probe2[0], probe2[2]));
          if (pw2 > bestPath) {
            bestPath = pw2;
            doorLx = testLx;
          }
        }
        if (bestPath > 0.28) {
          emitEmergentDoor(mb, wCenter[0], floorY, wCenter[2], wYaw, doorLx, floorY, timberRgb, stoneRgb, lightsOut, rng);
          const doorWp = toWorld(wCenter[0], floorY, wCenter[2], wYaw, doorLx, 1.35, 0.25);
          b._doors.push({ x: doorWp[0], y: doorWp[1], z: doorWp[2] });
          doorPlaced = true;
        }
      }

      // Cozy cottage windows along the wall (avoiding door area)
      if (wallH >= 1.5 && ws.span >= 2.1) {
        const winCount = Math.max(1, Math.min(3, Math.floor((ws.span - 0.8) / 2.1)));
        const winY = wallH > 3.2 ? wallH * 0.68 : wallH * 0.56;
        for (let wi = 0; wi < winCount; wi++) {
          const wlx = winCount === 1 ? 0 : (-ws.span * 0.28 + (wi / (winCount - 1)) * ws.span * 0.56);
          if (doorPlaced && Math.abs(wlx - doorLx) < 1.05 && winY < 2.2) continue;
          if (rng() < 0.78) {
            emitWallWindow(mb, wCenter[0], floorY, wCenter[2], wYaw, wlx, winY, 0.66, 0.84, timberRgb, stoneRgb, shutterRgb, lightsOut, rng);
          }
        }
      }
    }

    // --- F. ROOF: CASTLE BATTLEMENTS (low roofH) OR SWEEPING FAIRYTALE GABLE ROOF ---
    const eaveY = floorY + wallH;
    if (roofH <= 0.22) {
      // Paved castle terrace + 3D stone crenellations (merlons & crenels)!
      const deckCol = jitterColor(stoneRgb, 0.04, rng);
      mb.addBox(b.x, eaveY - 0.06, b.z, w + 0.26, 0.18, d + 0.26, yaw, deckCol[0], deckCol[1], deckCol[2], MAT.STONE, 0.80, 0.98, 0.4);

      const merlonH = 0.48;
      const merlonThick = 0.26;
      const placeParapet = (sideYaw, dist, span) => {
        const count = Math.max(2, Math.floor(span / 0.88));
        const step = span / count;
        const wc = toWorld(b.x, eaveY, b.z, yaw + sideYaw, 0, 0, dist);
        // Low continuous parapet base
        mb.addLocalBox(wc[0], eaveY, wc[2], yaw + sideYaw, 0, 0.14, 0, span + 0.24, 0.22, merlonThick, 0, deckCol[0], deckCol[1], deckCol[2], MAT.STONE, 0.78, 0.95, 0.2);
        for (let i = 0; i <= count; i++) {
          const lx = -span * 0.5 + i * step;
          const mc = jitterColor(stoneRgb, 0.05, rng);
          mb.addLocalBox(wc[0], eaveY, wc[2], yaw + sideYaw, lx, 0.22 + merlonH * 0.5, 0, Math.min(0.46, step * 0.56), merlonH, merlonThick + 0.03, 0, mc[0], mc[1], mc[2], MAT.STONE, 0.82, 1.0, rng());
        }
      };
      placeParapet(0, hz, w);
      placeParapet(Math.PI, hz, w);
      placeParapet(M.HALF_PI, hx, d);
      placeParapet(-M.HALF_PI, hx, d);
    } else {
      // Fairytale Gable Roof! Ridge runs along whichever axis is longer (X if w >= d, else Z)
      const ridgeAlongX = w >= d;
      const roofYaw = ridgeAlongX ? yaw : yaw + M.HALF_PI;
      const lenAlong = (ridgeAlongX ? w : d) * 0.5 + 0.42; // generous cozy eave overhang!
      const halfSpan = (ridgeAlongX ? d : w) * 0.5 + 0.38;

      const uSegs = Math.max(6, Math.round((lenAlong * 2) / 0.85));
      const vSegs = Math.max(5, Math.round(halfSpan / 0.36));

      // Fairytale ridge sag in center + upturned gable tips + gentle concave slope flare!
      const evalRoofPt = (uFrac, vFrac, sideSign) => {
        // uFrac in [0..1] along ridge (-lenAlong .. +lenAlong)
        // vFrac in [0..1] from ridge (0) down to eave (1)
        const uCentered = uFrac * 2 - 1; // -1 .. +1
        const sag = 1.0 - 0.075 * (1.0 - uCentered * uCentered); // cozy saddle dip!
        const peakY = eaveY + roofH * sag;

        // Concave fairytale slope curve: steeper near ridge, flares gently at eaves
        const dropCurve = Math.pow(vFrac, 0.84);
        const y = M.lerp(peakY, eaveY - 0.12, dropCurve);
        const lx = uCentered * lenAlong;
        const lz = sideSign * vFrac * halfSpan;
        return toWorld(b.x, 0, b.z, roofYaw, lx, y, lz);
      };

      // Gable end triangular infill walls (-lenAlong + overhang and +lenAlong - overhang)
      const gableHalfSpan = halfSpan - 0.34;
      const gableHalfLen = lenAlong - 0.38;
      for (const uEnd of [-1, 1]) {
        const gSlices = 6;
        for (let gs = 0; gs < gSlices; gs++) {
          const f0 = gs / gSlices;
          const f1 = (gs + 1) / gSlices;
          const z0 = -gableHalfSpan + f0 * gableHalfSpan * 2;
          const z1 = -gableHalfSpan + f1 * gableHalfSpan * 2;
          const v0 = Math.abs(z0) / halfSpan;
          const v1 = Math.abs(z1) / halfSpan;
          const h0 = M.lerp(roofH, 0, Math.pow(v0, 0.84));
          const h1 = M.lerp(roofH, 0, Math.pow(v1, 0.84));

          const pBL = toWorld(b.x, eaveY - 0.04, b.z, roofYaw, uEnd * gableHalfLen, 0, z0);
          const pBR = toWorld(b.x, eaveY - 0.04, b.z, roofYaw, uEnd * gableHalfLen, 0, z1);
          const pTR = toWorld(b.x, eaveY, b.z, roofYaw, uEnd * gableHalfLen, h1, z1);
          const pTL = toWorld(b.x, eaveY, b.z, roofYaw, uEnd * gableHalfLen, h0, z0);

          if (uEnd > 0) {
            mb.addQuad(pBR[0], pBR[1], pBR[2], pBL[0], pBL[1], pBL[2], pTL[0], pTL[1], pTL[2], pTR[0], pTR[1], pTR[2], wallRgb[0], wallRgb[1], wallRgb[2], wallMat, 0.78, 0.92, 0.2);
          } else {
            mb.addQuad(pBL[0], pBL[1], pBL[2], pBR[0], pBR[1], pBR[2], pTR[0], pTR[1], pTR[2], pTL[0], pTL[1], pTL[2], wallRgb[0], wallRgb[1], wallRgb[2], wallMat, 0.78, 0.92, 0.2);
          }
        }

        // Cute round/arched attic vent window on tall gables!
        if (roofH > 1.55 && gableHalfSpan > 1.3) {
          const gCenter = toWorld(b.x, eaveY, b.z, roofYaw, uEnd * (gableHalfLen + 0.02), 0, 0);
          const gYaw = roofYaw + (uEnd > 0 ? M.HALF_PI : -M.HALF_PI);
          emitWallWindow(mb, gCenter[0], eaveY, gCenter[2], gYaw, 0, roofH * 0.42, 0.50, 0.56, timberRgb, stoneRgb, shutterRgb, lightsOut, rng);
        }
      }

      // 3D Stepped Shingle Roof Courses on both slopes (+Z and -Z in roofYaw frame)
      const tileThickness = 0.055;
      for (const side of [-1, 1]) {
        for (let iv = 0; iv < vSegs; iv++) {
          const v0 = iv / vSegs;
          const v1 = (iv + 1) / vSegs;
          const ao0 = M.lerp(1.04, 0.80, v0);
          const ao1 = M.lerp(1.04, 0.76, v1);

          for (let iu = 0; iu < uSegs; iu++) {
            const u0 = iu / uSegs;
            const u1 = (iu + 1) / uSegs;

            const p00 = evalRoofPt(u0, v0, side);
            const p10 = evalRoofPt(u1, v0, side);
            const p11 = evalRoofPt(u1, v1, side);
            const p01 = evalRoofPt(u0, v1, side);

            // Slight shingle overlap lip at bottom of each course!
            p00[1] += tileThickness * 0.35;
            p10[1] += tileThickness * 0.35;
            p11[1] += tileThickness;
            p01[1] += tileThickness;

            const tc = M.mixColor(roofRgb, roofAltRgb, rng() * 0.75);
            const seedVal = rng();
            const u00 = evalRoofPt(u0, v0, side), u10 = evalRoofPt(u1, v0, side), u11 = evalRoofPt(u1, v1, side), u01 = evalRoofPt(u0, v1, side);
            if (side > 0) {
              mb.addQuad(p01[0], p01[1], p01[2], p11[0], p11[1], p11[2], p10[0], p10[1], p10[2], p00[0], p00[1], p00[2], tc[0], tc[1], tc[2], MAT.ROOF_TILE, ao1, ao0, seedVal);
              // Close front shingle lip riser so zero sky seams show between courses!
              mb.addQuad(u01[0], u01[1], u01[2], u11[0], u11[1], u11[2], p11[0], p11[1], p11[2], p01[0], p01[1], p01[2], tc[0] * 0.84, tc[1] * 0.84, tc[2] * 0.84, MAT.ROOF_TILE, ao1 * 0.85, ao1, seedVal);
              // Dark timber soffit underside for eave shadow!
              mb.addQuad(u00[0], u00[1] - 0.04, u00[2], u10[0], u10[1] - 0.04, u10[2], u11[0], u11[1] - 0.04, u11[2], u01[0], u01[1] - 0.04, u01[2], timberRgb[0] * 0.75, timberRgb[1] * 0.75, timberRgb[2] * 0.75, MAT.WOOD, 0.45, 0.55, 0);
            } else {
              mb.addQuad(p11[0], p11[1], p11[2], p01[0], p01[1], p01[2], p00[0], p00[1], p00[2], p10[0], p10[1], p10[2], tc[0], tc[1], tc[2], MAT.ROOF_TILE, ao1, ao0, seedVal);
              mb.addQuad(u11[0], u11[1], u11[2], u01[0], u01[1], u01[2], p01[0], p01[1], p01[2], p11[0], p11[1], p11[2], tc[0] * 0.84, tc[1] * 0.84, tc[2] * 0.84, MAT.ROOF_TILE, ao1 * 0.85, ao1, seedVal);
              mb.addQuad(u10[0], u10[1] - 0.04, u10[2], u00[0], u00[1] - 0.04, u00[2], u01[0], u01[1] - 0.04, u01[2], u11[0], u11[1] - 0.04, u11[2], timberRgb[0] * 0.75, timberRgb[1] * 0.75, timberRgb[2] * 0.75, MAT.WOOD, 0.45, 0.55, 0);
            }
          }
        }

        // Carved timber bargeboards along gable edges
        for (const uFrac of [0.01, 0.99]) {
          for (let iv = 0; iv < vSegs; iv++) {
            const pa = evalRoofPt(uFrac, iv / vSegs, side);
            const pb = evalRoofPt(uFrac, (iv + 1) / vSegs, side);
            mb.addTaperedTube(pa[0], pa[1] - 0.02, pa[2], 0.075, pb[0], pb[1] - 0.02, pb[2], 0.07, 4, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.78, 0.92, 0, false);
          }
        }
      }

      // 3D Ridge Cap Tiles along the curved spine!
      const ridgeCount = uSegs * 2;
      for (let i = 0; i < ridgeCount; i++) {
        const uMid = (i + 0.5) / ridgeCount;
        const rp = evalRoofPt(uMid, 0, 1);
        const rc = jitterColor(ridgeRgb, 0.04, rng);
        mb.addBox(rp[0], rp[1] + 0.055, rp[2], (lenAlong * 2 / ridgeCount) * 0.92, 0.12, 0.22, roofYaw, rc[0], rc[1], rc[2], MAT.ROOF_TILE, 0.92, 1.05, rng(), false);
      }

      // Scattered 3D individual raised accent shingles & cozy eave moss tufts!
      const shingleAccents = Math.min(28, Math.floor(lenAlong * halfSpan * 1.4));
      for (let k = 0; k < shingleAccents; k++) {
        const side = rng() < 0.5 ? -1 : 1;
        const uf = 0.08 + rng() * 0.84;
        const vf = 0.14 + rng() * 0.78;
        const pA = evalRoofPt(uf, vf, side);
        const pB = evalRoofPt(uf, Math.min(1, vf + 0.08), side);
        const tc = jitterColor(M.mixColor(roofRgb, roofAltRgb, rng()), 0.05, rng);
        mb.addTaperedTube(
          pA[0], pA[1] + 0.065, pA[2], 0.09,
          pB[0], pB[1] + 0.075, pB[2], 0.10,
          4, tc[0], tc[1], tc[2], MAT.ROOF_TILE, 0.88, 1.02, rng(), true
        );
      }
    }

    const out = mb.toFloat32Array();
    if (b._springScaleY && Math.abs(b._springScaleY - 1.0) > 0.002) {
      applySpringDeformRange(out, 0, out.length, b.x, floorY, b.z, b._springScaleY);
    }
    return out;
  }

  // ==========================================================================
  // 2. CYLINDRICAL KEEP / STORYBOOK SPIRE TOWER
  // ==========================================================================
  function buildTowerBuilding(b, lightsOut) {
    const mb = new GEO.MeshBuilder(8192);
    const rng = M.mulberry32(((b.id || 1) * 104729) | 0);
    const roofSw = PALETTES.getRoofSwatch(b.roofId);
    const wallSt = PALETTES.getWallStyle(b.wallId);

    const wallRgb = M.hexToRgb(wallSt.wallHex);
    const stoneRgb = M.hexToRgb(wallSt.stoneHex);
    const timberRgb = M.hexToRgb(wallSt.timberHex);
    const roofRgb = M.hexToRgb(roofSw.hex);
    const roofAltRgb = M.hexToRgb(roofSw.altHex);
    const shutterRgb = M.mixColor(roofRgb, timberRgb, 0.35);

    const r = Math.max(1.05, b.r || 1.85);
    const wallH = Math.max(1.2, b.wallH);
    const roofH = Math.max(0.0, b.roofH);
    const segs = 28;

    let minG = TERRAIN.getHeight(b.x, b.z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * M.TAU;
      const gh = TERRAIN.getHeight(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r);
      if (gh < minG) minG = gh;
    }
    const centerLandY = Math.max(TERRAIN.WATER_LEVEL + 0.12, TERRAIN.getHeight(b.x, b.z));
    const baseLift = Math.max(0, b.baseLift || 0);
    const floorY = centerLandY + baseLift;
    b._computedFloorY = floorY;
    b._computedTopY = floorY + wallH + roofH;
    b._doors = [];
    b._isBattlement = roofH <= 0.22;

    // Stone flared plinth foundation
    const skirtBottom = Math.min(minG - 0.5, floorY - 0.6);
    mb.addTaperedTube(b.x, skirtBottom, b.z, r + 0.24, b.x, floorY + 0.38, b.z, r + 0.08, segs, stoneRgb[0], stoneRgb[1], stoneRgb[2], MAT.STONE, 0.58, 0.90, 0.3, false);

    // Main cylindrical tower body
    const wallMat = wallSt.isStone ? MAT.STONE : MAT.PLASTER;
    mb.addTaperedTube(b.x, floorY + 0.32, b.z, r + 0.03, b.x, floorY + wallH, b.z, r, segs, wallRgb[0], wallRgb[1], wallRgb[2], wallMat, 0.68, 0.96, (b.id || 1) * 0.23, true);

    // Tangent-aligned 3D accent masonry stones hugging cylinder surface!
    const accentCount = Math.floor(wallH * r * 2.8);
    for (let i = 0; i < accentCount; i++) {
      const ang = rng() * M.TAU;
      const h = 0.45 + rng() * (wallH - 0.85);
      const radHere = M.lerp(r + 0.03, r, h / wallH);
      const sx = b.x + Math.cos(ang) * (radHere - 0.035);
      const sz = b.z + Math.sin(ang) * (radHere - 0.035);
      const sc = jitterColor(stoneRgb, 0.06, rng);
      mb.addBox(sx, floorY + h, sz, 0.34 + rng() * 0.14, 0.19 + rng() * 0.06, 0.13, ang - M.HALF_PI, sc[0], sc[1], sc[2], MAT.STONE, 0.78, 0.98, rng());
    }

    // Stone belt course & tangent-aligned timber eaves corbels
    const corbelCount = 18;
    const corbelY = floorY + wallH - 0.14;
    for (let i = 0; i < corbelCount; i++) {
      const ang = (i / corbelCount) * M.TAU;
      const cx = b.x + Math.cos(ang) * (r + 0.03);
      const cz = b.z + Math.sin(ang) * (r + 0.03);
      mb.addBox(cx, corbelY, cz, 0.13, 0.25, 0.18, ang - M.HALF_PI, timberRgb[0], timberRgb[1], timberRgb[2], MAT.WOOD, 0.68, 0.90, 0);
    }

    // Emergent arched door if path approaches base of tower!
    if (baseLift < 0.95 && wallH >= 2.0) {
      let bestAng = 0;
      let bestP = 0;
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * M.TAU;
        const px = b.x + Math.cos(ang) * (r + 0.95);
        const pz = b.z + Math.sin(ang) * (r + 0.95);
        const pw = TERRAIN.getPath(px, pz);
        if (pw > bestP) {
          bestP = pw;
          bestAng = ang;
        }
      }
      if (bestP > 0.28) {
        const wx = b.x + Math.cos(bestAng) * r;
        const wz = b.z + Math.sin(bestAng) * r;
        const wYaw = bestAng - M.HALF_PI;
        emitEmergentDoor(mb, wx, floorY, wz, wYaw, 0, floorY, timberRgb, stoneRgb, lightsOut, rng);
        b._doors.push({ x: wx, y: floorY + 1.35, z: wz });
      }
    }

    // Tower windows spiraling/tiered up the keep!
    const tiers = Math.max(1, Math.floor(wallH / 2.2));
    for (let t = 0; t < tiers; t++) {
      const wy = wallH * ((t + 0.58) / (tiers + 0.25));
      if (wy < 1.35) continue;
      const count = r > 1.7 ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const ang = (b.yaw || 0) + t * 1.05 + (k / count) * M.TAU;
        const wx = b.x + Math.cos(ang) * r;
        const wz = b.z + Math.sin(ang) * r;
        const wYaw = ang - M.HALF_PI;
        emitWallWindow(mb, wx, floorY, wz, wYaw, 0, wy, 0.52, 0.78, timberRgb, stoneRgb, shutterRgb, lightsOut, rng);
      }
    }

    // --- TOWER TOP: TURRET BATTLEMENTS OR WITCH-HAT CONICAL SPIRE ---
    const eaveY = floorY + wallH;
    if (roofH <= 0.22) {
      // Circular castle turret crenellations!
      const deckCol = jitterColor(stoneRgb, 0.04, rng);
      mb.addTaperedTube(b.x, eaveY - 0.14, b.z, r + 0.15, b.x, eaveY + 0.14, b.z, r + 0.17, segs, deckCol[0], deckCol[1], deckCol[2], MAT.STONE, 0.80, 0.98, 0.3, true);
      const merlons = Math.max(8, Math.round(r * 5.6));
      for (let i = 0; i < merlons; i++) {
        const ang = (i / merlons) * M.TAU;
        const mx = b.x + Math.cos(ang) * (r + 0.03);
        const mz = b.z + Math.sin(ang) * (r + 0.03);
        const mc = jitterColor(stoneRgb, 0.05, rng);
        mb.addBox(mx, eaveY + 0.35, mz, 0.40, 0.46, 0.25, ang - M.HALF_PI, mc[0], mc[1], mc[2], MAT.STONE, 0.84, 1.0, rng());
      }
    } else {
      // Fairytale Flared Conical Spire with layered shingle rings!
      const rings = Math.max(6, Math.round(roofH / 0.45));
      const baseConeR = r + 0.44;

      // Dark wood soffit disc under spire overhang
      mb.addTaperedTube(b.x, eaveY - 0.08, b.z, baseConeR * 0.96, b.x, eaveY + 0.02, b.z, r * 0.85, segs, timberRgb[0] * 0.72, timberRgb[1] * 0.72, timberRgb[2] * 0.72, MAT.WOOD, 0.48, 0.60, 0, false);

      for (let ir = 0; ir < rings; ir++) {
        const t0 = ir / rings; // 0 = base eave, 1 = tip
        const t1 = (ir + 1) / rings;
        // Concave flare curve: wider at bottom, slender needle spire at top!
        const rad0 = baseConeR * Math.pow(1 - t0, 1.18) + 0.04;
        const rad1 = baseConeR * Math.pow(1 - t1, 1.18);
        const y0 = eaveY - 0.08 + t0 * (roofH + 0.08);
        const y1 = eaveY - 0.08 + t1 * (roofH + 0.08);

        for (let is = 0; is < segs; is++) {
          const a0 = (is / segs) * M.TAU;
          const a1 = ((is + 1) / segs) * M.TAU;
          const p00 = [b.x + Math.cos(a0) * (rad0 + 0.025), y0, b.z + Math.sin(a0) * (rad0 + 0.025)];
          const p10 = [b.x + Math.cos(a1) * (rad0 + 0.025), y0, b.z + Math.sin(a1) * (rad0 + 0.025)];
          const p11 = [b.x + Math.cos(a1) * rad1, y1, b.z + Math.sin(a1) * rad1];
          const p01 = [b.x + Math.cos(a0) * rad1, y1, b.z + Math.sin(a0) * rad1];

          const tc = M.mixColor(roofRgb, roofAltRgb, rng() * 0.75);
          // Notice angle 0 -> +X, PI/2 -> +Z (CW from above), so outward CCW from outside is p10 -> p00 -> p01 -> p11!
          mb.addQuad(
            p10[0], p10[1], p10[2],
            p00[0], p00[1], p00[2],
            p01[0], p01[1], p01[2],
            p11[0], p11[1], p11[2],
            tc[0], tc[1], tc[2], MAT.ROOF_TILE,
            M.lerp(0.80, 1.05, t0), M.lerp(0.82, 1.06, t1), rng()
          );
        }
      }

      // Wrought-iron spire finial rod
      const tipY = eaveY + roofH;
      mb.addTaperedTube(b.x, tipY - 0.05, b.z, 0.055, b.x, tipY + 0.55, b.z, 0.015, 5, 0.24, 0.25, 0.28, MAT.STONE, 0.9, 1.0, 0, true);
      mb.addPuff(b.x, tipY + 0.22, b.z, 0.09, 0.09, 0.09, 4, 6, 0.82, 0.66, 0.30, MAT.WOOD, 1.0, 0, 0, 0);
    }

    const out = mb.toFloat32Array();
    if (b._springScaleY && Math.abs(b._springScaleY - 1.0) > 0.002) {
      applySpringDeformRange(out, 0, out.length, b.x, floorY, b.z, b._springScaleY);
    }
    return out;
  }

  // ==========================================================================
  // 3. CURVED STONE WALLS, WOODEN FENCES, EMERGENT ARCHWAYS & POND BRIDGES
  // ==========================================================================
  function buildWallsAndBridges(walls, metaOut = null) {
    const mb = new GEO.MeshBuilder(16384);

    // --- A. SPLINE STONE WALLS & WOODEN FENCES ---
    for (let wIdx = 0; wIdx < walls.length; wIdx++) {
      const wall = walls[wIdx];
      if (!wall.pts || wall.pts.length < 2) continue;

      const step = wall.kind === 'fence' ? 0.65 : 0.48;
      const samples = M.resampleSpline2D(wall.pts, step);
      wall.samples = samples;
      if (samples.length < 2) continue;

      const midS = samples[Math.floor(samples.length / 2)];
      const midGy = Math.max(TERRAIN.WATER_LEVEL, TERRAIN.getHeight(midS.x, midS.z));
      wall._midPoint = { x: midS.x, z: midS.z, gy: midGy };

      const wallStartFloat = mb.vertCount * GEO.STRIDE;
      const rng = M.mulberry32(((wall.id || (wIdx + 1)) * 31337) | 0);
      const baseHeight = M.clamp(wall.height || (wall.kind === 'fence' ? 0.95 : 1.45), 0.65, 3.8);

      // Detect path crossings -> mark spans for emergent stone archways / open gates!
      const isOpening = new Uint8Array(samples.length);
      for (let i = 1; i < samples.length - 1; i++) {
        if (TERRAIN.getPath(samples[i].x, samples[i].z) > 0.30) {
          isOpening[i] = 1;
        }
      }
      // Clean tiny 1-sample flickers and group contiguous spans
      const spans = [];
      let i = 0;
      while (i < samples.length - 1) {
        if (isOpening[i] || isOpening[i + 1]) {
          const start = Math.max(0, i - 1);
          while (i < samples.length - 1 && (isOpening[i] || isOpening[i + 1])) i++;
          const end = Math.min(samples.length - 1, i);
          if (samples[end].s - samples[start].s >= 0.75) {
            spans.push({ start, end, arch: true });
            continue;
          }
        }
        spans.push({ start: i, end: i + 1, arch: false });
        i++;
      }

      const stoneBase = [0.60, 0.57, 0.51];
      const mossTint = [0.42, 0.53, 0.34];
      const woodCol = [0.44, 0.31, 0.21];

      for (const sp of spans) {
        if (!sp.arch) {
          const a = samples[sp.start];
          const b = samples[sp.end];
          const mx = (a.x + b.x) * 0.5;
          const mz = (a.z + b.z) * 0.5;
          const segLen = M.dist2D(a.x, a.z, b.x, b.z);
          const segYaw = Math.atan2(b.z - a.z, b.x - a.x);
          const gy = Math.max(TERRAIN.WATER_LEVEL - 0.1, TERRAIN.getHeight(mx, mz));

          if (wall.kind === 'fence') {
            // Rustic wooden post + twin split rails
            const gyA = Math.max(TERRAIN.WATER_LEVEL - 0.1, TERRAIN.getHeight(a.x, a.z));
            mb.addTaperedTube(a.x, gyA - 0.15, a.z, 0.065, a.x, gyA + baseHeight, a.z, 0.055, 5, woodCol[0], woodCol[1], woodCol[2], MAT.WOOD, 0.68, 0.96, 0, true);
            if (sp.end === samples.length - 1) {
              const gyB = Math.max(TERRAIN.WATER_LEVEL - 0.1, TERRAIN.getHeight(b.x, b.z));
              mb.addTaperedTube(b.x, gyB - 0.15, b.z, 0.065, b.x, gyB + baseHeight, b.z, 0.055, 5, woodCol[0], woodCol[1], woodCol[2], MAT.WOOD, 0.68, 0.96, 0, true);
            }
            const gyB = Math.max(TERRAIN.WATER_LEVEL - 0.1, TERRAIN.getHeight(b.x, b.z));
            for (const rFrac of [0.38, 0.76]) {
              mb.addTaperedTube(
                a.x, gyA + baseHeight * rFrac, a.z, 0.04,
                b.x, gyB + baseHeight * rFrac, b.z, 0.04,
                4, woodCol[0] * 1.08, woodCol[1] * 1.06, woodCol[2] * 1.04, MAT.WOOD, 0.78, 0.95, 0, false
              );
            }
          } else {
            // Multi-course organic dry-stone wall segment + mossy capstone!
            const wallThick = baseHeight > 2.1 ? 0.56 : 0.44;
            const sc = jitterColor(stoneBase, 0.06, rng);
            mb.addBox(mx, gy + baseHeight * 0.46 - 0.12, mz, segLen + 0.12, baseHeight + 0.24, wallThick, segYaw, sc[0], sc[1], sc[2], MAT.STONE, 0.62, 0.94, rng());

            // Irregular protruding fieldstones on sides
            const courses = Math.max(2, Math.floor(baseHeight / 0.36));
            for (let c = 0; c < courses; c++) {
              const cy = gy + 0.16 + c * 0.35;
              const stCol = jitterColor(stoneBase, 0.075, rng);
              mb.addBox(
                mx + (rng() - 0.5) * 0.08, cy, mz + (rng() - 0.5) * 0.08,
                segLen * (0.75 + rng() * 0.3), 0.24, wallThick + 0.07,
                segYaw + (rng() - 0.5) * 0.08,
                stCol[0], stCol[1], stCol[2], MAT.STONE, 0.70, 0.96, rng()
              );
            }

            // Capstone (with moss on low garden walls, or battlements on tall castle walls!)
            const capCol = baseHeight < 1.85 ? M.mixColor(stoneBase, mossTint, 0.22 + rng() * 0.25) : jitterColor(stoneBase, 0.05, rng);
            mb.addBox(mx, gy + baseHeight + 0.05, mz, segLen + 0.16, 0.13, wallThick + 0.10, segYaw, capCol[0], capCol[1], capCol[2], MAT.STONE, 0.88, 1.02, rng());

            if (baseHeight > 2.15 && sp.start % 2 === 0) {
              mb.addBox(mx, gy + baseHeight + 0.30, mz, segLen * 0.72, 0.38, wallThick * 0.85, segYaw, sc[0], sc[1], sc[2], MAT.STONE, 0.88, 1.02, rng());
            }
          }
        } else {
          // --- EMERGENT 3D STONE ARCHWAY OR OPEN WOODEN GARDEN GATE!! ---
          const pA = samples[sp.start];
          const pB = samples[sp.end];
          const spanW = M.clamp(M.dist2D(pA.x, pA.z, pB.x, pB.z), 1.2, 4.6);
          const archYaw = Math.atan2(pB.z - pA.z, pB.x - pA.x);
          const gy = Math.max(TERRAIN.WATER_LEVEL, (TERRAIN.getHeight(pA.x, pA.z) + TERRAIN.getHeight(pB.x, pB.z)) * 0.5);

          if (wall.kind === 'fence') {
            // Two tall gateposts + charming open wooden gate wings!
            for (const ep of [pA, pB]) {
              mb.addBox(ep.x, gy + 0.62, ep.z, 0.18, 1.35, 0.18, archYaw, woodCol[0], woodCol[1], woodCol[2], MAT.WOOD, 0.68, 0.98, 0);
              mb.addPuff(ep.x, gy + 1.34, ep.z, 0.11, 0.10, 0.11, 4, 6, woodCol[0] * 1.15, woodCol[1] * 1.12, woodCol[2], MAT.WOOD, 0.95, 0, 0, 0);
            }
            // Swung-open gate leaves welcoming travelers
            const wingW = Math.min(0.85, spanW * 0.42);
            const openYawL = archYaw + 1.05;
            const openYawR = archYaw - 1.05;
            mb.addBox(pA.x + Math.cos(openYawL) * wingW * 0.5, gy + 0.48, pA.z + Math.sin(openYawL) * wingW * 0.5, wingW, 0.78, 0.06, openYawL, woodCol[0] * 1.1, woodCol[1] * 1.08, woodCol[2], MAT.WOOD, 0.75, 0.95, 0);
            mb.addBox(pB.x - Math.cos(openYawR) * wingW * 0.5, gy + 0.48, pB.z - Math.sin(openYawR) * wingW * 0.5, wingW, 0.78, 0.06, openYawR, woodCol[0] * 1.1, woodCol[1] * 1.08, woodCol[2], MAT.WOOD, 0.75, 0.95, 0);
            if (metaOut && metaOut.arches) {
              metaOut.arches.push({ x: (pA.x + pB.x) * 0.5, y: gy + 1.55, z: (pA.z + pB.z) * 0.5, kind: 'gate' });
            }
          } else {
            // Iconic Tiny Glade 3D Stone Keystone Archway spanning the road!
            const mx = (pA.x + pB.x) * 0.5;
            const mz = (pA.z + pB.z) * 0.5;
            const archClearH = Math.max(baseHeight + 0.55, 2.05);
            const pierH = archClearH * 0.62;
            const archR = spanW * 0.5;
            const thick = 0.58;

            // Sturdy stone gate piers on left & right
            for (const ep of [pA, pB]) {
              const pc = jitterColor(stoneBase, 0.05, rng);
              mb.addBox(ep.x, gy + pierH * 0.5 - 0.1, ep.z, 0.56, pierH + 0.25, thick + 0.10, archYaw, pc[0], pc[1], pc[2], MAT.STONE, 0.65, 0.95, rng());
              mb.addBox(ep.x, gy + pierH + 0.08, ep.z, 0.64, 0.14, thick + 0.16, archYaw, pc[0] * 1.05, pc[1] * 1.05, pc[2] * 1.05, MAT.STONE, 0.85, 1.0, rng());
            }

            // Radial stone voussoir blocks + prominent central keystone + mossy top bridge crest!
            const voussoirs = 11;
            const ux = (pB.x - pA.x) / (spanW || 1);
            const uz = (pB.z - pA.z) / (spanW || 1);
            const crestH = pierH + Math.min(1.25, archR * 0.78) + 0.26;

            for (let v = 0; v < voussoirs; v++) {
              const frac = (v + 0.5) / voussoirs;
              const ang = Math.PI * (1.0 - frac); // PI .. 0
              const along = -Math.cos(ang) * archR;
              const rise = Math.sin(ang) * Math.min(1.18, archR * 0.76);
              const vx = mx + ux * along;
              const vz = mz + uz * along;
              const vy = gy + pierH + rise;
              const isKey = v === ((voussoirs / 2) | 0);
              const vc = jitterColor(stoneBase, 0.065, rng);

              // Voussoir wedge block
              mb.addBox(
                vx, vy, vz,
                (spanW / voussoirs) * (isKey ? 1.35 : 1.15),
                isKey ? 0.36 : 0.27,
                isKey ? thick + 0.14 : thick + 0.04,
                archYaw,
                vc[0], vc[1], vc[2], MAT.STONE, 0.78, 1.0, rng(), false
              );

              // Spandrel infill masonry up to arch top coping
              const spandrelH = crestH - (vy + 0.12);
              if (spandrelH > 0.06) {
                mb.addBox(vx, vy + 0.12 + spandrelH * 0.5, vz, (spanW / voussoirs) * 1.18, spandrelH, thick * 0.92, archYaw, vc[0] * 0.96, vc[1] * 0.96, vc[2] * 0.96, MAT.STONE, 0.82, 0.98, rng());
              }
            }

            // Mossy stone coping arch cap across top
            const capCol = M.mixColor(stoneBase, mossTint, 0.25);
            mb.addBox(mx, gy + crestH + 0.06, mz, spanW + 0.75, 0.14, thick + 0.16, archYaw, capCol[0], capCol[1], capCol[2], MAT.STONE, 0.92, 1.04, 0.4);
            if (metaOut && metaOut.arches) {
              metaOut.arches.push({ x: mx, y: gy + crestH + 0.45, z: mz, kind: 'arch' });
            }
          }
        }
      }

      if (wall._springScaleY && Math.abs(wall._springScaleY - 1.0) > 0.002) {
        applySpringDeformRange(mb.data, wallStartFloat, mb.vertCount * GEO.STRIDE, midS.x, midGy, midS.z, wall._springScaleY);
      }
    }

    // --- B. EMERGENT WOODEN FOOTBRIDGES & MOSSY STEPPING STONES WHERE PATH CROSSES WATER ---
    const stepScan = 0.82;
    const bridgeWood = [0.48, 0.35, 0.23];
    const postWood = [0.38, 0.27, 0.18];
    const half = TERRAIN.HALF_SIZE - 2;
    let bridgeId = 1;

    for (let z = -half; z <= half; z += stepScan) {
      for (let x = -half; x <= half; x += stepScan) {
        const pw = TERRAIN.getPath(x, z);
        if (pw < 0.38) continue;
        const wd = TERRAIN.getWaterDepth(x, z);
        if (wd < 0.04) continue;

        // Estimate path tangent direction from nearby path gradient / ridge
        let bestAng = 0;
        let bestScore = -1e9;
        for (let a = 0; a < 6; a++) {
          const ang = (a / 6) * Math.PI;
          const dx = Math.cos(ang) * 0.95;
          const dz = Math.sin(ang) * 0.95;
          const s = TERRAIN.getPath(x + dx, z + dz) + TERRAIN.getPath(x - dx, z - dz);
          if (s > bestScore) { bestScore = s; bestAng = ang; }
        }
        const plankYaw = bestAng;
        const wy = TERRAIN.WATER_LEVEL + 0.08 + Math.min(0.14, wd * 0.09);

        if (pw > 0.58) {
          if (metaOut && metaOut.bridges && wd > 0.08) {
            let nearExisting = false;
            for (let bi = 0; bi < metaOut.bridges.length; bi++) {
              if (M.distSq2D(x, z, metaOut.bridges[bi].x, metaOut.bridges[bi].z) < 20.25) {
                nearExisting = true;
                break;
              }
            }
            if (!nearExisting) {
              metaOut.bridges.push({ x, y: wy + 0.95, z });
            }
          }
          // Rustic arched wooden plank footbridge section + posts!
          const rng = M.mulberry32((bridgeId++ * 4999) | 0);
          for (let p = -1; p <= 1; p++) {
            const px = x + Math.cos(bestAng) * (p * 0.27);
            const pz = z + Math.sin(bestAng) * (p * 0.27);
            const wc = jitterColor(bridgeWood, 0.05, rng);
            mb.addBox(px, wy, pz, 0.23, 0.07, 1.48, plankYaw, wc[0], wc[1], wc[2], MAT.WOOD, 0.78, 0.98, rng(), false);
          }
          // Side posts & low handrail every ~2nd cell
          if (((Math.round(x / stepScan) + Math.round(z / stepScan)) & 1) === 0) {
            const nx = -Math.sin(bestAng) * 0.68;
            const nz = Math.cos(bestAng) * 0.68;
            const bedY = TERRAIN.getHeight(x, z) - 0.15;
            for (const sgn of [-1, 1]) {
              const rx = x + nx * sgn;
              const rz = z + nz * sgn;
              mb.addTaperedTube(rx, bedY, rz, 0.055, rx, wy + 0.58, rz, 0.048, 5, postWood[0], postWood[1], postWood[2], MAT.WOOD, 0.62, 0.96, 0, true);
              mb.addBox(rx, wy + 0.52, rz, 0.88, 0.055, 0.06, plankYaw, bridgeWood[0], bridgeWood[1], bridgeWood[2], MAT.WOOD, 0.85, 0.98, 0);
            }
          }
        } else {
          // Charming mossy stepping stones!
          const rng = M.mulberry32((bridgeId++ * 8191) | 0);
          mb.addPuff(
            x + (rng() - 0.5) * 0.18,
            TERRAIN.WATER_LEVEL + 0.03,
            z + (rng() - 0.5) * 0.18,
            0.30 + rng() * 0.08, 0.11, 0.26 + rng() * 0.08,
            4, 7, 0.52, 0.55, 0.48, MAT.STONE, 0.88, 0.3, bridgeId, 0.12
          );
        }
      }
    }

    return mb.toFloat32Array();
  }

  // ==========================================================================
  // 4. SURFACE STAMPS & COZY VILLAGE CLUTTER
  // ==========================================================================
  function buildStamps(stamps, lightsOut, smokeSourcesOut) {
    const mb = new GEO.MeshBuilder(8192);

    for (let i = 0; i < stamps.length; i++) {
      const st = stamps[i];
      const stStartFloat = mb.vertCount * GEO.STRIDE;
      const rng = M.mulberry32(((st.id || (i + 1)) * 65537) | 0);
      const yaw = st.yaw || 0;
      const gy = st.onStructure ? st.y : Math.max(TERRAIN.WATER_LEVEL, TERRAIN.getHeight(st.x, st.z));
      st._computedY = gy;

      if (st.kind === 'chimney') {
        const y = st.y || (gy + 2.5);
        const stoneCol = [0.64, 0.56, 0.49];
        mb.addBox(st.x, y - 0.25, st.z, 0.58, 1.35, 0.58, yaw, stoneCol[0], stoneCol[1], stoneCol[2], MAT.STONE, 0.72, 0.96, rng());
        mb.addBox(st.x, y + 0.44, st.z, 0.68, 0.12, 0.68, yaw, stoneCol[0] * 0.92, stoneCol[1] * 0.92, stoneCol[2] * 0.92, MAT.STONE, 0.88, 1.0, rng());
        // Terracotta chimney pot
        mb.addTaperedTube(st.x, y + 0.48, st.z, 0.16, st.x, y + 0.84, st.z, 0.13, 8, 0.76, 0.38, 0.27, MAT.ROOF_TILE, 0.82, 1.0, 0, false);
        if (smokeSourcesOut) {
          smokeSourcesOut.push({ x: st.x, y: y + 0.88, z: st.z });
        }
      } else if (st.kind === 'flag') {
        const y = st.y || (gy + 3.0);
        const flagRgb = M.hexToRgb(st.color || '#c85d44');
        // Mast pole
        mb.addTaperedTube(st.x, y - 0.25, st.z, 0.045, st.x, y + 1.45, st.z, 0.025, 6, 0.42, 0.30, 0.20, MAT.WOOD, 0.8, 1.0, 0, true);
        mb.addPuff(st.x, y + 1.48, st.z, 0.07, 0.07, 0.07, 4, 6, 0.86, 0.70, 0.32, MAT.WOOD, 1.0, 0, 0, 0);
        // Swallowtail banner strips with increasing wind flutter weight in aParam.z!
        const segs = 6;
        const len = 1.25;
        for (let s = 0; s < segs; s++) {
          const f0 = s / segs, f1 = (s + 1) / segs;
          const x0 = st.x + f0 * len;
          const x1 = st.x + f1 * len;
          const h0 = M.lerp(0.24, 0.06, f0);
          const h1 = M.lerp(0.24, 0.03, f1);
          const yc = y + 1.22 - f0 * 0.05;
          // Double-sided banner triangles so visible from all camera angles!
          mb.ensure(12);
          mb.pushVert(x0, yc - h0, st.z, 0, 0, 1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 0.95, f0);
          mb.pushVert(x1, yc - h1, st.z, 0, 0, 1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 0.98, f1);
          mb.pushVert(x1, yc + h1, st.z, 0, 0, 1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 1.0, f1);
          mb.pushVert(x0, yc - h0, st.z, 0, 0, 1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 0.95, f0);
          mb.pushVert(x1, yc + h1, st.z, 0, 0, 1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 1.0, f1);
          mb.pushVert(x0, yc + h0, st.z, 0, 0, 1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 0.98, f0);

          mb.pushVert(x0, yc - h0, st.z, 0, 0, -1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 0.95, f0);
          mb.pushVert(x1, yc + h1, st.z, 0, 0, -1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 1.0, f1);
          mb.pushVert(x1, yc - h1, st.z, 0, 0, -1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 0.98, f1);
          mb.pushVert(x0, yc - h0, st.z, 0, 0, -1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 0.95, f0);
          mb.pushVert(x0, yc + h0, st.z, 0, 0, -1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 0.98, f0);
          mb.pushVert(x1, yc + h1, st.z, 0, 0, -1, flagRgb[0], flagRgb[1], flagRgb[2], MAT.FABRIC, 1.0, f1);
        }
      } else if (st.kind === 'window') {
        const y = st.y || (gy + 1.5);
        // Check if another stamped window is close -> widen into double mullion window!
        let width = 0.72;
        for (let j = 0; j < stamps.length; j++) {
          if (i !== j && stamps[j].kind === 'window') {
            const d = Math.hypot(stamps[j].x - st.x, (stamps[j].y || 0) - y, stamps[j].z - st.z);
            if (d < 0.95) { width = 1.18; break; }
          }
        }
        emitWallWindow(mb, st.x, 0, st.z, yaw, 0, y, width, 0.92, [0.42, 0.29, 0.20], [0.64, 0.59, 0.52], [0.36, 0.48, 0.56], lightsOut, rng);
      } else if (st.kind === 'dormer') {
        const y = st.y || (gy + 2.8);
        const roofSw = PALETTES.getRoofSwatch(st.roofId || 'terracotta');
        const rRgb = M.hexToRgb(roofSw.hex);
        mb.addLocalBox(st.x, y, st.z, yaw, 0, 0, -0.25, 0.96, 0.92, 1.05, 0, 0.90, 0.85, 0.76, MAT.PLASTER, 0.75, 0.95, 0);
        // Mini pitched roof on dormer
        mb.addLocalBox(st.x, y, st.z, yaw, -0.28, 0.56, -0.22, 0.68, 0.08, 1.22, 0, rRgb[0], rRgb[1], rRgb[2], MAT.ROOF_TILE, 0.85, 1.0, 0.2, false);
        mb.addLocalBox(st.x, y, st.z, yaw, 0.28, 0.56, -0.22, 0.68, 0.08, 1.22, 0, rRgb[0], rRgb[1], rRgb[2], MAT.ROOF_TILE, 0.85, 1.0, 0.4, false);
        mb.addLocalBox(st.x, y, st.z, yaw, 0, 0.66, -0.22, 0.36, 0.14, 1.24, 0, rRgb[0] * 0.9, rRgb[1] * 0.9, rRgb[2] * 0.9, MAT.ROOF_TILE, 0.92, 1.02, 0.5, false);
        emitWallWindow(mb, st.x, 0, st.z, yaw, 0, y + 0.05, 0.56, 0.62, [0.42, 0.29, 0.20], [0.64, 0.59, 0.52], rRgb, lightsOut, rng);
      } else if (st.kind === 'lantern_post') {
        const y = st.onStructure ? st.y : gy;
        const postH = st.onStructure ? 0.45 : 2.15;
        if (!st.onStructure) {
          mb.addTaperedTube(st.x, y - 0.1, st.z, 0.08, st.x, y + postH, st.z, 0.045, 6, 0.28, 0.24, 0.22, MAT.WOOD, 0.65, 0.95, 0, true);
          mb.addTaperedTube(st.x, y + postH - 0.05, st.z, 0.04, st.x + 0.36, y + postH + 0.10, st.z, 0.03, 5, 0.22, 0.22, 0.25, MAT.STONE, 0.85, 0.95, 0, true);
        }
        const lx = st.onStructure ? st.x : st.x + 0.35;
        const ly = st.onStructure ? y : y + postH - 0.12;
        mb.addBox(lx, ly + 0.12, st.z, 0.22, 0.07, 0.22, 0, 0.22, 0.22, 0.25, MAT.STONE, 0.85, 0.98, 0, false);
        mb.addBox(lx, ly, st.z, 0.15, 0.20, 0.15, 0, 1.0, 0.78, 0.36, MAT.LANTERN_GLOW, 1.0, 1.0, 0.95, false);
        if (lightsOut) {
          lightsOut.push({ x: lx, y: ly, z: st.z, r: 1.0, g: 0.72, b: 0.32, radius: 7.8, kind: 'lantern' });
        }
      } else if (st.kind === 'ivy') {
        const baseY = st.y || (gy + 0.9);
        for (let k = 0; k < 11; k++) {
          const ox = (rng() - 0.5) * 1.1;
          const oy = (rng() - 0.35) * 1.45;
          const oz = (rng() - 0.5) * 0.45;
          const wp = toWorld(st.x, baseY, st.z, yaw, ox, oy, 0.08 + Math.abs(oz) * 0.3);
          const gc = [0.24 + rng() * 0.12, 0.48 + rng() * 0.16, 0.20 + rng() * 0.08];
          mb.addPuff(wp[0], wp[1], wp[2], 0.22 + rng() * 0.1, 0.20 + rng() * 0.1, 0.14, 4, 6, gc[0], gc[1], gc[2], MAT.FOLIAGE, 0.88, 0.22, k, 0.18);
          if (k % 3 === 0) {
            mb.addPuff(wp[0], wp[1] + 0.05, wp[2] + 0.05, 0.06, 0.06, 0.06, 3, 5, 0.96, 0.76, 0.82, MAT.FOLIAGE, 1.0, 0.25, k, 0);
          }
        }
      } else if (st.kind === 'well') {
        // Cozy stone wishing well with shingle roof!
        mb.addTaperedTube(st.x, gy - 0.15, st.z, 0.68, st.x, gy + 0.72, st.z, 0.65, 12, 0.58, 0.56, 0.52, MAT.STONE, 0.62, 0.95, 0.3, false);
        mb.addTaperedTube(st.x, gy + 0.68, st.z, 0.72, st.x, gy + 0.78, st.z, 0.72, 12, 0.64, 0.61, 0.56, MAT.STONE, 0.85, 1.0, 0.4, true);
        // Dark water inside well
        mb.addTaperedTube(st.x, gy + 0.55, st.z, 0.50, st.x, gy + 0.79, st.z, 0.50, 10, 0.12, 0.32, 0.38, MAT.STONE, 0.45, 0.55, 0, true);
        // Two wooden support posts + mini gable roof
        for (const sgn of [-1, 1]) {
          const wp = toWorld(st.x, gy, st.z, yaw, sgn * 0.56, 0, 0);
          mb.addTaperedTube(wp[0], gy + 0.70, wp[2], 0.06, wp[0], gy + 1.78, wp[2], 0.055, 5, 0.42, 0.29, 0.19, MAT.WOOD, 0.75, 0.95, 0, true);
        }
        mb.addLocalBox(st.x, gy, st.z, yaw, 0, 1.38, 0, 1.08, 0.06, 0.06, 0, 0.38, 0.27, 0.18, MAT.WOOD, 0.8, 0.95, 0, false);
        mb.addLocalBox(st.x, gy, st.z, yaw, 0, 1.92, -0.28, 1.45, 0.08, 0.78, 0, 0.76, 0.37, 0.28, MAT.ROOF_TILE, 0.85, 1.02, 0.3, false);
        mb.addLocalBox(st.x, gy, st.z, yaw, 0, 1.92, 0.28, 1.45, 0.08, 0.78, 0, 0.76, 0.37, 0.28, MAT.ROOF_TILE, 0.85, 1.02, 0.6, false);
        mb.addLocalBox(st.x, gy, st.z, yaw, 0, 2.04, 0, 1.48, 0.12, 0.26, 0, 0.65, 0.31, 0.23, MAT.ROOF_TILE, 0.92, 1.04, 0.5, false);
      } else if (st.kind === 'bench') {
        const wc = [0.46, 0.33, 0.21];
        mb.addLocalBox(st.x, gy, st.z, yaw, 0, 0.40, 0, 1.28, 0.07, 0.44, 0, wc[0], wc[1], wc[2], MAT.WOOD, 0.75, 0.96, 0, false);
        mb.addLocalBox(st.x, gy, st.z, yaw, 0, 0.68, -0.19, 1.28, 0.34, 0.06, 0, wc[0], wc[1], wc[2], MAT.WOOD, 0.80, 0.98, 0, false);
        mb.addLocalBox(st.x, gy, st.z, yaw, -0.50, 0.20, 0, 0.10, 0.42, 0.40, 0, 0.34, 0.25, 0.17, MAT.WOOD, 0.62, 0.88, 0, false);
        mb.addLocalBox(st.x, gy, st.z, yaw, 0.50, 0.20, 0, 0.10, 0.42, 0.40, 0, 0.34, 0.25, 0.17, MAT.WOOD, 0.62, 0.88, 0, false);
      } else if (st.kind === 'cart') {
        const wc = [0.48, 0.34, 0.22];
        mb.addLocalBox(st.x, gy, st.z, yaw, 0, 0.54, 0, 1.15, 0.42, 0.82, 0, wc[0], wc[1], wc[2], MAT.WOOD, 0.72, 0.96, 0, false);
        // Handles
        mb.addLocalBox(st.x, gy, st.z, yaw, 0.82, 0.46, -0.28, 0.68, 0.06, 0.06, 0, wc[0], wc[1], wc[2], MAT.WOOD, 0.8, 0.95, 0, false);
        mb.addLocalBox(st.x, gy, st.z, yaw, 0.82, 0.46, 0.28, 0.68, 0.06, 0.06, 0, wc[0], wc[1], wc[2], MAT.WOOD, 0.8, 0.95, 0, false);
        // Wheels
        for (const sgn of [-1, 1]) {
          const wp = toWorld(st.x, gy, st.z, yaw, -0.05, 0.36, sgn * 0.47);
          mb.addBox(wp[0], wp[1], wp[2], 0.68, 0.68, 0.08, yaw, 0.35, 0.25, 0.17, MAT.WOOD, 0.65, 0.95, 0, false);
        }
        // Pumpkins / cargo inside cart!
        const p1 = toWorld(st.x, gy, st.z, yaw, -0.18, 0.82, -0.12);
        const p2 = toWorld(st.x, gy, st.z, yaw, 0.22, 0.80, 0.14);
        mb.addPuff(p1[0], p1[1], p1[2], 0.22, 0.17, 0.22, 5, 7, 0.88, 0.46, 0.16, MAT.ROOF_TILE, 0.92, 0, 1, 0.08);
        mb.addPuff(p2[0], p2[1], p2[2], 0.18, 0.15, 0.18, 5, 7, 0.84, 0.58, 0.20, MAT.ROOF_TILE, 0.92, 0, 2, 0.08);
      }

      if (st._springScaleY && Math.abs(st._springScaleY - 1.0) > 0.002) {
        applySpringDeformRange(mb.data, stStartFloat, mb.vertCount * GEO.STRIDE, st.x, gy, st.z, st._springScaleY);
      }
    }

    return mb.toFloat32Array();
  }

  return {
    buildRectBuilding,
    buildTowerBuilding,
    buildWallsAndBridges,
    buildStamps
  };
})();
