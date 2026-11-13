// ============================================================================
// nature.js — GPU-Instanced Grass/Flowers, Ghibli Puff Trees, Sheep, Ducks & FX
// ============================================================================

const NATURE = (() => {
  const MAT = PALETTES.MAT;
  const GRASS_COUNT = 68000;
  const FLOWER_COUNT = 6800;
  const MAX_PARTICLES = 440;

  let trees = []; // { id, x, z, scale, seed, style, userPlaced }
  let nextTreeId = 1;
  let treesDirty = true;

  let sheepList = [];
  let duckList = [];
  let birdList = [];

  const particlePool = [];
  const particleInstData = new Float32Array(MAX_PARTICLES * 8);
  let activeParticleCount = 0;

  const treeBuilder = new GEO.MeshBuilder(49152);
  const creatureBuilder = new GEO.MeshBuilder(8192);

  // Build static curved 7-vertex grass blade geometry (pos.xyz, tHeight) -> 4 floats per vert
  function createGrassBladeMesh() {
    const w0 = 0.048, w1 = 0.035, w2 = 0.021;
    const verts = new Float32Array([
      -w0, 0.00, 0.00, 0.00,
       w0, 0.00, 0.00, 0.00,
      -w1, 0.34, 0.04, 0.34,
       w1, 0.34, 0.04, 0.34,
      -w2, 0.68, 0.13, 0.68,
       w2, 0.68, 0.13, 0.68,
       0.0, 1.00, 0.26, 1.00
    ]);
    const indices = new Uint16Array([
      0, 1, 2,  1, 3, 2,
      2, 3, 4,  3, 5, 4,
      4, 5, 6
    ]);
    return { verts, indices };
  }

  // Build static wildflower stem + 5-petal blossom mesh -> 4 floats per vert
  function createFlowerMesh() {
    const v = [];
    const pushTri = (a, b, c, flag) => {
      v.push(a[0], a[1], a[2], flag, b[0], b[1], b[2], flag, c[0], c[1], c[2], flag);
    };
    const sw = 0.016, sh = 0.36;
    pushTri([-sw, 0, 0], [sw, 0, 0], [0, sh, 0.03], 0);
    pushTri([0, 0, -sw], [0, 0, sw], [0, sh, 0.03], 0);

    const cx = 0, cy = sh, cz = 0.03;
    const pr = 0.085;
    for (let i = 0; i < 5; i++) {
      const a0 = (i / 5) * M.TAU;
      const a1 = ((i + 0.72) / 5) * M.TAU;
      pushTri(
        [cx, cy, cz],
        [cx + Math.cos(a0) * pr, cy + 0.025, cz + Math.sin(a0) * pr],
        [cx + Math.cos(a1) * pr, cy + 0.025, cz + Math.sin(a1) * pr],
        1
      );
    }
    const cr = 0.032;
    pushTri([cx - cr, cy + 0.032, cz], [cx + cr, cy + 0.032, cz], [cx, cy + 0.042, cz + cr], 2);
    pushTri([cx + cr, cy + 0.032, cz], [cx - cr, cy + 0.032, cz], [cx, cy + 0.042, cz - cr], 2);

    return new Float32Array(v);
  }

  // Generate GPU instance attributes: [x, z, scale, yaw, seed] covering current TERRAIN.WORLD_SIZE
  function createGrassInstances() {
    const rng = M.mulberry32(202611);
    const data = new Float32Array(GRASS_COUNT * 5);
    const maxHalf = TERRAIN.HALF_SIZE - 0.8;

    for (let i = 0; i < GRASS_COUNT; i++) {
      let x, z;
      if (i < GRASS_COUNT * 0.55) {
        // Rich core meadow coverage
        const rad = Math.pow(rng(), 0.58) * (maxHalf * 0.88);
        const ang = rng() * M.TAU;
        x = Math.cos(ang) * rad;
        z = Math.sin(ang) * rad;
      } else {
        // Full domain coverage including valley corners!
        x = (rng() * 2 - 1) * maxHalf;
        z = (rng() * 2 - 1) * maxHalf;
      }
      const edgeFade = M.smoothstep(maxHalf + 0.4, maxHalf - 3.5, Math.max(Math.abs(x), Math.abs(z)));
      const patch = M.fbm2D(x * 0.14 + 3.1, z * 0.14 - 8.4, 2);
      const scale = (0.34 + patch * 0.44) * (0.78 + rng() * 0.48) * (0.45 + 0.55 * edgeFade);
      const o = i * 5;
      data[o] = x;
      data[o + 1] = z;
      data[o + 2] = scale;
      data[o + 3] = rng() * M.TAU;
      data[o + 4] = rng();
    }
    return data;
  }

  function createFlowerInstances() {
    const rng = M.mulberry32(99173);
    const data = new Float32Array(FLOWER_COUNT * 5);
    const maxR = TERRAIN.HALF_SIZE - 2.0;
    const clusterCount = Math.max(42, Math.round(TERRAIN.WORLD_SIZE * 0.75));

    for (let i = 0; i < FLOWER_COUNT; i++) {
      const clusterAng = Math.floor(rng() * clusterCount) * 2.39996;
      const clusterR = 2.5 + Math.pow(rng(), 0.75) * (maxR - 3.5);
      const cx = Math.cos(clusterAng) * clusterR;
      const cz = Math.sin(clusterAng) * clusterR;
      const x = M.clamp(cx + (rng() - 0.5) * 5.2, -maxR, maxR);
      const z = M.clamp(cz + (rng() - 0.5) * 5.2, -maxR, maxR);
      const o = i * 5;
      data[o] = x;
      data[o + 1] = z;
      data[o + 2] = 0.75 + rng() * 0.65;
      data[o + 3] = rng() * M.TAU;
      data[o + 4] = rng();
    }
    return data;
  }

  // Populate woodland ring & natural grove clusters scaled to any map size & density!
  function resetTrees(seed = 777, densityMul = 1.0) {
    trees = [];
    nextTreeId = 1;
    const rng = M.mulberry32(seed);
    const half = TERRAIN.HALF_SIZE;
    const sizeRatio = TERRAIN.WORLD_SIZE / 60.0;

    // 1. Scalloped organic woodland around perimeter (never a rigid square!)
    const ringCount = Math.round(105 * sizeRatio * sizeRatio * 0.68 * densityMul);
    const innerRing = half * 0.52;
    const outerRing = half - 1.6;

    for (let i = 0; i < ringCount; i++) {
      const ang = (i / Math.max(1, ringCount)) * M.TAU + (rng() - 0.5) * 0.16;
      const scallop = Math.sin(ang * 5.0 + seed) * (half * 0.08);
      const r = innerRing + scallop + Math.pow(rng(), 0.72) * Math.max(4.0, outerRing - innerRing);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (Math.abs(x) > half - 1.5 || Math.abs(z) > half - 1.5) continue;
      if (TERRAIN.isWater(x, z, -0.06)) continue;
      trees.push({
        id: nextTreeId++,
        x, z,
        scale: 0.85 + rng() * 0.72,
        seed: rng(),
        style: rng() < 0.26 ? 'pine' : rng() < 0.58 ? 'oak' : 'birch',
        userPlaced: false
      });
    }

    // 2. Corner woodland fills so square map corners feel lushly forested
    const cornerFillCount = Math.round(48 * sizeRatio * densityMul);
    for (let i = 0; i < cornerFillCount; i++) {
      const sx = rng() < 0.5 ? -1 : 1;
      const sz = rng() < 0.5 ? -1 : 1;
      const x = sx * (half * (0.56 + rng() * 0.39));
      const z = sz * (half * (0.56 + rng() * 0.39));
      if (TERRAIN.isWater(x, z, -0.06)) continue;
      trees.push({
        id: nextTreeId++,
        x, z,
        scale: 0.88 + rng() * 0.68,
        seed: rng(),
        style: rng() < 0.32 ? 'pine' : rng() < 0.65 ? 'oak' : 'birch',
        userPlaced: false
      });
    }

    // 3. Picturesque interior accent groves
    const accentCount = Math.round(9 * sizeRatio * densityMul);
    for (let i = 0; i < accentCount; i++) {
      const ang = rng() * M.TAU;
      const r = 8.5 + rng() * Math.max(4.0, innerRing - 9.5);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (TERRAIN.isWater(x, z, -0.08)) continue;
      trees.push({
        id: nextTreeId++,
        x, z,
        scale: 0.86 + rng() * 0.48,
        seed: rng(),
        style: rng() < 0.2 ? 'pine' : rng() < 0.6 ? 'oak' : 'birch',
        userPlaced: false
      });
    }

    treesDirty = true;
  }

  // Seamlessly populate newly unlocked outer territory when expanding map live!
  function populateExpandedRing(oldHalf, newHalf, seed = 909) {
    const rng = M.mulberry32(seed);
    // Gently thin out ~50% of auto-generated old border-rim trees so the seam opens into natural glades
    trees = trees.filter((t) => {
      if (t.userPlaced) return true;
      const r = Math.max(Math.abs(t.x), Math.abs(t.z));
      if (r > oldHalf * 0.72) return rng() < 0.45;
      return true;
    });

    const areaGain = (newHalf * newHalf - oldHalf * oldHalf) / (30 * 30);
    const addCount = Math.max(45, Math.round(78 * areaGain));
    for (let i = 0; i < addCount; i++) {
      const x = (rng() * 2 - 1) * (newHalf - 1.6);
      const z = (rng() * 2 - 1) * (newHalf - 1.6);
      const cheb = Math.max(Math.abs(x), Math.abs(z));
      if (cheb < oldHalf - 1.5) continue;
      if (TERRAIN.isWater(x, z, -0.06)) continue;
      // Denser near the new outer perimeter, sparser in the newly opened mid-valley!
      const outerProb = M.lerp(0.28, 0.92, M.smoothstep(oldHalf, newHalf * 0.85, cheb));
      if (rng() > outerProb) continue;

      trees.push({
        id: nextTreeId++,
        x, z,
        scale: 0.85 + rng() * 0.72,
        seed: rng(),
        style: rng() < 0.26 ? 'pine' : rng() < 0.58 ? 'oak' : 'birch',
        userPlaced: false
      });
    }

    treesDirty = true;
  }

  function addTree(x, z, style = null) {
    for (const t of trees) {
      if (M.distSq2D(x, z, t.x, t.z) < 1.35 * 1.35) return null;
    }
    const rng = M.mulberry32((nextTreeId * 49157 + Math.round(x * 31)) | 0);
    const chosen = style || (rng() < 0.25 ? 'pine' : rng() < 0.62 ? 'oak' : 'birch');
    const t = {
      id: nextTreeId++,
      x, z,
      scale: 0.82 + rng() * 0.52,
      seed: rng(),
      style: chosen,
      userPlaced: true
    };
    trees.push(t);
    treesDirty = true;
    return t;
  }

  function removeTreesInRadius(wx, wz, radius) {
    const r2 = radius * radius;
    const before = trees.length;
    trees = trees.filter((t) => M.distSq2D(wx, wz, t.x, t.z) > r2);
    if (trees.length !== before) treesDirty = true;
    return before - trees.length;
  }

  function isPointBlockedByStructure(x, z, buildings, walls, pad = 0.85) {
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.type === 'tower') {
        if (M.dist2D(x, z, b.x, b.z) < b.r + pad) return true;
      } else {
        const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
        const lx = (x - b.x) * c - (z - b.z) * s;
        const lz = (x - b.x) * s + (z - b.z) * c;
        if (Math.abs(lx) < b.w * 0.5 + pad && Math.abs(lz) < b.d * 0.5 + pad) return true;
      }
    }
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (!w.samples) continue;
      for (let s = 0; s < w.samples.length; s += 2) {
        if (M.distSq2D(x, z, w.samples[s].x, w.samples[s].z) < (pad * 0.8) * (pad * 0.8)) return true;
      }
    }
    return false;
  }

  function buildNatureMesh(seasonObj, buildings, walls) {
    treeBuilder.clear();
    const paletteHexes = seasonObj.treeColors;

    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      if (TERRAIN.isWater(t.x, t.z, -0.05)) continue;
      if (TERRAIN.getPath(t.x, t.z) > 0.36) continue;
      if (isPointBlockedByStructure(t.x, t.z, buildings, walls, 1.05)) continue;

      const gy = TERRAIN.getHeight(t.x, t.z);
      const rng = M.mulberry32(((t.id * 2654435) ^ Math.floor(t.seed * 99999)) | 0);
      const sc = t.scale;

      const colIdx = Math.floor(t.seed * paletteHexes.length) % paletteHexes.length;
      const baseLeafRgb = M.hexToRgb(paletteHexes[colIdx]);
      const leafRgb = [
        M.clamp(baseLeafRgb[0] + (rng() - 0.5) * 0.08, 0, 1),
        M.clamp(baseLeafRgb[1] + (rng() - 0.5) * 0.08, 0, 1),
        M.clamp(baseLeafRgb[2] + (rng() - 0.5) * 0.06, 0, 1)
      ];

      if (t.style === 'pine') {
        const trunkCol = [0.36, 0.25, 0.18];
        const h = 4.4 * sc;
        treeBuilder.addTaperedTube(t.x, gy - 0.2, t.z, 0.20 * sc, t.x, gy + h * 0.72, t.z, 0.05 * sc, 6, trunkCol[0], trunkCol[1], trunkCol[2], MAT.WOOD, 0.55, 0.9, 0, false);

        const pineCol = seasonObj.id === 'autumn' ? [0.24, 0.44, 0.28] : leafRgb;
        const canopyCenter = [t.x, gy + h * 0.58, t.z];
        for (let tier = 0; tier < 4; tier++) {
          const tf = tier / 3;
          const ty = gy + (1.15 + tf * 2.55) * sc;
          const rad = (1.42 - tf * 0.82) * sc;
          treeBuilder.addPuff(
            t.x + (rng() - 0.5) * 0.12, ty, t.z + (rng() - 0.5) * 0.12,
            rad, 0.68 * sc, rad,
            5, 8,
            pineCol[0] * (0.88 + tf * 0.18), pineCol[1] * (0.88 + tf * 0.18), pineCol[2] * (0.88 + tf * 0.18),
            MAT.FOLIAGE, 0.82 + tf * 0.18, 0.25 + tf * 0.45,
            t.seed * 13 + tier, 0.14, canopyCenter, 0.55
          );
        }
      } else {
        const isBirch = t.style === 'birch';
        const trunkCol = isBirch ? [0.82, 0.79, 0.74] : [0.41, 0.30, 0.21];
        const trunkH = (isBirch ? 2.65 : 2.15) * sc;
        const leanX = (rng() - 0.5) * 0.38 * sc;
        const leanZ = (rng() - 0.5) * 0.38 * sc;
        const topX = t.x + leanX;
        const topZ = t.z + leanZ;

        treeBuilder.addTaperedTube(
          t.x, gy - 0.2, t.z, (isBirch ? 0.16 : 0.25) * sc,
          topX, gy + trunkH, topZ, (isBirch ? 0.08 : 0.13) * sc,
          7, trunkCol[0], trunkCol[1], trunkCol[2], MAT.WOOD, 0.58, 0.90, 0, false
        );

        const canopyCenter = [topX, gy + trunkH + 1.15 * sc, topZ];
        treeBuilder.addPuff(
          canopyCenter[0], canopyCenter[1] + 0.22 * sc, canopyCenter[2],
          1.38 * sc, 1.16 * sc, 1.38 * sc,
          6, 9,
          leafRgb[0] * 1.04, leafRgb[1] * 1.04, leafRgb[2] * 1.02,
          MAT.FOLIAGE, 0.96, 0.58,
          t.seed * 19.1, 0.15, canopyCenter, 0.68
        );

        const puffCount = isBirch ? 4 : 5;
        for (let p = 0; p < puffCount; p++) {
          const ang = (p / puffCount) * M.TAU + t.seed * 5.1;
          const dist = (0.78 + rng() * 0.36) * sc;
          const py = gy + trunkH + (0.55 + (p % 2) * 0.48 + rng() * 0.28) * sc;
          const px = topX + Math.cos(ang) * dist;
          const pz = topZ + Math.sin(ang) * dist;

          treeBuilder.addTaperedTube(
            topX, gy + trunkH * 0.78, topZ, 0.09 * sc,
            px * 0.7 + topX * 0.3, py - 0.2 * sc, pz * 0.7 + topZ * 0.3, 0.04 * sc,
            5, trunkCol[0] * 0.92, trunkCol[1] * 0.92, trunkCol[2] * 0.92, MAT.WOOD, 0.65, 0.85, 0, false
          );

          const shade = 0.90 + rng() * 0.18;
          const pr = (0.85 + rng() * 0.34) * sc;
          treeBuilder.addPuff(
            px, py, pz,
            pr, pr * 0.84, pr,
            5, 8,
            M.clamp(leafRgb[0] * shade, 0, 1), M.clamp(leafRgb[1] * shade, 0, 1), M.clamp(leafRgb[2] * shade, 0, 1),
            MAT.FOLIAGE, 0.88, 0.48 + rng() * 0.25,
            t.seed * 31 + p * 3.7, 0.16, canopyCenter, 0.72
          );
        }

        if (rng() < 0.45) {
          const sa = rng() * M.TAU;
          const sx = t.x + Math.cos(sa) * 0.55 * sc;
          const sz = t.z + Math.sin(sa) * 0.55 * sc;
          const sgy = TERRAIN.getHeight(sx, sz);
          treeBuilder.addPuff(sx, sgy + 0.22, sz, 0.42, 0.30, 0.42, 4, 7, leafRgb[0] * 0.86, leafRgb[1] * 0.90, leafRgb[2] * 0.84, MAT.FOLIAGE, 0.82, 0.25, pSeed(i), 0.15);
        }
      }
    }

    // --- POND LILY PADS & WATER LILIES + SHORELINE REEDS ---
    const lRng = M.mulberry32(514229);
    const scanStep = Math.max(1.9, TERRAIN.WORLD_SIZE / 38);
    const bound = TERRAIN.HALF_SIZE - 3;
    for (let z = -bound; z <= bound; z += scanStep) {
      for (let x = -bound; x <= bound; x += scanStep) {
        const jx = x + (lRng() - 0.5) * 1.4;
        const jz = z + (lRng() - 0.5) * 1.4;
        if (TERRAIN.getPath(jx, jz) > 0.3) continue;
        const wd = TERRAIN.getWaterDepth(jx, jz);
        if (wd > 0.25 && wd < 1.45 && lRng() < 0.42) {
          const padCol = seasonObj.id === 'autumn' ? [0.42, 0.52, 0.22] : [0.22, 0.52, 0.25];
          const wy = TERRAIN.WATER_LEVEL + 0.018;
          treeBuilder.addPuff(jx, wy, jz, 0.26, 0.022, 0.26, 3, 7, padCol[0], padCol[1], padCol[2], MAT.FOLIAGE, 0.95, 0.08, jx, 0.05);
          if (lRng() < 0.45) {
            treeBuilder.addPuff(jx + 0.03, wy + 0.055, jz, 0.085, 0.065, 0.085, 4, 6, 0.96, 0.72, 0.80, MAT.FOLIAGE, 1.0, 0.12, jz, 0.05);
          }
        } else if (wd > -0.08 && wd <= 0.18 && Math.abs(TERRAIN.getHeight(jx, jz) - TERRAIN.WATER_LEVEL) < 0.12 && lRng() < 0.32) {
          const reedCol = seasonObj.id === 'autumn' ? [0.64, 0.54, 0.26] : [0.34, 0.54, 0.26];
          const rgy = TERRAIN.getHeight(jx, jz);
          for (let r = 0; r < 3; r++) {
            const rx = jx + (lRng() - 0.5) * 0.28;
            const rz = jz + (lRng() - 0.5) * 0.28;
            const rh = 0.65 + lRng() * 0.42;
            treeBuilder.addTaperedTube(rx, rgy - 0.05, rz, 0.022, rx + (lRng() - 0.5) * 0.14, rgy + rh, rz + (lRng() - 0.5) * 0.14, 0.008, 4, reedCol[0], reedCol[1], reedCol[2], MAT.FOLIAGE, 0.78, 0.55, r, false);
          }
        }
      }
    }

    treesDirty = false;
    return {
      verts: treeBuilder.subarrayView(),
      count: treeBuilder.vertCount
    };
  }

  function pSeed(i) { return (i * 1.37) % 10; }

  // ==========================================================================
  // LIVING CREATURES: FLUFFY SHEEP, POND DUCKS & SOARING BIRDS
  // ==========================================================================
  function initCreatures() {
    sheepList = [];
    duckList = [];
    birdList = [];

    const rng = M.mulberry32(88812);
    const spawnSpan = Math.min(34, TERRAIN.WORLD_SIZE * 0.42);
    const sheepTarget = Math.min(12, Math.max(7, Math.round(TERRAIN.WORLD_SIZE / 11)));

    for (let i = 0; i < sheepTarget; i++) {
      let sx = -6 + (rng() - 0.5) * 12;
      let sz = 4 + (rng() - 0.5) * 10;
      for (let tries = 0; tries < 30; tries++) {
        const tx = (rng() - 0.5) * spawnSpan;
        const tz = (rng() - 0.5) * spawnSpan;
        if (!TERRAIN.isWater(tx, tz, -0.08)) {
          sx = tx; sz = tz; break;
        }
      }
      sheepList.push(makeSheep(sx, sz, rng));
    }

    refreshPondDucks();

    const birdCount = Math.min(8, Math.max(5, Math.round(TERRAIN.WORLD_SIZE / 16)));
    for (let i = 0; i < birdCount; i++) {
      birdList.push({
        cx: (rng() - 0.5) * (TERRAIN.HALF_SIZE * 0.55),
        cz: (rng() - 0.5) * (TERRAIN.HALF_SIZE * 0.55),
        orbitR: 9 + rng() * 14,
        height: 10.0 + rng() * 6.0,
        angle: rng() * M.TAU,
        speed: (0.17 + rng() * 0.12) * (i % 2 === 0 ? 1 : -1),
        flapPhase: rng() * M.TAU
      });
    }
  }

  function makeSheep(x, z, rng = Math.random) {
    const r = typeof rng === 'function' ? rng : () => Math.random();
    return {
      x, z,
      yaw: r() * M.TAU,
      targetYaw: r() * M.TAU,
      state: 'graze',
      timer: 1.5 + r() * 3.5,
      walkPhase: r() * M.TAU,
      hopTime: 0,
      scale: 0.88 + r() * 0.24,
      woolTint: 0.94 + r() * 0.06
    };
  }

  function spawnSheepAt(x, z) {
    if (TERRAIN.isWater(x, z, 0.01)) return null;
    const s = makeSheep(x, z);
    s.hopTime = 0.65;
    sheepList.push(s);
    if (sheepList.length > 28) sheepList.shift();
    emitBurst(x, TERRAIN.getHeight(x, z) + 0.65, z, 'heart', 5);
    return s;
  }

  function refreshPondDucks() {
    const waterSpots = [];
    const bound = TERRAIN.HALF_SIZE - 5;
    const step = Math.max(2.2, TERRAIN.WORLD_SIZE / 32);
    for (let z = -bound; z <= bound; z += step) {
      for (let x = -bound; x <= bound; x += step) {
        if (TERRAIN.getWaterDepth(x, z) > 0.35) {
          waterSpots.push([x, z]);
        }
      }
    }
    if (waterSpots.length === 0) {
      duckList = [];
      return;
    }
    duckList = duckList.filter((d) => TERRAIN.getWaterDepth(d.x, d.z) > 0.08);
    while (duckList.length < Math.min(6, waterSpots.length)) {
      const sp = waterSpots[Math.floor(Math.random() * waterSpots.length)];
      duckList.push({
        x: sp[0],
        z: sp[1],
        yaw: Math.random() * M.TAU,
        targetYaw: Math.random() * M.TAU,
        timer: 1 + Math.random() * 3,
        bobPhase: Math.random() * M.TAU,
        quackHop: 0,
        isMallard: Math.random() < 0.45
      });
    }
  }

  function tryInteractCreature(ray) {
    let bestSheep = null;
    let bestDist = Infinity;
    for (const s of sheepList) {
      const sy = TERRAIN.getHeight(s.x, s.z) + 0.38;
      const hit = M.rayCylinder(ray, s.x, s.z, 0.68, sy - 0.45, sy + 0.55);
      if (hit && hit.t < bestDist) {
        bestDist = hit.t;
        bestSheep = s;
      }
    }
    if (bestSheep) {
      bestSheep.hopTime = 0.72;
      bestSheep.state = 'walk';
      bestSheep.timer = 2.0;
      const sy = TERRAIN.getHeight(bestSheep.x, bestSheep.z);
      emitBurst(bestSheep.x, sy + 0.85, bestSheep.z, 'heart', 7);
      AUDIO.playSheepBaa();
      return { kind: 'sheep', entity: bestSheep };
    }

    for (const d of duckList) {
      const hit = M.rayCylinder(ray, d.x, d.z, 0.55, TERRAIN.WATER_LEVEL - 0.15, TERRAIN.WATER_LEVEL + 0.55);
      if (hit) {
        d.quackHop = 0.55;
        d.targetYaw += (Math.random() - 0.5) * 2.2;
        emitBurst(d.x, TERRAIN.WATER_LEVEL + 0.45, d.z, 'heart', 5);
        AUDIO.playDuckQuack();
        return { kind: 'duck', entity: d };
      }
    }
    return null;
  }

  function emitBurst(x, y, z, kind = 'dust', count = 8) {
    for (let i = 0; i < count; i++) {
      if (particlePool.length >= MAX_PARTICLES) particlePool.shift();
      const ang = Math.random() * M.TAU;
      const spd = kind === 'heart' ? (0.35 + Math.random() * 0.55) : (0.7 + Math.random() * 1.4);
      particlePool.push({
        kind,
        x: x + (Math.random() - 0.5) * 0.35,
        y: y + Math.random() * 0.25,
        z: z + (Math.random() - 0.5) * 0.35,
        vx: Math.cos(ang) * spd,
        vy: kind === 'heart' ? (0.95 + Math.random() * 0.65) : (0.55 + Math.random() * 1.1),
        vz: Math.sin(ang) * spd,
        age: 0,
        life: kind === 'heart' ? (1.1 + Math.random() * 0.45) : (0.55 + Math.random() * 0.35),
        size: kind === 'heart' ? 0.24 : (0.28 + Math.random() * 0.24),
        seed: Math.random()
      });
    }
  }

  let smokeAccum = 0;
  let weatherAccum = 0;

  function updateAndBuildDynamic(dt, timeSec, seasonObj, isNight, buildings, walls, smokeSources, focusXZ = [0, 0]) {
    creatureBuilder.clear();
    const roamBound = TERRAIN.HALF_SIZE * 0.72;

    // --- 1. SHEEP AI & MESH ---
    for (let i = 0; i < sheepList.length; i++) {
      const s = sheepList[i];
      s.timer -= dt;
      if (s.hopTime > 0) s.hopTime = Math.max(0, s.hopTime - dt);

      if (TERRAIN.isWater(s.x, s.z, 0.02) && TERRAIN.getPath(s.x, s.z) < 0.45) {
        s.targetYaw += 2.4;
        s.x += Math.cos(s.targetYaw) * dt * 1.8;
        s.z += Math.sin(s.targetYaw) * dt * 1.8;
      }

      if (isNight && s.hopTime <= 0) {
        s.state = 'sleep';
      } else if (s.timer <= 0) {
        if (s.state === 'walk') {
          s.state = 'graze';
          s.timer = 2.2 + Math.random() * 4.0;
        } else {
          s.state = 'walk';
          s.timer = 2.0 + Math.random() * 3.5;
          s.targetYaw = s.yaw + (Math.random() - 0.5) * 2.4;
          if (Math.max(Math.abs(s.x), Math.abs(s.z)) > roamBound) {
            s.targetYaw = Math.atan2(-s.z, -s.x) + (Math.random() - 0.5) * 0.7;
          }
        }
      }

      if (s.state === 'walk') {
        s.yaw = M.lerpAngle(s.yaw, s.targetYaw, Math.min(1, dt * 3.2));
        const spd = 0.72;
        const nx = s.x + Math.cos(s.yaw) * spd * dt;
        const nz = s.z + Math.sin(s.yaw) * spd * dt;
        const canCrossWater = TERRAIN.getPath(nx, nz) > 0.42;
        const blocked = Math.abs(nx) > TERRAIN.HALF_SIZE - 2.5 || Math.abs(nz) > TERRAIN.HALF_SIZE - 2.5 ||
                        (!canCrossWater && TERRAIN.isWater(nx, nz, -0.04)) ||
                        isPointBlockedByStructure(nx, nz, buildings, [], 0.52);
        if (blocked) {
          s.targetYaw += 1.8 + Math.random();
        } else {
          s.x = nx;
          s.z = nz;
          s.walkPhase += dt * 8.5;
        }
      }

      const groundY = canStandOnBridge(s.x, s.z)
        ? TERRAIN.WATER_LEVEL + 0.14
        : Math.max(TERRAIN.WATER_LEVEL, TERRAIN.getHeight(s.x, s.z));
      const hopY = s.hopTime > 0 ? Math.abs(Math.sin(s.hopTime * 13.0)) * 0.36 : 0;
      const sleepSquish = s.state === 'sleep' ? -0.11 : 0;
      const sc = s.scale;
      const sy = groundY + hopY + sleepSquish;

      const wool = [s.woolTint, s.woolTint * 0.98, s.woolTint * 0.92];
      const dark = [0.22, 0.20, 0.20];
      const fx = Math.cos(s.yaw), fz = Math.sin(s.yaw);
      const rx = -fz, rz = fx;

      creatureBuilder.addPuff(s.x, sy + 0.34 * sc, s.z, 0.31 * sc, 0.24 * sc, 0.31 * sc, 5, 7, wool[0], wool[1], wool[2], MAT.WOOL, 0.95, 0, i, 0.10);
      creatureBuilder.addPuff(s.x - fx * 0.14 * sc, sy + 0.33 * sc, s.z - fz * 0.14 * sc, 0.25 * sc, 0.22 * sc, 0.25 * sc, 4, 6, wool[0], wool[1], wool[2], MAT.WOOL, 0.92, 0, i + 2, 0.08);
      creatureBuilder.addPuff(s.x - fx * 0.34 * sc, sy + 0.34 * sc, s.z - fz * 0.34 * sc, 0.09 * sc, 0.08 * sc, 0.09 * sc, 3, 5, wool[0], wool[1], wool[2], MAT.WOOL, 0.92, 0, 0, 0);

      const grazeDip = s.state === 'graze' ? -0.14 + Math.sin(timeSec * 5.5 + i) * 0.025 : (s.state === 'sleep' ? -0.10 : 0.05);
      const hx = s.x + fx * 0.32 * sc;
      const hy = sy + (0.38 + grazeDip) * sc;
      const hz = s.z + fz * 0.32 * sc;
      creatureBuilder.addPuff(hx, hy, hz, 0.13 * sc, 0.12 * sc, 0.13 * sc, 4, 6, dark[0], dark[1], dark[2], MAT.WOOL, 0.9, 0, 0, 0);
      creatureBuilder.addPuff(hx - fx * 0.02 * sc, hy + 0.09 * sc, hz - fz * 0.02 * sc, 0.10 * sc, 0.07 * sc, 0.10 * sc, 3, 5, wool[0], wool[1], wool[2], MAT.WOOL, 0.98, 0, 0, 0);
      for (const es of [-1, 1]) {
        creatureBuilder.addPuff(hx + rx * es * 0.13 * sc, hy + 0.02 * sc, hz + rz * es * 0.13 * sc, 0.06 * sc, 0.03 * sc, 0.06 * sc, 3, 4, dark[0], dark[1], dark[2], MAT.WOOL, 0.88, 0, 0, 0);
      }

      if (s.state !== 'sleep') {
        const legOffsets = [[0.14, 0.11, 0], [0.14, -0.11, Math.PI], [-0.15, 0.11, Math.PI], [-0.15, -0.11, 0]];
        for (const [lf, lr, ph] of legOffsets) {
          const swing = s.state === 'walk' ? Math.sin(s.walkPhase + ph) * 0.07 : 0;
          const lx = s.x + fx * (lf + swing) * sc + rx * lr * sc;
          const lz = s.z + fz * (lf + swing) * sc + rz * lr * sc;
          creatureBuilder.addTaperedTube(lx, sy, lz, 0.032 * sc, lx, sy + 0.24 * sc, lz, 0.042 * sc, 4, dark[0], dark[1], dark[2], MAT.WOOD, 0.65, 0.85, 0, false);
        }
      }
    }

    // --- 2. SWIMMING POND DUCKS ---
    for (let i = 0; i < duckList.length; i++) {
      const d = duckList[i];
      d.timer -= dt;
      if (d.quackHop > 0) d.quackHop = Math.max(0, d.quackHop - dt);
      if (d.timer <= 0) {
        d.timer = 2.0 + Math.random() * 3.5;
        d.targetYaw = d.yaw + (Math.random() - 0.5) * 2.2;
      }
      d.yaw = M.lerpAngle(d.yaw, d.targetYaw, Math.min(1, dt * 2.4));
      const spd = 0.48;
      const nx = d.x + Math.cos(d.yaw) * spd * dt;
      const nz = d.z + Math.sin(d.yaw) * spd * dt;
      if (TERRAIN.getWaterDepth(nx, nz) > 0.20) {
        d.x = nx;
        d.z = nz;
      } else {
        d.targetYaw += 2.1;
      }

      const wy = TERRAIN.WATER_LEVEL + 0.04 + Math.sin(timeSec * 3.4 + d.bobPhase) * 0.015 + (d.quackHop > 0 ? Math.abs(Math.sin(d.quackHop * 16)) * 0.14 : 0);
      const fx = Math.cos(d.yaw), fz = Math.sin(d.yaw);
      const bodyCol = d.isMallard ? [0.58, 0.53, 0.48] : [0.96, 0.95, 0.91];
      const headCol = d.isMallard ? [0.16, 0.46, 0.32] : [0.96, 0.95, 0.91];

      creatureBuilder.addPuff(d.x, wy + 0.06, d.z, 0.17, 0.11, 0.17, 4, 6, bodyCol[0], bodyCol[1], bodyCol[2], MAT.WOOL, 0.95, 0, i, 0);
      creatureBuilder.addPuff(d.x + fx * 0.14, wy + 0.18, d.z + fz * 0.14, 0.09, 0.09, 0.09, 4, 5, headCol[0], headCol[1], headCol[2], MAT.WOOL, 0.98, 0, 0, 0);
      creatureBuilder.addPuff(d.x + fx * 0.24, wy + 0.16, d.z + fz * 0.24, 0.055, 0.028, 0.055, 3, 4, 0.94, 0.56, 0.16, MAT.WOOD, 1.0, 0, 0, 0);
    }

    // --- 3. SOARING DAYTIME BIRDS ---
    if (!isNight) {
      for (let i = 0; i < birdList.length; i++) {
        const b = birdList[i];
        b.angle += b.speed * dt;
        const bx = b.cx + Math.cos(b.angle) * b.orbitR;
        const bz = b.cz + Math.sin(b.angle) * b.orbitR;
        const by = b.height + Math.sin(timeSec * 1.4 + i) * 0.55;
        const tangAng = b.angle + (b.speed > 0 ? M.HALF_PI : -M.HALF_PI);
        const rx = -Math.sin(tangAng), rz = Math.cos(tangAng);
        const fx = Math.cos(tangAng), fz = Math.sin(tangAng);
        const flap = Math.sin(timeSec * 9.5 + b.flapPhase) * 0.16;

        creatureBuilder.addTri(
          bx + fx * 0.14, by, bz + fz * 0.14,
          bx - fx * 0.14, by, bz - fz * 0.14,
          bx + rx * 0.34, by + flap, bz + rz * 0.34,
          0.92, 0.90, 0.86, MAT.WOOL, 1, 1, 1, 0
        );
        creatureBuilder.addTri(
          bx - fx * 0.14, by, bz - fz * 0.14,
          bx + fx * 0.14, by, bz + fz * 0.14,
          bx - rx * 0.34, by + flap, bz - rz * 0.34,
          0.92, 0.90, 0.86, MAT.WOOL, 1, 1, 1, 0
        );
      }
    }

    // --- 4. UPDATE CHIMNEY SMOKE & SEASONAL / FIREFLY PARTICLES ---
    smokeAccum += dt;
    if (smokeAccum > 0.22 && smokeSources && smokeSources.length > 0) {
      smokeAccum = 0;
      for (const src of smokeSources) {
        if (particlePool.length < MAX_PARTICLES) {
          particlePool.push({
            kind: 'smoke',
            x: src.x + (Math.random() - 0.5) * 0.12,
            y: src.y,
            z: src.z + (Math.random() - 0.5) * 0.12,
            vx: 0.22 + Math.random() * 0.15,
            vy: 0.52 + Math.random() * 0.24,
            vz: 0.08 + (Math.random() - 0.5) * 0.12,
            age: 0,
            life: 3.4 + Math.random() * 1.4,
            size: 0.22,
            seed: Math.random()
          });
        }
      }
    }

    weatherAccum += dt;
    const pMode = isNight ? 'fireflies' : seasonObj.particleMode;
    const spawnInterval = pMode === 'snow' || pMode === 'leaves' || pMode === 'petals' ? 0.05 : 0.13;
    if (weatherAccum >= spawnInterval && particlePool.length < MAX_PARTICLES - 12) {
      weatherAccum = 0;
      const rx = M.clamp(focusXZ[0] + (Math.random() - 0.5) * 44, -TERRAIN.HALF_SIZE, TERRAIN.HALF_SIZE);
      const rz = M.clamp(focusXZ[1] + (Math.random() - 0.5) * 44, -TERRAIN.HALF_SIZE, TERRAIN.HALF_SIZE);
      if (pMode === 'fireflies') {
        const gy = Math.max(TERRAIN.WATER_LEVEL, TERRAIN.getHeight(rx, rz));
        particlePool.push({
          kind: 'firefly',
          x: rx, y: gy + 0.35 + Math.random() * 1.8, z: rz,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.2,
          vz: (Math.random() - 0.5) * 0.35,
          age: 0,
          life: 3.5 + Math.random() * 3.0,
          size: 0.13 + Math.random() * 0.07,
          seed: Math.random()
        });
      } else if (pMode === 'snow') {
        particlePool.push({
          kind: 'snow',
          x: rx, y: 12.0 + Math.random() * 4.5, z: rz,
          vx: 0.28 + (Math.random() - 0.5) * 0.3,
          vy: -(0.95 + Math.random() * 0.55),
          vz: (Math.random() - 0.5) * 0.3,
          age: 0,
          life: 9.0,
          size: 0.09 + Math.random() * 0.06,
          seed: Math.random()
        });
      } else if (pMode === 'leaves' || pMode === 'petals') {
        particlePool.push({
          kind: pMode,
          x: rx, y: 9.5 + Math.random() * 4.0, z: rz,
          vx: 0.45 + Math.random() * 0.35,
          vy: -(0.68 + Math.random() * 0.42),
          vz: (Math.random() - 0.5) * 0.45,
          age: 0,
          life: 8.0,
          size: pMode === 'leaves' ? 0.14 : 0.10,
          seed: Math.random()
        });
      } else {
        const gy = Math.max(TERRAIN.WATER_LEVEL, TERRAIN.getHeight(rx, rz));
        particlePool.push({
          kind: 'mote',
          x: rx, y: gy + 0.5 + Math.random() * 2.2, z: rz,
          vx: 0.2 + (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.25,
          vz: (Math.random() - 0.5) * 0.4,
          age: 0,
          life: 4.0 + Math.random() * 2.5,
          size: 0.08 + Math.random() * 0.05,
          seed: Math.random()
        });
      }
    }

    activeParticleCount = 0;
    for (let i = particlePool.length - 1; i >= 0; i--) {
      const p = particlePool[i];
      p.age += dt;
      if (p.age >= p.life || p.y < TERRAIN.WATER_LEVEL - 0.3) {
        particlePool.splice(i, 1);
        continue;
      }
      const f = p.age / p.life;
      if (p.kind === 'smoke') {
        p.x += (p.vx + Math.sin(timeSec + p.seed * 6) * 0.12) * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      } else if (p.kind === 'firefly' || p.kind === 'mote') {
        p.x += (p.vx + Math.sin(timeSec * 1.9 + p.seed * 12) * 0.28) * dt;
        p.y += (p.vy + Math.cos(timeSec * 2.3 + p.seed * 9) * 0.20) * dt;
        p.z += (p.vz + Math.cos(timeSec * 1.7 + p.seed * 7) * 0.28) * dt;
      } else if (p.kind === 'dust') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vx *= 0.92; p.vz *= 0.92; p.vy *= 0.94;
      } else if (p.kind === 'heart') {
        p.x += p.vx * dt * 0.5;
        p.y += p.vy * dt;
        p.z += p.vz * dt * 0.5;
      } else {
        p.x += (p.vx + Math.sin(timeSec * 2.1 + p.seed * 10) * 0.45) * dt;
        p.y += p.vy * dt;
        p.z += (p.vz + Math.cos(timeSec * 1.8 + p.seed * 8) * 0.35) * dt;
      }

      if (activeParticleCount >= MAX_PARTICLES) continue;
      let r = 1, g = 1, b = 1, alpha = 1, sz = p.size;
      if (p.kind === 'smoke') {
        sz = p.size * (1 + f * 2.8);
        alpha = Math.sin(f * Math.PI) * 0.38;
        r = 0.90; g = 0.89; b = 0.88;
      } else if (p.kind === 'firefly') {
        const pulse = 0.55 + 0.45 * Math.sin(timeSec * 5.2 + p.seed * 20);
        alpha = Math.sin(f * Math.PI) * pulse;
        r = 1.8; g = 1.45; b = 0.42;
      } else if (p.kind === 'heart') {
        alpha = 1.0 - f * f;
        sz = p.size * (0.8 + Math.sin(f * Math.PI) * 0.45);
        r = 1.35; g = 0.45; b = 0.58;
      } else if (p.kind === 'dust') {
        sz = p.size * (1 + f * 1.6);
        alpha = (1 - f) * 0.52;
        r = 0.92; g = 0.88; b = 0.80;
      } else if (p.kind === 'snow') {
        alpha = Math.sin(Math.min(1, p.age * 0.8) * M.HALF_PI) * 0.85;
        r = 0.96; g = 0.98; b = 1.0;
      } else if (p.kind === 'leaves') {
        alpha = 0.92;
        if (p.seed < 0.5) { r = 0.88; g = 0.42; b = 0.18; }
        else { r = 0.92; g = 0.68; b = 0.20; }
      } else if (p.kind === 'petals') {
        alpha = 0.92;
        r = 0.98; g = 0.72; b = 0.82;
      } else {
        alpha = Math.sin(f * Math.PI) * 0.72;
        r = 1.25; g = 1.18; b = 0.78;
      }

      const o = activeParticleCount * 8;
      particleInstData[o] = p.x;
      particleInstData[o + 1] = p.y;
      particleInstData[o + 2] = p.z;
      particleInstData[o + 3] = sz;
      particleInstData[o + 4] = r;
      particleInstData[o + 5] = g;
      particleInstData[o + 6] = b;
      particleInstData[o + 7] = alpha;
      activeParticleCount++;
    }

    return {
      creatureVerts: creatureBuilder.subarrayView(),
      creatureCount: creatureBuilder.vertCount,
      particleData: particleInstData.subarray(0, activeParticleCount * 8),
      particleCount: activeParticleCount
    };
  }

  function canStandOnBridge(x, z) {
    return TERRAIN.isWater(x, z, 0.02) && TERRAIN.getPath(x, z) > 0.42;
  }

  function getSheepPositionsFlat(maxCount = 8) {
    const out = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) {
      if (i < sheepList.length) {
        out[i * 4] = sheepList[i].x;
        out[i * 4 + 1] = sheepList[i].z;
        out[i * 4 + 2] = 0.65;
        out[i * 4 + 3] = 1.0;
      }
    }
    return out;
  }

  function getDuckPositionsFlat(maxCount = 6) {
    const out = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) {
      if (i < duckList.length) {
        out[i * 4] = duckList[i].x;
        out[i * 4 + 1] = duckList[i].z;
        out[i * 4 + 2] = 1.0;
        out[i * 4 + 3] = 0.0;
      }
    }
    return out;
  }

  function serializeTrees() {
    return trees.map((t) => ({
      id: t.id, x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100,
      scale: Math.round(t.scale * 100) / 100, seed: Math.round(t.seed * 10000) / 10000,
      style: t.style, userPlaced: !!t.userPlaced
    }));
  }

  function deserializeTrees(arr) {
    if (!Array.isArray(arr)) return;
    trees = arr.map((t, idx) => ({
      id: t.id || (idx + 1),
      x: t.x, z: t.z,
      scale: t.scale || 1.0,
      seed: t.seed ?? 0.5,
      style: t.style || 'oak',
      userPlaced: !!t.userPlaced
    }));
    nextTreeId = trees.reduce((m, t) => Math.max(m, t.id), 0) + 1;
    treesDirty = true;
  }

  return {
    GRASS_COUNT,
    FLOWER_COUNT,
    MAX_PARTICLES,
    createGrassBladeMesh,
    createFlowerMesh,
    createGrassInstances,
    createFlowerInstances,
    resetTrees,
    populateExpandedRing,
    addTree,
    removeTreesInRadius,
    buildNatureMesh,
    initCreatures,
    spawnSheepAt,
    refreshPondDucks,
    tryInteractCreature,
    emitBurst,
    updateAndBuildDynamic,
    canStandOnBridge,
    getSheepPositionsFlat,
    getDuckPositionsFlat,
    serializeTrees,
    deserializeTrees,
    isTreesDirty: () => treesDirty,
    markTreesDirty: () => { treesDirty = true; },
    getSheepCount: () => sheepList.length
  };
})();
