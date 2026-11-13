// ============================================================================
// terrain.js — Dynamic Multi-Scale Heightfield, Seamless Map Expansion,
//              6 Landform Archetypes, Outer Horizon Vista & GPU Terrain Map
// ============================================================================

const TERRAIN = (() => {
  const WATER_LEVEL = -0.18;
  const HEIGHT_MIN = -4.0;
  const HEIGHT_SPAN = 18.0; // -4.0 .. +14.0m

  let gridN = 193;
  let worldSize = 96.0;
  let halfSize = worldSize * 0.5;
  let cellSize = worldSize / (gridN - 1);
  let totalVerts = gridN * gridN;

  let baseH = new Float32Array(totalVerts);
  let waterCarve = new Float32Array(totalVerts);
  let pathMask = new Float32Array(totalVerts);
  let flowerMask = new Float32Array(totalVerts);
  let buildingMask = new Float32Array(totalVerts);
  let effectiveH = new Float32Array(totalVerts);
  let rawEffectiveH = new Float32Array(totalVerts);
  let gpuMapData = new Uint8Array(totalVerts * 4);

  const terrainBuilder = new GEO.MeshBuilder(193 * 193 * 6);
  const waterBuilder = new GEO.MeshBuilder(24576);
  const vistaBuilder = new GEO.MeshBuilder(8192);

  let currentSeed = 101;
  let dirtyMesh = true;
  let dirtyGpuMap = true;
  let dirtyGpuTexResize = true;

  function idx(ix, iz) {
    return iz * gridN + ix;
  }

  function gridToWorldX(ix) {
    return -halfSize + ix * cellSize;
  }

  function gridToWorldZ(iz) {
    return -halfSize + iz * cellSize;
  }

  function setDomain(newWorldSize, newGridN) {
    const cfg = PALETTES.getMapSizeConfig(newWorldSize);
    const targetSize = typeof newWorldSize === 'number' ? newWorldSize : cfg.worldSize;
    const targetGrid = newGridN || cfg.gridN;

    const gridChanged = targetGrid !== gridN;
    const sizeChanged = Math.abs(targetSize - worldSize) > 0.01;

    worldSize = targetSize;
    halfSize = worldSize * 0.5;
    gridN = targetGrid;
    cellSize = worldSize / (gridN - 1);
    totalVerts = gridN * gridN;

    if (gridChanged || baseH.length !== totalVerts) {
      baseH = new Float32Array(totalVerts);
      waterCarve = new Float32Array(totalVerts);
      pathMask = new Float32Array(totalVerts);
      flowerMask = new Float32Array(totalVerts);
      buildingMask = new Float32Array(totalVerts);
      effectiveH = new Float32Array(totalVerts);
      rawEffectiveH = new Float32Array(totalVerts);
      gpuMapData = new Uint8Array(totalVerts * 4);
      dirtyGpuTexResize = true;
    } else if (sizeChanged) {
      dirtyGpuTexResize = true;
    }
    dirtyMesh = true;
    dirtyGpuMap = true;
  }

  // Evaluate natural meadow + rim height at arbitrary (x, z) for a given half-size & seed
  function evalNaturalMeadow(x, z, domainHalf, seed) {
    const r = Math.hypot(x, z);
    const edgeCheb = Math.max(Math.abs(x), Math.abs(z));
    const n1 = M.fbm2D(x * 0.045 + seed * 0.13, z * 0.045 - seed * 0.09, 4);
    const n2 = M.fbm2D(x * 0.13 - 11.3 + seed * 0.03, z * 0.13 + 7.9, 3);
    const rimStart = domainHalf * 0.66;
    const rim = M.smoothstep(rimStart, domainHalf, Math.max(r * 0.88, edgeCheb)) * (2.4 + n1 * 2.4);
    return 0.16 + (n1 - 0.45) * 0.72 + (n2 - 0.5) * 0.18 + rim;
  }

  function resetToNaturalClearing(seed = 101, targetWorldSize = null) {
    if (targetWorldSize !== null) {
      const cfg = PALETTES.getMapSizeConfig(targetWorldSize);
      setDomain(cfg.worldSize, cfg.gridN);
    }
    currentSeed = seed | 0;
    for (let iz = 0; iz < gridN; iz++) {
      const z = gridToWorldZ(iz);
      for (let ix = 0; ix < gridN; ix++) {
        const x = gridToWorldX(ix);
        const i = idx(ix, iz);
        baseH[i] = evalNaturalMeadow(x, z, halfSize, currentSeed);
        waterCarve[i] = 0;
        pathMask[i] = 0;
        flowerMask[i] = M.saturate((M.fbm2D(x * 0.17 + 31 + currentSeed * 0.05, z * 0.17 - 19, 3) - 0.48) * 2.2);
        buildingMask[i] = 0;
      }
    }
    recomputeEffectiveHeight();
  }

  // Procedural Landform Generator for Custom New Map Workshop!
  function generateArchetypeTerrain(options = {}) {
    const {
      worldSize: reqSize = 96,
      archetype = 'clearing',
      seed = 2026,
      waterLevelMul = 1.0 // 0.3 (dry) .. 1.0 (balanced) .. 1.55 (lush water)
    } = options;

    const cfg = PALETTES.getMapSizeConfig(reqSize);
    setDomain(cfg.worldSize, cfg.gridN);
    currentSeed = seed | 0;
    const rng = M.mulberry32(currentSeed);
    const sOffX = (rng() - 0.5) * 200;
    const sOffZ = (rng() - 0.5) * 200;

    // 1. Base meadow undulation
    for (let iz = 0; iz < gridN; iz++) {
      const z = gridToWorldZ(iz);
      for (let ix = 0; ix < gridN; ix++) {
        const x = gridToWorldX(ix);
        const i = idx(ix, iz);
        const n1 = M.fbm2D((x + sOffX) * 0.042, (z + sOffZ) * 0.042, 4);
        const n2 = M.fbm2D((x - sOffZ) * 0.12, (z + sOffX) * 0.12, 3);
        const edgeD = Math.max(Math.abs(x), Math.abs(z));
        const rim = M.smoothstep(halfSize * 0.68, halfSize, edgeD) * (2.3 + n1 * 2.6);

        let h = 0.22 + (n1 - 0.46) * 0.85 + (n2 - 0.5) * 0.20 + rim;
        let wc = 0;

        if (archetype === 'river_valley') {
          // Sinuous S-curve river valley with gentle sloping banks
          const normX = x / halfSize;
          const riverCenterZ = Math.sin(normX * 2.35 + rng() * 0.4) * (halfSize * 0.26)
            + (M.fbm2D(x * 0.05 + sOffX, 13.7, 3) - 0.5) * (halfSize * 0.16);
          const distRiver = Math.abs(z - riverCenterZ);
          const riverWidth = (3.4 + M.noise2D(x * 0.09 + sOffZ, z * 0.09) * 1.8) * (0.75 + waterLevelMul * 0.38);
          const valleyDip = M.smootherstep(riverWidth * 4.2, riverWidth * 0.8, distRiver);
          h = M.lerp(h + 0.85, 0.12, valleyDip);
          if (distRiver < riverWidth) {
            const w = M.smootherstep(riverWidth, riverWidth * 0.2, distRiver);
            wc = w * (1.15 + 0.35 * waterLevelMul);
          }
        } else if (archetype === 'lake_islands') {
          // Central mirror lake with raised islands!
          const lakeR = halfSize * (0.42 + 0.10 * waterLevelMul);
          const warp = (M.fbm2D((x + sOffX) * 0.07, (z + sOffZ) * 0.07, 3) - 0.5) * (halfSize * 0.18);
          const dCenter = Math.hypot(x * 0.95, z * 1.05) + warp;
          if (dCenter < lakeR) {
            const w = M.smootherstep(lakeR, lakeR * 0.45, dCenter);
            wc = w * 1.55;
            h = Math.min(h, 0.18);
          }
          // Sculpt 1 grand central island + 2 charming satellite islets
          const isl1 = Math.hypot(x - 1.5, z + 1.0);
          const isl1R = halfSize * 0.19;
          if (isl1 < isl1R) {
            const iw = M.smootherstep(isl1R, isl1R * 0.28, isl1);
            wc *= (1 - iw);
            h = M.lerp(h, 1.85 + n2 * 0.7, iw);
          }
          const isl2 = Math.hypot(x + halfSize * 0.22, z - halfSize * 0.15);
          const isl2R = halfSize * 0.11;
          if (isl2 < isl2R) {
            const iw = M.smootherstep(isl2R, isl2R * 0.25, isl2);
            wc *= (1 - iw);
            h = M.lerp(h, 1.15 + n2 * 0.4, iw);
          }
        } else if (archetype === 'highland_terraces') {
          // Tiered limestone highland plateaus overlooking a crystal mountain tarn!
          const ridgeField = M.fbm2D((x + sOffX) * 0.036, (z + sOffZ) * 0.036, 4) * 1.15
            + M.clamp((-z * 0.55 - x * 0.35) / halfSize, -0.4, 0.85) * 0.85;
          const rawMount = Math.max(0, (ridgeField - 0.42) * 8.2);
          // Smoothly quantized terraces so cottages sit nicely on plateaus with rocky cliffs between!
          const stepH = 1.65;
          const terraced = (Math.floor(rawMount / stepH) + M.smoothstep(0.62, 0.95, (rawMount % stepH) / stepH)) * stepH;
          h = 0.25 + terraced + (n2 - 0.5) * 0.18 + rim * 0.65;

          // Lower valley crystal tarn in SE quadrant
          const tarnD = Math.hypot(x - halfSize * 0.22, z - halfSize * 0.22);
          const tarnR = halfSize * 0.20 * waterLevelMul;
          if (tarnD < tarnR && terraced < 0.8) {
            const tw = M.smootherstep(tarnR, tarnR * 0.25, tarnD);
            wc = tw * 1.35;
            h = M.lerp(h, 0.14, tw);
          }
        } else if (archetype === 'twin_brooks') {
          // Two brooks from NW and NE meeting near (0, 2) and flowing south!
          let distStream = 999;
          if (z < 2.0) {
            const b1X = (z - 2.0) * 0.68 + Math.sin(z * 0.14) * 2.4;
            const b2X = -(z - 2.0) * 0.62 + Math.cos(z * 0.13) * 2.4;
            distStream = Math.min(Math.abs(x - b1X), Math.abs(x - b2X));
          } else {
            const mainX = Math.sin((z - 2.0) * 0.11) * 3.2;
            distStream = Math.abs(x - mainX) * 0.82;
          }
          const bw = (2.4 + M.noise2D(x * 0.12, z * 0.12) * 1.1) * (0.75 + waterLevelMul * 0.35);
          if (distStream < bw) {
            const w = M.smootherstep(bw, bw * 0.22, distStream);
            wc = w * 1.22;
            h = M.lerp(h, 0.12, w);
          }
        } else if (archetype === 'ancient_ruins') {
          // Picturesque central knoll + old moat crescent
          const knollD = Math.hypot(x + 2.0, z + 1.5);
          const knollR = halfSize * 0.28;
          if (knollD < knollR) {
            h += M.smootherstep(knollR, knollR * 0.25, knollD) * 1.95;
          }
          const moatAng = Math.atan2(z + 1.5, x + 2.0);
          const moatR = halfSize * 0.30;
          if (Math.abs(knollD - moatR) < 3.4 * waterLevelMul && moatAng > -0.6 && moatAng < 2.4) {
            const mw = M.smootherstep(3.4 * waterLevelMul, 0.8, Math.abs(knollD - moatR));
            wc = mw * 1.25;
            h = M.lerp(h, 0.14, mw);
          }
        } else {
          // 'clearing': add optional natural pond if waterLevelMul >= 0.75
          if (waterLevelMul >= 0.75) {
            const px = halfSize * 0.22, pz = halfSize * 0.18;
            const pr = halfSize * 0.14 * waterLevelMul;
            const pd = Math.hypot(x - px, z - pz) + (n2 - 0.5) * 2.5;
            if (pd < pr) {
              const pw = M.smootherstep(pr, pr * 0.25, pd);
              wc = pw * 1.3;
              h = M.lerp(h, 0.14, pw);
            }
          }
        }

        baseH[i] = h;
        waterCarve[i] = wc;
        pathMask[i] = 0;
        flowerMask[i] = M.saturate((M.fbm2D((x - sOffX) * 0.17 + 31, (z + sOffZ) * 0.17 - 19, 3) - 0.46) * 2.25);
        buildingMask[i] = 0;
      }
    }

    recomputeEffectiveHeight();
  }

  // Seamless Live Map Expansion: preserves 100% of existing terrain, water & paths!
  function expandDomainPreservingContent(newWorldSize, seed = 2026) {
    const cfg = PALETTES.getMapSizeConfig(newWorldSize);
    if (cfg.worldSize <= worldSize + 0.5) return false;

    const oldHalf = halfSize;
    const oldCell = cellSize;
    const oldGrid = gridN;
    const oldBaseH = new Float32Array(baseH);
    const oldWater = new Float32Array(waterCarve);
    const oldPath = new Float32Array(pathMask);
    const oldFlower = new Float32Array(flowerMask);

    const sampleOld = (arr, x, z) => {
      const fx = M.clamp((x + oldHalf) / oldCell, 0, oldGrid - 1.0001);
      const fz = M.clamp((z + oldHalf) / oldCell, 0, oldGrid - 1.0001);
      const ix = fx | 0;
      const iz = fz | 0;
      const tx = fx - ix;
      const tz = fz - iz;
      const i00 = iz * oldGrid + ix;
      const i10 = i00 + 1;
      const i01 = i00 + oldGrid;
      const i11 = i01 + 1;
      const a = arr[i00] + (arr[i10] - arr[i00]) * tx;
      const b = arr[i01] + (arr[i11] - arr[i01]) * tx;
      return a + (b - a) * tz;
    };

    setDomain(cfg.worldSize, cfg.gridN);

    for (let iz = 0; iz < gridN; iz++) {
      const z = gridToWorldZ(iz);
      for (let ix = 0; ix < gridN; ix++) {
        const x = gridToWorldX(ix);
        const i = idx(ix, iz);
        const cheb = Math.max(Math.abs(x), Math.abs(z));

        const outerNaturalH = evalNaturalMeadow(x, z, halfSize, seed);
        const outerFlower = M.saturate((M.fbm2D(x * 0.17 + 31, z * 0.17 - 19, 3) - 0.48) * 2.2);

        if (cheb <= oldHalf - 0.4) {
          const prevH = sampleOld(oldBaseH, x, z);
          const prevW = sampleOld(oldWater, x, z);
          const prevP = sampleOld(oldPath, x, z);
          const prevF = sampleOld(oldFlower, x, z);

          // Smoothly blend the outermost 4.5m border of the old rim into the newly opened valley
          // (unless water or path was painted right near the border)
          const borderBlend = M.smootherstep(oldHalf - 5.0, oldHalf - 0.4, cheb) * (1.0 - M.saturate(prevW * 2 + prevP * 2));
          baseH[i] = M.lerp(prevH, outerNaturalH, borderBlend * 0.82);
          waterCarve[i] = prevW;
          pathMask[i] = prevP;
          flowerMask[i] = M.lerp(prevF, outerFlower, borderBlend * 0.5);
        } else {
          // Newly unlocked outer valley territory!
          baseH[i] = outerNaturalH;
          waterCarve[i] = 0;
          pathMask[i] = 0;
          flowerMask[i] = outerFlower;
        }
        buildingMask[i] = 0;
      }
    }

    recomputeEffectiveHeight();
    return true;
  }

  function recomputeEffectiveHeight() {
    for (let i = 0; i < totalVerts; i++) {
      const cw = waterCarve[i];
      if (cw > 0.001) {
        const blend = M.smootherstep(0.0, 0.52, cw);
        const targetBed = WATER_LEVEL - cw;
        rawEffectiveH[i] = M.lerp(baseH[i], Math.min(baseH[i], targetBed), blend);
      } else {
        rawEffectiveH[i] = baseH[i];
      }
    }
    // 2-pass organic bank smoothing so overlapping pond strokes & island cliffs have silky slopes
    effectiveH.set(rawEffectiveH);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? effectiveH : rawEffectiveH;
      const dst = pass === 0 ? rawEffectiveH : effectiveH;
      dst.set(src);
      for (let iz = 1; iz < gridN - 1; iz++) {
        for (let ix = 1; ix < gridN - 1; ix++) {
          const i = iz * gridN + ix;
          const avg = (
            src[i] * 4 +
            src[i - 1] + src[i + 1] + src[i - gridN] + src[i + gridN]
          ) / 8;
          dst[i] = M.lerp(src[i], avg, 0.58);
        }
      }
    }
    dirtyMesh = true;
    dirtyGpuMap = true;
  }

  function sampleField(field, x, z) {
    const fx = M.clamp((x + halfSize) / cellSize, 0, gridN - 1.0001);
    const fz = M.clamp((z + halfSize) / cellSize, 0, gridN - 1.0001);
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const i00 = idx(ix, iz);
    const i10 = i00 + 1;
    const i01 = i00 + gridN;
    const i11 = i01 + 1;
    const a = field[i00] + (field[i10] - field[i00]) * tx;
    const b = field[i01] + (field[i11] - field[i01]) * tx;
    return a + (b - a) * tz;
  }

  function getHeight(x, z) {
    return sampleField(effectiveH, x, z);
  }

  function getBaseHeight(x, z) {
    return sampleField(baseH, x, z);
  }

  function getLandHeight(x, z) {
    return Math.max(WATER_LEVEL, getHeight(x, z));
  }

  function getPath(x, z) {
    if (Math.abs(x) > halfSize || Math.abs(z) > halfSize) return 0;
    return sampleField(pathMask, x, z);
  }

  function getWaterDepth(x, z) {
    if (Math.abs(x) > halfSize || Math.abs(z) > halfSize) return 0;
    return Math.max(0, WATER_LEVEL - getHeight(x, z));
  }

  function isWater(x, z, minDepth = 0.035) {
    if (Math.abs(x) > halfSize || Math.abs(z) > halfSize) return false;
    return getHeight(x, z) < WATER_LEVEL - minDepth;
  }

  function getNormal(x, z, out = [0, 1, 0]) {
    const e = cellSize * 0.85;
    const hL = getHeight(x - e, z);
    const hR = getHeight(x + e, z);
    const hD = getHeight(x, z - e);
    const hU = getHeight(x, z + e);
    let nx = hL - hR;
    let ny = 2 * e;
    let nz = hD - hU;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l;
    out[1] = ny / l;
    out[2] = nz / l;
    return out;
  }

  // Sculpt hill/valley/plateau around (wx, wz)
  function sculptHeight(wx, wz, radius, delta, mode = 'raise', targetY = 1.0) {
    const minIx = Math.max(1, Math.floor((wx - radius + halfSize) / cellSize));
    const maxIx = Math.min(gridN - 2, Math.ceil((wx + radius + halfSize) / cellSize));
    const minIz = Math.max(1, Math.floor((wz - radius + halfSize) / cellSize));
    const maxIz = Math.min(gridN - 2, Math.ceil((wz + radius + halfSize) / cellSize));

    for (let iz = minIz; iz <= maxIz; iz++) {
      const z = gridToWorldZ(iz);
      for (let ix = minIx; ix <= maxIx; ix++) {
        const x = gridToWorldX(ix);
        const d = Math.hypot(x - wx, z - wz);
        if (d >= radius) continue;
        const w = M.smootherstep(radius, 0, d);
        const i = idx(ix, iz);

        if (mode === 'raise') {
          baseH[i] = M.clamp(baseH[i] + delta * w, -0.12, 10.5);
          if (delta > 0) waterCarve[i] = Math.max(0, waterCarve[i] - delta * w * 1.4);
        } else if (mode === 'lower') {
          baseH[i] = M.clamp(baseH[i] - Math.abs(delta) * w, -0.1, 10.5);
        } else if (mode === 'plateau') {
          baseH[i] = M.lerp(baseH[i], M.clamp(targetY, 0.05, 9.5), w * 0.32);
          waterCarve[i] = Math.max(0, waterCarve[i] * (1 - w * 0.5));
        }
      }
    }
    recomputeEffectiveHeight();
  }

  // Paint crystal pond / stream / moat
  function paintWater(wx, wz, radius, depth = 1.25, erase = false) {
    const minIx = Math.max(1, Math.floor((wx - radius + halfSize) / cellSize));
    const maxIx = Math.min(gridN - 2, Math.ceil((wx + radius + halfSize) / cellSize));
    const minIz = Math.max(1, Math.floor((wz - radius + halfSize) / cellSize));
    const maxIz = Math.min(gridN - 2, Math.ceil((wz + radius + halfSize) / cellSize));

    for (let iz = minIz; iz <= maxIz; iz++) {
      const z = gridToWorldZ(iz);
      for (let ix = minIx; ix <= maxIx; ix++) {
        const x = gridToWorldX(ix);
        const d = Math.hypot(x - wx, z - wz);
        if (d >= radius) continue;
        const w = M.smootherstep(radius, radius * 0.18, d);
        const i = idx(ix, iz);
        if (erase) {
          waterCarve[i] = Math.max(0, waterCarve[i] - w * 0.45);
          if (baseH[i] < 0.08) baseH[i] = M.lerp(baseH[i], 0.16, w * 0.35);
        } else {
          waterCarve[i] = Math.max(waterCarve[i], w * depth);
          baseH[i] = M.lerp(baseH[i], Math.min(baseH[i], 0.25), w * 0.55);
        }
      }
    }
    recomputeEffectiveHeight();
  }

  // Paint path stroke between (x0,z0) and (x1,z1)
  function paintPathSegment(x0, z0, x1, z1, radius = 1.15, erase = false) {
    const pad = radius + cellSize * 1.5;
    const minX = Math.min(x0, x1) - pad, maxX = Math.max(x0, x1) + pad;
    const minZ = Math.min(z0, z1) - pad, maxZ = Math.max(z0, z1) + pad;
    const minIx = Math.max(1, Math.floor((minX + halfSize) / cellSize));
    const maxIx = Math.min(gridN - 2, Math.ceil((maxX + halfSize) / cellSize));
    const minIz = Math.max(1, Math.floor((minZ + halfSize) / cellSize));
    const maxIz = Math.min(gridN - 2, Math.ceil((maxZ + halfSize) / cellSize));

    for (let iz = minIz; iz <= maxIz; iz++) {
      const z = gridToWorldZ(iz);
      for (let ix = minIx; ix <= maxIx; ix++) {
        const x = gridToWorldX(ix);
        const cp = M.closestOnSegment2D(x, z, x0, z0, x1, z1);
        if (cp.dist >= radius) continue;
        const edgeJitter = (M.noise2D(x * 1.7 + 5.1, z * 1.7 - 3.3) - 0.5) * 0.22;
        const w = M.smootherstep(radius, radius * 0.32, cp.dist + edgeJitter);
        const i = idx(ix, iz);
        if (erase) {
          pathMask[i] = Math.max(0, pathMask[i] - w * 0.75);
        } else {
          pathMask[i] = Math.min(1, Math.max(pathMask[i], w));
        }
      }
    }
    dirtyMesh = true;
    dirtyGpuMap = true;
  }

  function paintFlowers(wx, wz, radius = 2.4, amount = 1.0) {
    const minIx = Math.max(1, Math.floor((wx - radius + halfSize) / cellSize));
    const maxIx = Math.min(gridN - 2, Math.ceil((wx + radius + halfSize) / cellSize));
    const minIz = Math.max(1, Math.floor((wz - radius + halfSize) / cellSize));
    const maxIz = Math.min(gridN - 2, Math.ceil((wz + radius + halfSize) / cellSize));

    for (let iz = minIz; iz <= maxIz; iz++) {
      const z = gridToWorldZ(iz);
      for (let ix = minIx; ix <= maxIx; ix++) {
        const x = gridToWorldX(ix);
        const d = Math.hypot(x - wx, z - wz);
        if (d >= radius) continue;
        const w = M.smootherstep(radius, 0, d);
        const i = idx(ix, iz);
        if (amount >= 0) {
          flowerMask[i] = M.clamp(flowerMask[i] + w * 0.65, 0, 1);
        } else {
          flowerMask[i] = M.clamp(flowerMask[i] - w * 0.85, 0, 1);
        }
      }
    }
    dirtyGpuMap = true;
  }

  // Update grass suppression footprints from buildings & walls
  function updateBuildingSuppression(buildings, walls) {
    buildingMask.fill(0);

    for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
      const b = buildings[bIdx];
      const liftFactor = b.baseLift > 1.1 ? 0.45 : 1.0;
      const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
      const boundR = b.type === 'tower' ? b.r + 0.7 : Math.hypot(b.w * 0.5, b.d * 0.5) + 0.7;

      const minIx = Math.max(0, Math.floor((b.x - boundR + halfSize) / cellSize));
      const maxIx = Math.min(gridN - 1, Math.ceil((b.x + boundR + halfSize) / cellSize));
      const minIz = Math.max(0, Math.floor((b.z - boundR + halfSize) / cellSize));
      const maxIz = Math.min(gridN - 1, Math.ceil((b.z + boundR + halfSize) / cellSize));

      for (let iz = minIz; iz <= maxIz; iz++) {
        const z = gridToWorldZ(iz);
        for (let ix = minIx; ix <= maxIx; ix++) {
          const x = gridToWorldX(ix);
          let distOut = 99;
          if (b.type === 'tower') {
            distOut = Math.hypot(x - b.x, z - b.z) - b.r;
          } else {
            const lx = (x - b.x) * c - (z - b.z) * s;
            const lz = (x - b.x) * s + (z - b.z) * c;
            const dx = Math.abs(lx) - b.w * 0.5;
            const dz = Math.abs(lz) - b.d * 0.5;
            distOut = Math.max(dx, dz);
          }
          if (distOut < 0.45) {
            const w = M.smoothstep(0.45, -0.15, distOut) * liftFactor;
            const i = idx(ix, iz);
            if (w > buildingMask[i]) buildingMask[i] = w;
          }
        }
      }
    }

    for (let wIdx = 0; wIdx < walls.length; wIdx++) {
      const wall = walls[wIdx];
      if (!wall.samples || wall.samples.length < 2) continue;
      const rad = wall.kind === 'stone' ? 0.58 : 0.28;
      for (let s = 0; s < wall.samples.length - 1; s++) {
        const a = wall.samples[s];
        const b = wall.samples[s + 1];
        const minIx = Math.max(0, Math.floor((Math.min(a.x, b.x) - rad + halfSize) / cellSize));
        const maxIx = Math.min(gridN - 1, Math.ceil((Math.max(a.x, b.x) + rad + halfSize) / cellSize));
        const minIz = Math.max(0, Math.floor((Math.min(a.z, b.z) - rad + halfSize) / cellSize));
        const maxIz = Math.min(gridN - 1, Math.ceil((Math.max(a.z, b.z) + rad + halfSize) / cellSize));
        for (let iz = minIz; iz <= maxIz; iz++) {
          const z = gridToWorldZ(iz);
          for (let ix = minIx; ix <= maxIx; ix++) {
            const x = gridToWorldX(ix);
            const cp = M.closestOnSegment2D(x, z, a.x, a.z, b.x, b.z);
            if (cp.dist < rad) {
              const i = idx(ix, iz);
              buildingMask[i] = Math.max(buildingMask[i], M.smoothstep(rad, rad * 0.2, cp.dist));
            }
          }
        }
      }
    }

    dirtyGpuMap = true;
  }

  // Pack height + masks into RGBA8 GPU map
  function getGpuMapData() {
    if (dirtyGpuMap) {
      for (let i = 0; i < totalVerts; i++) {
        const hNorm = M.saturate((effectiveH[i] - HEIGHT_MIN) / HEIGHT_SPAN);
        const h16 = Math.round(hNorm * 65535);
        const hi = (h16 >> 8) & 255;
        const lo = h16 & 255;

        const wetSuppress = M.smoothstep(WATER_LEVEL + 0.10, WATER_LEVEL - 0.04, effectiveH[i]);
        const pathSup = M.smoothstep(0.18, 0.65, pathMask[i]);
        const suppress = M.saturate(Math.max(buildingMask[i], wetSuppress, pathSup));

        const ix = i % gridN;
        const iz = (i / gridN) | 0;
        let slopeSup = 0;
        if (ix > 0 && ix < gridN - 1 && iz > 0 && iz < gridN - 1) {
          const dx = effectiveH[i + 1] - effectiveH[i - 1];
          const dz = effectiveH[i + gridN] - effectiveH[i - gridN];
          const grad = Math.hypot(dx, dz) / (2 * cellSize);
          slopeSup = M.smoothstep(0.55, 1.05, grad);
        }

        const totalSup = Math.max(suppress, slopeSup);
        const o = i * 4;
        gpuMapData[o] = hi;
        gpuMapData[o + 1] = lo;
        gpuMapData[o + 2] = Math.round(totalSup * 255);
        gpuMapData[o + 3] = Math.round(M.saturate(flowerMask[i]) * 255);
      }
      dirtyGpuMap = false;
    }
    return gpuMapData;
  }

  // Raycast against terrain (optionally hitting water surface too)
  function raycast(ray, includeWater = true) {
    const maxDist = Math.max(185.0, worldSize * 2.2);
    let prevT = 0.4;

    for (let t = 0.4; t < maxDist; t += 0.5) {
      const px = ray.ox + ray.dx * t;
      const py = ray.oy + ray.dy * t;
      const pz = ray.oz + ray.dz * t;
      if (Math.abs(px) > halfSize + 10 || Math.abs(pz) > halfSize + 10) {
        prevT = t;
        continue;
      }
      let surfY = getHeight(px, pz);
      if (includeWater && surfY < WATER_LEVEL) surfY = WATER_LEVEL;
      const diff = py - surfY;
      if (diff <= 0) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = ray.ox + ray.dx * mid;
          const my = ray.oy + ray.dy * mid;
          const mz = ray.oz + ray.dz * mid;
          let sy = getHeight(mx, mz);
          if (includeWater && sy < WATER_LEVEL) sy = WATER_LEVEL;
          if (my - sy <= 0) hi = mid;
          else lo = mid;
        }
        const hitT = (lo + hi) * 0.5;
        const hx = ray.ox + ray.dx * hitT;
        const hz = ray.oz + ray.dz * hitT;
        const cx = M.clamp(hx, -halfSize + 0.6, halfSize - 0.6);
        const cz = M.clamp(hz, -halfSize + 0.6, halfSize - 0.6);
        const groundY = getHeight(cx, cz);
        const hitWater = includeWater && groundY < WATER_LEVEL;
        const hy = hitWater ? WATER_LEVEL : groundY;
        const n = getNormal(cx, cz);
        return {
          t: hitT,
          x: cx,
          y: hy,
          groundY,
          z: cz,
          rawX: hx,
          rawZ: hz,
          nx: hitWater ? 0 : n[0],
          ny: hitWater ? 1 : n[1],
          nz: hitWater ? 0 : n[2],
          isWater: hitWater
        };
      }
      prevT = t;
    }
    const fallback = M.rayPlaneY(ray, 0);
    if (fallback) {
      const cx = M.clamp(fallback.x, -halfSize + 1, halfSize - 1);
      const cz = M.clamp(fallback.z, -halfSize + 1, halfSize - 1);
      const gy = getHeight(cx, cz);
      return {
        t: fallback.t,
        x: cx,
        y: gy,
        groundY: gy,
        z: cz,
        rawX: fallback.x,
        rawZ: fallback.z,
        nx: 0, ny: 1, nz: 0,
        isWater: false
      };
    }
    return null;
  }

  // Rolling horizon vista skirt extending seamlessly from +-halfSize out to +-260m!
  function buildOuterVistaMesh(seasonObj) {
    vistaBuilder.clear();
    const MAT_TERRAIN = PALETTES.MAT.TERRAIN;

    // 24 segments per square side -> 96 perimeter steps
    const sideSegs = 24;
    const perimCount = sideSegs * 4;
    const ringOffsets = [0.0, 5.5, 15.0, 32.0, 58.0, 95.0, 145.0, 210.0];
    const nRings = ringOffsets.length;

    // Perimeter point on unit square [-1, 1] going CCW from above so (R x T).y > 0:
    // Side 0: (-1, +1) -> (+1, +1)
    // Side 1: (+1, +1) -> (+1, -1)
    // Side 2: (+1, -1) -> (-1, -1)
    // Side 3: (-1, -1) -> (-1, +1)
    const unitPerim = (pIdx) => {
      const k = ((pIdx % perimCount) + perimCount) % perimCount;
      const side = Math.floor(k / sideSegs);
      const t = (k % sideSegs) / sideSegs;
      const u = -1 + 2 * t;
      if (side === 0) return [u, 1];
      if (side === 1) return [1, -u];
      if (side === 2) return [-u, -1];
      return [-1, u];
    };

    const evalVistaVert = (ri, pi) => {
      const [sx, sz] = unitPerim(pi);
      const len = Math.hypot(sx, sz) || 1;
      const cx = sx / len, cz = sz / len;
      const off = ringOffsets[ri];

      let wx, wz, wy;
      if (ri === 0) {
        // Tuck 0.25m inside playable terrain edge & 0.08m below surface so zero seam cracks ever appear!
        wx = sx * (halfSize - 0.25);
        wz = sz * (halfSize - 0.25);
        wy = getHeight(wx, wz) - 0.08;
      } else {
        // Smoothly morph square perimeter into circular horizon rings
        const roundBlend = M.smoothstep(0, 75.0, off);
        const dirX = M.lerp(sx, cx, roundBlend);
        const dirZ = M.lerp(sz, cz, roundBlend);
        const baseR = halfSize + off;
        wx = dirX * baseR;
        wz = dirZ * baseR;

        const edgeX = sx * halfSize;
        const edgeZ = sz * halfSize;
        const edgeH = getHeight(edgeX, edgeZ);

        // Rolling pastoral hills & distant mountain silhouettes!
        const hill1 = M.fbm2D(wx * 0.018 + currentSeed * 0.11, wz * 0.018 - 4.7, 4);
        const hill2 = M.fbm2D(wx * 0.048 - 9.2, wz * 0.048 + 6.1, 3);
        const distWave = Math.max(0, hill1 - 0.36) * (14.0 + off * 0.07) + (hill2 - 0.5) * 2.8;
        const valleyDip = -1.2 * M.smoothstep(0, 45.0, off);
        const farH = 0.8 + valleyDip + distWave;
        wy = M.lerp(edgeH, farH, M.smootherstep(0.0, 26.0, off));
      }

      const patch = M.fbm2D(wx * 0.05 + 3.1, wz * 0.05 - 2.4, 3);
      let col = M.mixColor(seasonObj.grassBase, seasonObj.grassTip, M.saturate(patch * 1.1));
      if (wy > 6.5) {
        const rockMix = M.smoothstep(6.5, 13.5, wy);
        col = M.mixColor(col, seasonObj.cliffColor, rockMix * 0.72);
      }
      return { x: wx, y: wy, z: wz, r: col[0], g: col[1], b: col[2] };
    };

    // Precompute ring grid vertices & normals
    const grid = new Array(nRings);
    for (let ri = 0; ri < nRings; ri++) {
      grid[ri] = new Array(perimCount);
      for (let pi = 0; pi < perimCount; pi++) {
        grid[ri][pi] = evalVistaVert(ri, pi);
      }
    }

    for (let ri = 0; ri < nRings; ri++) {
      for (let pi = 0; pi < perimCount; pi++) {
        const v = grid[ri][pi];
        const vPrevP = grid[ri][(pi - 1 + perimCount) % perimCount];
        const vNextP = grid[ri][(pi + 1) % perimCount];
        const vIn = grid[Math.max(0, ri - 1)][pi];
        const vOut = grid[Math.min(nRings - 1, ri + 1)][pi];

        // R = vOut - vIn, T = vNextP - vPrevP -> N = R x T (points +Y!)
        const rx = vOut.x - vIn.x, ry = vOut.y - vIn.y, rz = vOut.z - vIn.z;
        const tx = vNextP.x - vPrevP.x, ty = vNextP.y - vPrevP.y, tz = vNextP.z - vPrevP.z;
        let nx = ry * tz - rz * ty;
        let ny = rz * tx - rx * tz;
        let nz = rx * ty - ry * tx;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const nl = Math.hypot(nx, ny, nz) || 1;
        v.nx = nx / nl;
        v.ny = ny / nl;
        v.nz = nz / nl;
      }
    }

    const pushVV = (v, ao) => {
      vistaBuilder.pushVert(v.x, v.y, v.z, v.nx, v.ny, v.nz, v.r, v.g, v.b, MAT_TERRAIN, ao, 0);
    };

    for (let ri = 0; ri < nRings - 1; ri++) {
      const ao0 = ri === 0 ? 0.88 : 0.92;
      const ao1 = 0.94;
      for (let pi = 0; pi < perimCount; pi++) {
        const nextPi = (pi + 1) % perimCount;
        const p00 = grid[ri][pi];
        const p10 = grid[ri + 1][pi];
        const p11 = grid[ri + 1][nextPi];
        const p01 = grid[ri][nextPi];
        vistaBuilder.ensure(6);
        // p00 -> p10 -> p11 and p00 -> p11 -> p01 (CCW from above!)
        pushVV(p00, ao0);
        pushVV(p10, ao1);
        pushVV(p11, ao1);

        pushVV(p00, ao0);
        pushVV(p11, ao1);
        pushVV(p01, ao0);
      }
    }
  }

  // Build vertex-colored stylized terrain, water & outer horizon vista meshes
  function buildMeshes(seasonObj) {
    terrainBuilder.clear();
    waterBuilder.clear();

    const MAT_TERRAIN = PALETTES.MAT.TERRAIN;
    const normals = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);
    const aos = new Float32Array(totalVerts);

    for (let iz = 0; iz < gridN; iz++) {
      const z = gridToWorldZ(iz);
      for (let ix = 0; ix < gridN; ix++) {
        const x = gridToWorldX(ix);
        const i = idx(ix, iz);
        const h = effectiveH[i];

        const hL = effectiveH[idx(Math.max(0, ix - 1), iz)];
        const hR = effectiveH[idx(Math.min(gridN - 1, ix + 1), iz)];
        const hD = effectiveH[idx(ix, Math.max(0, iz - 1))];
        const hU = effectiveH[idx(ix, Math.min(gridN - 1, iz + 1))];

        let nx = hL - hR;
        let ny = 2 * cellSize;
        let nz = hD - hU;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        normals[i * 3] = nx;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = nz;

        const avgNbr = (hL + hR + hD + hU) * 0.25;
        const concavity = M.clamp((avgNbr - h) * 2.2, -0.25, 0.35);
        aos[i] = M.clamp(1.0 - concavity - buildingMask[i] * 0.22, 0.52, 1.05);

        const patch = M.fbm2D(x * 0.13 + 7.7, z * 0.13 - 4.2, 3);
        let col = M.mixColor(seasonObj.grassBase, seasonObj.grassTip, M.saturate(patch * 1.15));

        if (buildingMask[i] > 0.05) {
          col = M.mixColor(col, seasonObj.soilColor, buildingMask[i] * 0.72);
        }

        const pw = pathMask[i];
        if (pw > 0.02) {
          const cobbleNoise = M.noise2D(x * 3.8, z * 3.8);
          const pCol = M.mixColor(seasonObj.soilColor, seasonObj.pathColor, M.smoothstep(0.25, 0.75, pw) * (0.75 + cobbleNoise * 0.3));
          col = M.mixColor(col, pCol, M.smoothstep(0.05, 0.55, pw));
        }

        const slope = 1.0 - ny;
        if (slope > 0.13) {
          const strata = 0.85 + 0.25 * Math.sin(h * 7.5 + M.noise2D(x * 0.9, z * 0.9) * 2.0);
          const rockCol = [
            seasonObj.cliffColor[0] * strata,
            seasonObj.cliffColor[1] * strata,
            seasonObj.cliffColor[2] * strata
          ];
          col = M.mixColor(col, rockCol, M.smoothstep(0.13, 0.32, slope));
        }

        const distWater = h - WATER_LEVEL;
        if (distWater < 0.22) {
          const pebble = 0.85 + 0.25 * M.noise2D(x * 4.2, z * 4.2);
          const bedCol = [0.36 * pebble, 0.34 * pebble, 0.28 * pebble];
          const wetBlend = M.smoothstep(0.22, -0.15, distWater);
          col = M.mixColor(col, bedCol, wetBlend * 0.88);
        }

        colors[i * 3] = col[0];
        colors[i * 3 + 1] = col[1];
        colors[i * 3 + 2] = col[2];
      }
    }

    const pushTVert = (i, x, z) => {
      terrainBuilder.pushVert(
        x, effectiveH[i], z,
        normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2],
        colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2],
        MAT_TERRAIN, aos[i], pathMask[i]
      );
    };

    for (let iz = 0; iz < gridN - 1; iz++) {
      const z0 = gridToWorldZ(iz);
      const z1 = gridToWorldZ(iz + 1);
      for (let ix = 0; ix < gridN - 1; ix++) {
        const x0 = gridToWorldX(ix);
        const x1 = gridToWorldX(ix + 1);
        const i00 = idx(ix, iz);
        const i10 = i00 + 1;
        const i01 = i00 + gridN;
        const i11 = i01 + 1;

        terrainBuilder.ensure(6);
        pushTVert(i00, x0, z0);
        pushTVert(i01, x0, z1);
        pushTVert(i11, x1, z1);

        pushTVert(i00, x0, z0);
        pushTVert(i11, x1, z1);
        pushTVert(i10, x1, z0);

        const minH = Math.min(effectiveH[i00], effectiveH[i10], effectiveH[i01], effectiveH[i11]);
        if (minH < WATER_LEVEL + 0.08) {
          const d00 = WATER_LEVEL - effectiveH[i00];
          const d10 = WATER_LEVEL - effectiveH[i10];
          const d01 = WATER_LEVEL - effectiveH[i01];
          const d11 = WATER_LEVEL - effectiveH[i11];
          waterBuilder.ensure(6);
          const wy = WATER_LEVEL;
          waterBuilder.pushVert(x0, wy, z0, 0, 1, 0, 1, 1, 1, 0, d00, pathMask[i00]);
          waterBuilder.pushVert(x0, wy, z1, 0, 1, 0, 1, 1, 1, 0, d01, pathMask[i01]);
          waterBuilder.pushVert(x1, wy, z1, 0, 1, 0, 1, 1, 1, 0, d11, pathMask[i11]);

          waterBuilder.pushVert(x0, wy, z0, 0, 1, 0, 1, 1, 1, 0, d00, pathMask[i00]);
          waterBuilder.pushVert(x1, wy, z1, 0, 1, 0, 1, 1, 1, 0, d11, pathMask[i11]);
          waterBuilder.pushVert(x1, wy, z0, 0, 1, 0, 1, 1, 1, 0, d10, pathMask[i10]);
        }
      }
    }

    buildOuterVistaMesh(seasonObj);

    dirtyMesh = false;
    return {
      terrainVerts: terrainBuilder.subarrayView(),
      terrainCount: terrainBuilder.vertCount,
      waterVerts: waterBuilder.subarrayView(),
      waterCount: waterBuilder.vertCount,
      vistaVerts: vistaBuilder.subarrayView(),
      vistaCount: vistaBuilder.vertCount
    };
  }

  // Serialization for Save/Load & Undo/Redo (supports v1 60m saves + v2 variable-size saves!)
  function serialize() {
    return {
      worldSize,
      gridN,
      seed: currentSeed,
      baseH: Array.from(baseH, (v) => Math.round(v * 1000) / 1000),
      waterCarve: Array.from(waterCarve, (v) => Math.round(v * 1000) / 1000),
      pathMask: Array.from(pathMask, (v) => Math.round(v * 1000) / 1000),
      flowerMask: Array.from(flowerMask, (v) => Math.round(v * 1000) / 1000)
    };
  }

  function deserialize(snap) {
    if (!snap) return;
    const inferredGrid = snap.gridN || (snap.baseH ? Math.round(Math.sqrt(snap.baseH.length)) : 145);
    const inferredSize = snap.worldSize || (inferredGrid === 225 ? 136 : inferredGrid === 193 ? 96 : 60);
    setDomain(inferredSize, inferredGrid);
    if (snap.seed) currentSeed = snap.seed;

    if (snap.baseH && snap.baseH.length === totalVerts) baseH.set(snap.baseH);
    if (snap.waterCarve && snap.waterCarve.length === totalVerts) waterCarve.set(snap.waterCarve);
    if (snap.pathMask && snap.pathMask.length === totalVerts) pathMask.set(snap.pathMask);
    if (snap.flowerMask && snap.flowerMask.length === totalVerts) flowerMask.set(snap.flowerMask);
    recomputeEffectiveHeight();
  }

  function cloneArrays() {
    return {
      worldSize,
      gridN,
      seed: currentSeed,
      baseH: new Float32Array(baseH),
      waterCarve: new Float32Array(waterCarve),
      pathMask: new Float32Array(pathMask),
      flowerMask: new Float32Array(flowerMask)
    };
  }

  function restoreArrays(snap) {
    if (snap.worldSize && (snap.worldSize !== worldSize || snap.gridN !== gridN)) {
      setDomain(snap.worldSize, snap.gridN);
    }
    if (snap.seed) currentSeed = snap.seed;
    baseH.set(snap.baseH);
    waterCarve.set(snap.waterCarve);
    pathMask.set(snap.pathMask);
    flowerMask.set(snap.flowerMask);
    recomputeEffectiveHeight();
  }

  const api = {
    WATER_LEVEL,
    HEIGHT_MIN,
    HEIGHT_SPAN,
    setDomain,
    resetToNaturalClearing,
    generateArchetypeTerrain,
    expandDomainPreservingContent,
    getHeight,
    getBaseHeight,
    getLandHeight,
    getPath,
    getWaterDepth,
    isWater,
    getNormal,
    sculptHeight,
    paintWater,
    paintPathSegment,
    paintFlowers,
    updateBuildingSuppression,
    getGpuMapData,
    raycast,
    buildMeshes,
    serialize,
    deserialize,
    cloneArrays,
    restoreArrays,
    isDirtyMesh: () => dirtyMesh,
    markDirtyMesh: () => { dirtyMesh = true; },
    isDirtyGpuMap: () => dirtyGpuMap,
    consumeGpuTexResize: () => {
      const flag = dirtyGpuTexResize;
      dirtyGpuTexResize = false;
      return flag;
    }
  };

  Object.defineProperties(api, {
    GRID_N: { get: () => gridN, enumerable: true },
    WORLD_SIZE: { get: () => worldSize, enumerable: true },
    HALF_SIZE: { get: () => halfSize, enumerable: true },
    CELL_SIZE: { get: () => cellSize, enumerable: true }
  });

  return api;
})();
