// ============================================================================
// game.js — Tiny Glade v2 Core Gameplay, Map Workshop, Stroll Mode,
//           Elastic Spring Physics, Unified Gizmos & Emergent World Feedback
// ============================================================================

const GAME = (() => {
  let buildings = [];
  let walls = [];
  let stamps = [];
  let nextId = 1;

  // Active atmosphere & lens settings
  let seasonId = 'summer';
  let timeOfDay = 16.3; // 0..24
  let sunAzimuth = 0.72;
  let autoCycleTime = false;
  let dofAmount = 0.26;
  let savedOrbitalDof = 0.26;
  let photoMode = false;
  let hudHidden = false;

  // Villager First-Person Stroll Mode ('G')
  let strollMode = false;
  const stroll = {
    x: 0,
    y: 1.8,
    z: 6,
    yaw: 0,
    pitch: -0.04,
    bobPhase: 0,
    savedCam: null
  };

  // Tool & Brush state
  let activeTool = 'rect';
  let brushScale = 1.0; // 0.45 .. 2.25
  let subTool = {
    wall: 'stone',       // 'stone' | 'tall_stone' | 'fence'
    path: 'wide',        // 'narrow' | 'wide' | 'erase'
    stamp: 'window',     // 'window' | 'dormer' | 'chimney' | 'flag' | 'lantern_post' | 'ivy' | 'well' | 'bench' | 'cart'
    terrain: 'water',    // 'water' | 'raise' | 'lower' | 'plateau'
    nature: 'tree'       // 'tree' | 'flower' | 'sheep' | 'clear_nature'
  };
  let activeRoofId = 'terracotta';
  let activeWallId = 'cream_timber';

  // Unified entity selection: { kind: 'building' | 'wall' | 'stamp', id } | null
  let selection = null;
  let hoveredEntity = null;

  // Undo / Redo history stack
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 28;

  // Orbital Camera state
  const camera = {
    yaw: 0.78,
    pitch: 0.52,
    dist: 24.0,
    target: [0, 1.4, 0],
    desiredYaw: 0.78,
    desiredPitch: 0.52,
    desiredDist: 24.0,
    desiredTarget: [0, 1.4, 0],
    fov: 43,
    desiredFov: 43,
    eye: [14, 13, 14]
  };

  // Pointer & active drag action
  const pointer = {
    x: 0, y: 0,
    down: false,
    overUi: false,
    button: 0,
    startX: 0, startY: 0,
    movedDist: 0,
    worldHit: null,
    ray: null
  };

  let dragAction = null;
  const keyState = {};

  // Elastic spring animations, click ripples & emergent floating world badges
  const activeSprings = []; // { entity, kind: 'building'|'wall'|'stamp' }
  const clickRipple = { x: 0, z: 0, age: 1.0, active: false };
  const worldBadges = [];   // { wx, wy, wz, text, age, life }
  let activePreviewMode = 0; // 0: off, 1: active solid preview, 2: ghost blueprint

  // Cached scene emitters & emergent feature trackers
  let pointLights = [];
  let smokeSources = [];
  let knownArches = [];
  let knownBridges = [];
  let knownDoors = [];
  let suppressEmergentBadges = false;

  let dirtyBuildingsAll = true;
  let dirtyWalls = true;
  let dirtyStamps = true;
  let timeSec = 0;
  let lastFrameMs = 0;
  let currentThemeIndex = 0;

  function getMaxCamDist() {
    return Math.max(54.0, TERRAIN.WORLD_SIZE * 0.76);
  }

  function getPlayablePanBound() {
    return Math.max(12.0, TERRAIN.HALF_SIZE - 3.0);
  }

  function clampToPlayable(val, margin = 2.2) {
    const lim = Math.max(4.0, TERRAIN.HALF_SIZE - margin);
    return M.clamp(val, -lim, lim);
  }

  // ==========================================================================
  // ELASTIC SPRING PHYSICS & WORLD FEEDBACK BADGES
  // ==========================================================================
  function triggerSpring(entity, kind, impulse = -0.22) {
    if (!entity) return;
    entity._springScaleY = 1.0 + impulse;
    entity._springVel = 0.0;
    if (!activeSprings.some((s) => s.entity === entity)) {
      activeSprings.push({ entity, kind });
    }
  }

  function triggerClickRipple(wx, wz) {
    clickRipple.x = wx;
    clickRipple.z = wz;
    clickRipple.age = 0.0;
    clickRipple.active = true;
  }

  function spawnWorldBadge(wx, wy, wz, text) {
    if (suppressEmergentBadges || photoMode) return;
    // Deduplicate nearby identical badges
    for (let i = 0; i < worldBadges.length; i++) {
      const b = worldBadges[i];
      if (b.text === text && M.distSq2D(wx, wz, b.wx, b.wz) < 9.0 && b.age < 1.1) {
        return;
      }
    }
    worldBadges.push({ wx, wy, wz, text, age: 0, life: 2.35 });
    if (worldBadges.length > 8) worldBadges.shift();
  }

  function updateSpringsAndFeedback(dt) {
    if (clickRipple.active) {
      clickRipple.age += dt * 1.85;
      if (clickRipple.age >= 1.0) {
        clickRipple.active = false;
      }
    }

    for (let i = worldBadges.length - 1; i >= 0; i--) {
      const wb = worldBadges[i];
      wb.age += dt;
      wb.wy += dt * 0.52;
      if (wb.age >= wb.life) {
        worldBadges.splice(i, 1);
      }
    }

    if (activeSprings.length === 0) return;

    let needBuildingUpload = false;
    let needWallRebuild = false;
    let needStampRebuild = false;

    const stiffness = 215.0;
    const damping = 14.2;

    for (let i = activeSprings.length - 1; i >= 0; i--) {
      const item = activeSprings[i];
      const ent = item.entity;
      const disp = (ent._springScaleY ?? 1.0) - 1.0;
      const accel = -stiffness * disp - damping * (ent._springVel || 0);
      ent._springVel = (ent._springVel || 0) + accel * dt;
      ent._springScaleY = (ent._springScaleY ?? 1.0) + ent._springVel * dt;

      if (Math.abs(ent._springScaleY - 1.0) < 0.0025 && Math.abs(ent._springVel) < 0.015) {
        ent._springScaleY = 1.0;
        ent._springVel = 0.0;
        activeSprings.splice(i, 1);
      }

      if (item.kind === 'building') {
        if (buildings.includes(ent)) {
          rebuildSingleBuilding(ent);
          needBuildingUpload = true;
        } else {
          activeSprings.splice(i, 1);
        }
      } else if (item.kind === 'wall') {
        if (walls.includes(ent)) needWallRebuild = true;
        else activeSprings.splice(i, 1);
      } else if (item.kind === 'stamp') {
        if (stamps.includes(ent)) needStampRebuild = true;
        else activeSprings.splice(i, 1);
      }
    }

    if (needBuildingUpload) uploadCombinedBuildings();
    if (needWallRebuild) {
      const wArr = PROCGEN.buildWallsAndBridges(walls, null);
      RENDERER.uploadSolidSlot('walls', wArr, (wArr.length / GEO.STRIDE) | 0);
    }
    if (needStampRebuild) {
      const stLights = [];
      smokeSources = [];
      const sArr = PROCGEN.buildStamps(stamps, stLights, smokeSources);
      stamps._cachedLights = stLights;
      RENDERER.uploadSolidSlot('stamps', sArr, (sArr.length / GEO.STRIDE) | 0);
      refreshSceneEmitters();
    }
  }

  // ==========================================================================
  // ORBITAL & FIRST-PERSON VILLAGER STROLL CAMERA
  // ==========================================================================
  function isWalkBlocked(wx, wz) {
    if (Math.abs(wx) > TERRAIN.HALF_SIZE - 1.5 || Math.abs(wz) > TERRAIN.HALF_SIZE - 1.5) return true;
    if (TERRAIN.isWater(wx, wz, 0.05) && !NATURE.canStandOnBridge(wx, wz)) return true;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if ((b.baseLift || 0) > 1.35) continue; // can walk right under raised stone arches!
      if (b.type === 'tower') {
        if (M.dist2D(wx, wz, b.x, b.z) < b.r + 0.35) return true;
      } else {
        const c = Math.cos(-(b.yaw || 0)), s = Math.sin(-(b.yaw || 0));
        const lx = (wx - b.x) * c - (wz - b.z) * s;
        const lz = (wx - b.x) * s + (wz - b.z) * c;
        if (Math.abs(lx) < b.w * 0.5 + 0.32 && Math.abs(lz) < b.d * 0.5 + 0.32) return true;
      }
    }
    return false;
  }

  function updateStrollCamera(dt) {
    if (keyState['KeyQ']) stroll.yaw += 1.6 * dt;
    if (keyState['KeyE']) stroll.yaw -= 1.6 * dt;

    const fwdX = -Math.sin(stroll.yaw);
    const fwdZ = -Math.cos(stroll.yaw);
    const rightX = Math.cos(stroll.yaw);
    const rightZ = -Math.sin(stroll.yaw);

    let moveX = 0, moveZ = 0;
    if (keyState['KeyW'] || keyState['ArrowUp']) { moveX += fwdX; moveZ += fwdZ; }
    if (keyState['KeyS'] || keyState['ArrowDown']) { moveX -= fwdX; moveZ -= fwdZ; }
    if (keyState['KeyD'] || keyState['ArrowRight']) { moveX += rightX; moveZ += rightZ; }
    if (keyState['KeyA'] || keyState['ArrowLeft']) { moveX -= rightX; moveZ -= rightZ; }

    const mLen = Math.hypot(moveX, moveZ);
    const sprint = keyState['ShiftLeft'] || keyState['ShiftRight'];
    const walkSpeed = sprint ? 6.4 : 3.7;

    if (mLen > 0.01) {
      moveX = (moveX / mLen) * walkSpeed * dt;
      moveZ = (moveZ / mLen) * walkSpeed * dt;
      const nx = stroll.x + moveX;
      const nz = stroll.z + moveZ;
      if (!isWalkBlocked(nx, nz)) {
        stroll.x = nx;
        stroll.z = nz;
      } else if (!isWalkBlocked(nx, stroll.z)) {
        stroll.x = nx;
      } else if (!isWalkBlocked(stroll.x, nz)) {
        stroll.z = nz;
      }

      stroll.bobPhase += dt * (sprint ? 13.5 : 9.2);
      const onBridge = NATURE.canStandOnBridge(stroll.x, stroll.z);
      const onPath = TERRAIN.getPath(stroll.x, stroll.z) > 0.35;
      AUDIO.playFootstep(onBridge ? 'wood' : onPath ? 'stone' : 'grass');
    } else {
      stroll.bobPhase = M.lerp(stroll.bobPhase, Math.round(stroll.bobPhase / Math.PI) * Math.PI, Math.min(1, dt * 8));
    }

    const onBridge = NATURE.canStandOnBridge(stroll.x, stroll.z);
    const groundY = onBridge
      ? TERRAIN.WATER_LEVEL + 0.16
      : Math.max(TERRAIN.WATER_LEVEL, TERRAIN.getHeight(stroll.x, stroll.z));
    const eyeTargetY = groundY + 1.62 + (mLen > 0.01 ? Math.sin(stroll.bobPhase) * 0.042 : 0);
    stroll.y = M.lerp(stroll.y, eyeTargetY, Math.min(1, dt * 14.0));

    camera.fov = M.lerp(camera.fov, camera.desiredFov, 1.0 - Math.exp(-dt * 10.0));
    camera.dist = 8.5; // keeps shadow frustum ultra-sharp around villager!
    camera.eye[0] = stroll.x;
    camera.eye[1] = stroll.y;
    camera.eye[2] = stroll.z;

    const cp = Math.cos(stroll.pitch);
    const lookDist = 8.0;
    camera.target[0] = stroll.x - Math.sin(stroll.yaw) * cp * lookDist;
    camera.target[1] = stroll.y + Math.sin(stroll.pitch) * lookDist;
    camera.target[2] = stroll.z - Math.cos(stroll.yaw) * cp * lookDist;
  }

  function updateCameraVectors(dt) {
    if (strollMode) {
      updateStrollCamera(dt);
      return;
    }

    const maxDist = getMaxCamDist();
    const panBound = getPlayablePanBound();

    const panSpeed = (camera.desiredDist * 0.55) * dt;
    const fwdX = -Math.sin(camera.desiredYaw);
    const fwdZ = -Math.cos(camera.desiredYaw);
    const rightX = Math.cos(camera.desiredYaw);
    const rightZ = -Math.sin(camera.desiredYaw);

    if (keyState['KeyW'] || keyState['ArrowUp']) {
      camera.desiredTarget[0] += fwdX * panSpeed;
      camera.desiredTarget[2] += fwdZ * panSpeed;
    }
    if (keyState['KeyS'] || keyState['ArrowDown']) {
      camera.desiredTarget[0] -= fwdX * panSpeed;
      camera.desiredTarget[2] -= fwdZ * panSpeed;
    }
    if (keyState['KeyD'] || keyState['ArrowRight']) {
      camera.desiredTarget[0] += rightX * panSpeed;
      camera.desiredTarget[2] += rightZ * panSpeed;
    }
    if (keyState['KeyA'] || keyState['ArrowLeft']) {
      camera.desiredTarget[0] -= rightX * panSpeed;
      camera.desiredTarget[2] -= rightZ * panSpeed;
    }
    if (keyState['KeyQ']) camera.desiredYaw -= 1.35 * dt;
    if (keyState['KeyE']) camera.desiredYaw += 1.35 * dt;
    if (keyState['KeyR']) camera.desiredDist = Math.max(4.2, camera.desiredDist - 16 * dt);
    if (keyState['KeyF']) camera.desiredDist = Math.min(maxDist, camera.desiredDist + 16 * dt);

    camera.desiredPitch = M.clamp(camera.desiredPitch, 0.10, 1.38);
    camera.desiredDist = M.clamp(camera.desiredDist, 4.2, maxDist);
    camera.desiredTarget[0] = M.clamp(camera.desiredTarget[0], -panBound, panBound);
    camera.desiredTarget[2] = M.clamp(camera.desiredTarget[2], -panBound, panBound);
    const groundAtTarget = Math.max(TERRAIN.WATER_LEVEL, TERRAIN.getHeight(camera.desiredTarget[0], camera.desiredTarget[2]));
    camera.desiredTarget[1] = M.lerp(camera.desiredTarget[1], groundAtTarget + 1.25, Math.min(1, dt * 6));

    const smooth = 1.0 - Math.exp(-dt * 13.0);
    camera.yaw = M.lerp(camera.yaw, camera.desiredYaw, smooth);
    camera.pitch = M.lerp(camera.pitch, camera.desiredPitch, smooth);
    camera.dist = M.lerp(camera.dist, camera.desiredDist, smooth);
    camera.fov = M.lerp(camera.fov, camera.desiredFov, smooth);
    for (let k = 0; k < 3; k++) {
      camera.target[k] = M.lerp(camera.target[k], camera.desiredTarget[k], smooth);
    }

    const cp = Math.cos(camera.pitch);
    camera.eye[0] = camera.target[0] + Math.sin(camera.yaw) * cp * camera.dist;
    camera.eye[1] = camera.target[1] + Math.sin(camera.pitch) * camera.dist;
    camera.eye[2] = camera.target[2] + Math.cos(camera.yaw) * cp * camera.dist;
    const minEyeY = Math.max(TERRAIN.WATER_LEVEL + 0.35, TERRAIN.getHeight(camera.eye[0], camera.eye[2]) + 0.45);
    if (camera.eye[1] < minEyeY) camera.eye[1] = minEyeY;
  }

  function setStrollMode(flag) {
    const next = !!flag;
    if (next === strollMode) return;
    strollMode = next;

    if (strollMode) {
      if (photoMode) photoMode = false;
      clearSelection();
      stroll.savedCam = {
        yaw: camera.desiredYaw,
        pitch: camera.desiredPitch,
        dist: camera.desiredDist,
        target: [...camera.desiredTarget],
        fov: camera.desiredFov
      };
      savedOrbitalDof = dofAmount;
      dofAmount = 0.04;
      camera.desiredFov = 56;

      // Pick a walkable villager spawn near current camera target!
      let sx = camera.target[0];
      let sz = camera.target[2] + 4.5;
      for (let r = 0; r <= 18; r += 1.6) {
        let found = false;
        for (let a = 0; a < 12; a++) {
          const ang = camera.yaw + (a / 12) * M.TAU;
          const tx = M.clamp(camera.target[0] + Math.sin(ang) * r, -TERRAIN.HALF_SIZE + 3, TERRAIN.HALF_SIZE - 3);
          const tz = M.clamp(camera.target[2] + Math.cos(ang) * r, -TERRAIN.HALF_SIZE + 3, TERRAIN.HALF_SIZE - 3);
          if (!isWalkBlocked(tx, tz)) {
            sx = tx; sz = tz; found = true; break;
          }
        }
        if (found) break;
      }
      stroll.x = sx;
      stroll.z = sz;
      stroll.y = Math.max(TERRAIN.WATER_LEVEL, TERRAIN.getHeight(sx, sz)) + 1.62;
      stroll.yaw = Math.atan2(sx - camera.target[0], sz - camera.target[2]);
      stroll.pitch = -0.02;
      AUDIO.playSpringPop(1.1);
    } else {
      if (stroll.savedCam) {
        camera.desiredYaw = stroll.savedCam.yaw;
        camera.desiredPitch = stroll.savedCam.pitch;
        camera.desiredDist = stroll.savedCam.dist;
        camera.desiredTarget = [
          clampToPlayable(stroll.x, 4),
          stroll.savedCam.target[1],
          clampToPlayable(stroll.z, 4)
        ];
        camera.desiredFov = stroll.savedCam.fov;
      } else {
        camera.desiredFov = 43;
      }
      dofAmount = savedOrbitalDof;
      AUDIO.playUiClick(true);
    }

    if (typeof UI !== 'undefined') {
      UI.syncStrollMode();
      UI.syncPhotoMode();
    }
  }

  // ==========================================================================
  // UNDO / REDO SNAPSHOTS (INCLUDING MAP EXPANSION!)
  // ==========================================================================
  function cloneStateSnapshot() {
    return {
      buildings: buildings.map((b) => ({
        id: b.id, type: b.type, x: b.x, z: b.z,
        w: b.w, d: b.d, r: b.r, yaw: b.yaw,
        wallH: b.wallH, roofH: b.roofH, baseLift: b.baseLift,
        roofId: b.roofId, wallId: b.wallId
      })),
      walls: walls.map((w) => ({
        id: w.id, kind: w.kind, height: w.height,
        pts: w.pts.map((p) => ({ x: p.x, z: p.z }))
      })),
      stamps: stamps.map((s) => ({
        id: s.id, kind: s.kind, x: s.x, y: s.y, z: s.z,
        yaw: s.yaw, onStructure: s.onStructure, color: s.color, roofId: s.roofId
      })),
      terrain: TERRAIN.cloneArrays(),
      trees: NATURE.serializeTrees()
    };
  }

  function pushUndo() {
    undoStack.push(cloneStateSnapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    if (typeof UI !== 'undefined') UI.updateHistoryButtons();
  }

  function applySnapshot(snap) {
    const prevWorldSize = TERRAIN.WORLD_SIZE;
    buildings = snap.buildings.map((b) => ({ ...b, _mesh: null, _lights: null }));
    walls = snap.walls.map((w) => ({
      id: w.id, kind: w.kind, height: w.height,
      pts: w.pts.map((p) => ({ x: p.x, z: p.z }))
    }));
    stamps = snap.stamps.map((s) => ({ ...s }));
    TERRAIN.restoreArrays(snap.terrain);
    NATURE.deserializeTrees(snap.trees);

    if (Math.abs(TERRAIN.WORLD_SIZE - prevWorldSize) > 0.5) {
      RENDERER.rebuildInstancedNature();
    }

    clearSelection();
    suppressEmergentBadges = true;
    markEverythingDirty();
    syncDirtyGeometry();
    suppressEmergentBadges = false;
    if (typeof UI !== 'undefined') {
      UI.refreshStats();
      UI.syncMapBadges();
    }
  }

  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(cloneStateSnapshot());
    const snap = undoStack.pop();
    applySnapshot(snap);
    AUDIO.playUiClick(false);
    if (typeof UI !== 'undefined') UI.updateHistoryButtons();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(cloneStateSnapshot());
    const snap = redoStack.pop();
    applySnapshot(snap);
    AUDIO.playUiClick(true);
    if (typeof UI !== 'undefined') UI.updateHistoryButtons();
    return true;
  }

  function markEverythingDirty() {
    dirtyBuildingsAll = true;
    dirtyWalls = true;
    dirtyStamps = true;
    TERRAIN.markDirtyMesh();
    NATURE.markTreesDirty();
  }

  // ==========================================================================
  // PROCEDURAL SCENE SYNCHRONIZATION & EMERGENT DISCOVERY DETECTION
  // ==========================================================================
  function rebuildSingleBuilding(b) {
    const bLights = [];
    b._mesh = b.type === 'tower'
      ? PROCGEN.buildTowerBuilding(b, bLights)
      : PROCGEN.buildRectBuilding(b, bLights);
    b._lights = bLights;
  }

  function uploadCombinedBuildings() {
    let totalFloats = 0;
    const allDoorsNow = [];

    for (let i = 0; i < buildings.length; i++) {
      if (!buildings[i]._mesh || dirtyBuildingsAll) {
        rebuildSingleBuilding(buildings[i]);
      }
      totalFloats += buildings[i]._mesh.length;
      if (buildings[i]._doors) {
        for (const d of buildings[i]._doors) allDoorsNow.push(d);
      }
    }
    dirtyBuildingsAll = false;

    // Detect newly emerged arched cottage doors!
    if (!suppressEmergentBadges) {
      for (const nd of allDoorsNow) {
        const existed = knownDoors.some((od) => M.distSq2D(nd.x, nd.z, od.x, od.z) < 2.25);
        if (!existed) {
          spawnWorldBadge(nd.x, nd.y + 0.45, nd.z, '🚪 自动生成拱门石阶');
          AUDIO.playArchChime();
          NATURE.emitBurst(nd.x, nd.y - 0.3, nd.z, 'dust', 6);
        }
      }
    }
    knownDoors = allDoorsNow;

    const combined = new Float32Array(totalFloats);
    let offset = 0;
    for (let i = 0; i < buildings.length; i++) {
      const m = buildings[i]._mesh;
      combined.set(m, offset);
      offset += m.length;
    }
    RENDERER.uploadSolidSlot('buildings', combined, (totalFloats / GEO.STRIDE) | 0);
    refreshSceneEmitters();
  }

  function refreshSceneEmitters() {
    pointLights = [];
    for (let i = 0; i < buildings.length; i++) {
      if (buildings[i]._lights) {
        for (const l of buildings[i]._lights) pointLights.push(l);
      }
    }
    if (stamps._cachedLights) {
      for (const l of stamps._cachedLights) pointLights.push(l);
    }
    pointLights.sort((a, b) => (a.kind === 'lantern' ? -1 : 1) - (b.kind === 'lantern' ? -1 : 1));
  }

  function syncDirtyGeometry() {
    const seasonObj = PALETTES.SEASONS[seasonId] || PALETTES.SEASONS.summer;
    let suppressionNeedsUpdate = false;

    if (dirtyWalls) {
      const meta = { arches: [], bridges: [] };
      const wArr = PROCGEN.buildWallsAndBridges(walls, meta);
      RENDERER.uploadSolidSlot('walls', wArr, (wArr.length / GEO.STRIDE) | 0);
      dirtyWalls = false;
      suppressionNeedsUpdate = true;

      if (!suppressEmergentBadges) {
        for (const na of meta.arches) {
          const existed = knownArches.some((oa) => M.distSq2D(na.x, na.z, oa.x, oa.z) < 3.2);
          if (!existed) {
            spawnWorldBadge(
              na.x, na.y, na.z,
              na.kind === 'gate' ? '🚪 花园木门已敞开' : '✨ 石拱门已贯通'
            );
            AUDIO.playArchChime();
            NATURE.emitBurst(na.x, na.y - 0.5, na.z, 'dust', 8);
          }
        }
        for (const nb of meta.bridges) {
          const existed = knownBridges.some((ob) => M.distSq2D(nb.x, nb.z, ob.x, ob.z) < 22.0);
          if (!existed) {
            spawnWorldBadge(nb.x, nb.y, nb.z, '🌉 木板小桥已架起');
            AUDIO.playArchChime();
            NATURE.emitBurst(nb.x, nb.y - 0.5, nb.z, 'dust', 7);
          }
        }
      }
      const prevArchCount = knownArches.length;
      const prevBridgeCount = knownBridges.length;
      knownArches = meta.arches;
      knownBridges = meta.bridges;
      if ((knownArches.length !== prevArchCount || knownBridges.length !== prevBridgeCount) && typeof UI !== 'undefined') {
        UI.refreshStats();
      }
    }

    if (dirtyBuildingsAll) {
      uploadCombinedBuildings();
      suppressionNeedsUpdate = true;
    }

    if (dirtyStamps) {
      const stLights = [];
      smokeSources = [];
      const sArr = PROCGEN.buildStamps(stamps, stLights, smokeSources);
      stamps._cachedLights = stLights;
      RENDERER.uploadSolidSlot('stamps', sArr, (sArr.length / GEO.STRIDE) | 0);
      dirtyStamps = false;
      refreshSceneEmitters();
    }

    if (suppressionNeedsUpdate) {
      TERRAIN.updateBuildingSuppression(buildings, walls);
      TERRAIN.markDirtyMesh();
      NATURE.markTreesDirty();
    }

    if (TERRAIN.isDirtyMesh()) {
      const tm = TERRAIN.buildMeshes(seasonObj);
      RENDERER.uploadSolidSlot('terrain', tm.terrainVerts, tm.terrainCount);
      RENDERER.uploadSolidSlot('water', tm.waterVerts, tm.waterCount);
      RENDERER.uploadSolidSlot('vista', tm.vistaVerts, tm.vistaCount);
    }

    if (TERRAIN.isDirtyGpuMap()) {
      RENDERER.updateTerrainGpuMap(TERRAIN.getGpuMapData());
    }

    if (NATURE.isTreesDirty()) {
      const nm = NATURE.buildNatureMesh(seasonObj, buildings, walls);
      RENDERER.uploadSolidSlot('nature', nm.verts, nm.count);
    }
  }

  // ==========================================================================
  // RAYCASTING AGAINST BUILDINGS, STAMPS & WALLS
  // ==========================================================================
  function raycastBuildings(ray) {
    let best = null;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const floorY = b._computedFloorY ?? TERRAIN.getLandHeight(b.x, b.z);
      const topY = floorY + b.wallH + Math.max(0.25, b.roofH * 0.85);

      let hit = null;
      if (b.type === 'tower') {
        hit = M.rayCylinder(ray, b.x, b.z, b.r + 0.08, floorY - 0.4, topY);
      } else {
        hit = M.rayOBB(ray, b.x, b.z, b.yaw || 0, b.w * 0.5 + 0.08, b.d * 0.5 + 0.08, floorY - 0.4, topY);
      }
      if (hit && (!best || hit.t < best.t)) {
        const roofZone = hit.y >= floorY + b.wallH - 0.14;
        best = { building: b, t: hit.t, x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, roofZone, floorY };
      }
    }
    return best;
  }

  function raycastStamps(ray) {
    let best = null;
    for (let i = 0; i < stamps.length; i++) {
      const st = stamps[i];
      const baseY = st._computedY ?? (st.onStructure ? (st.y || 1) : TERRAIN.getLandHeight(st.x, st.z));
      const rad = (st.kind === 'well' || st.kind === 'cart' || st.kind === 'bench') ? 0.78 : 0.55;
      const hSpan = st.kind === 'lantern_post' && !st.onStructure ? 2.2 : 1.5;
      const hit = M.rayCylinder(ray, st.x, st.z, rad, baseY - 0.35, baseY + hSpan);
      if (hit && (!best || hit.t < best.t)) {
        best = { stamp: st, t: hit.t, x: hit.x, y: hit.y, z: hit.z };
      }
    }
    return best;
  }

  function findWallNear(wx, wz, maxDist = 1.15) {
    let best = null;
    let bestD = maxDist;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const pts = w.samples || w.pts;
      if (!pts) continue;
      for (let s = 0; s < pts.length - 1; s++) {
        const cp = M.closestOnSegment2D(wx, wz, pts[s].x, pts[s].z, pts[s + 1].x, pts[s + 1].z);
        if (cp.dist < bestD) {
          bestD = cp.dist;
          best = w;
        }
      }
    }
    return best;
  }

  function findStampNear(wx, wz, maxDist = 1.15) {
    let best = null;
    let bestD = maxDist;
    for (let i = 0; i < stamps.length; i++) {
      const d = M.dist2D(wx, wz, stamps[i].x, stamps[i].z);
      if (d < bestD) {
        bestD = d;
        best = stamps[i];
      }
    }
    return best;
  }

  function pickEntityAt(ray, groundHit) {
    const sHit = raycastStamps(ray);
    const bHit = raycastBuildings(ray);

    if (sHit && (!bHit || sHit.t <= bHit.t + 0.35)) {
      return { kind: 'stamp', entity: sHit.stamp, hit: sHit };
    }
    if (bHit) {
      return { kind: 'building', entity: bHit.building, hit: bHit };
    }
    if (groundHit) {
      const w = findWallNear(groundHit.x, groundHit.z, 1.1);
      if (w) return { kind: 'wall', entity: w, hit: groundHit };
    }
    return null;
  }

  // ==========================================================================
  // LIVE PREVIEW MESH (PRE-DRAG GHOST BLUEPRINT + ACTIVE SOLID PREVIEW)
  // ==========================================================================
  function updateLivePreview() {
    activePreviewMode = 0;
    if (photoMode || strollMode || pointer.overUi) {
      RENDERER.uploadSolidSlot('preview', null, 0);
      return;
    }

    if (dragAction && (dragAction.kind === 'create_rect' || dragAction.kind === 'create_tower')) {
      const previewB = dragAction.tempBuilding;
      const arr = previewB.type === 'tower'
        ? PROCGEN.buildTowerBuilding(previewB, null)
        : PROCGEN.buildRectBuilding(previewB, null);
      activePreviewMode = 1;
      RENDERER.uploadSolidSlot('preview', arr, (arr.length / GEO.STRIDE) | 0);
      return;
    }

    if (dragAction && dragAction.kind === 'draw_wall' && dragAction.tempWall.pts.length >= 2) {
      const arr = PROCGEN.buildWallsAndBridges([dragAction.tempWall], null);
      activePreviewMode = 1;
      RENDERER.uploadSolidSlot('preview', arr, (arr.length / GEO.STRIDE) | 0);
      return;
    }

    if (activeTool === 'stamp' && pointer.ray && !pointer.down) {
      const placement = computeStampPlacement(pointer.ray);
      if (placement) {
        const arr = PROCGEN.buildStamps([placement], null, null);
        activePreviewMode = 1;
        RENDERER.uploadSolidSlot('preview', arr, (arr.length / GEO.STRIDE) | 0);
        return;
      }
    }

    // Pre-Drag Ghost Blueprint Preview for Cottage ('rect') & Tower ('tower')!
    if ((activeTool === 'rect' || activeTool === 'tower') && !pointer.down && pointer.worldHit && pointer.ray) {
      const bHit = raycastBuildings(pointer.ray);
      // Only show ghost on existing building if hovering its roof terrace to stack an upper tier!
      if (!bHit || bHit.roofZone) {
        let gx = pointer.worldHit.x;
        let gz = pointer.worldHit.z;
        let stackLift = 0;
        if (bHit && bHit.roofZone) {
          gx = bHit.x;
          gz = bHit.z;
          const baseLand = Math.max(TERRAIN.WATER_LEVEL + 0.12, TERRAIN.getHeight(gx, gz));
          stackLift = Math.max(0, (bHit.floorY + bHit.building.wallH - 0.15) - baseLand);
        }
        gx = clampToPlayable(gx, 2.2);
        gz = clampToPlayable(gz, 2.2);

        const ghostB = activeTool === 'tower'
          ? {
              id: 999991,
              type: 'tower',
              x: gx, z: gz,
              r: 1.65, yaw: -camera.yaw,
              wallH: 4.2, roofH: 3.1,
              baseLift: stackLift,
              roofId: activeRoofId, wallId: activeWallId
            }
          : {
              id: 999992,
              type: 'rect',
              x: gx, z: gz,
              w: 3.4, d: 3.0, yaw: -camera.yaw,
              wallH: 2.7, roofH: 2.4,
              baseLift: stackLift,
              roofId: activeRoofId, wallId: activeWallId
            };
        const arr = ghostB.type === 'tower'
          ? PROCGEN.buildTowerBuilding(ghostB, null)
          : PROCGEN.buildRectBuilding(ghostB, null);
        activePreviewMode = 2; // Translucent stippled warm blueprint glow!
        RENDERER.uploadSolidSlot('preview', arr, (arr.length / GEO.STRIDE) | 0);
        return;
      }
    }

    RENDERER.uploadSolidSlot('preview', null, 0);
  }

  function computeStampPlacement(ray) {
    const kind = subTool.stamp;
    const bHit = raycastBuildings(ray);
    const tHit = TERRAIN.raycast(ray, false);

    if (kind === 'window' || kind === 'ivy') {
      if (bHit && Math.abs(bHit.ny) < 0.55) {
        const wYaw = Math.atan2(-bHit.nx, bHit.nz);
        return {
          kind,
          x: bHit.x, y: bHit.y, z: bHit.z,
          yaw: wYaw,
          onStructure: true
        };
      }
      return null;
    }
    if (kind === 'dormer' || kind === 'chimney' || kind === 'flag') {
      if (bHit) {
        const b = bHit.building;
        const floorY = b._computedFloorY ?? 0;
        const topY = floorY + b.wallH + Math.max(0.2, b.roofH);
        const wYaw = Math.atan2(bHit.x - b.x, bHit.z - b.z);
        return {
          kind,
          x: kind === 'flag' && b.type === 'tower' ? b.x : bHit.x,
          y: kind === 'flag' && b.type === 'tower' ? topY : Math.max(floorY + b.wallH * 0.85, bHit.y),
          z: kind === 'flag' && b.type === 'tower' ? b.z : bHit.z,
          yaw: wYaw,
          roofId: b.roofId,
          color: PALETTES.getRoofSwatch(activeRoofId).hex,
          onStructure: true
        };
      }
      return null;
    }
    if (kind === 'lantern_post') {
      if (bHit && Math.abs(bHit.ny) < 0.55) {
        return { kind, x: bHit.x + bHit.nx * 0.16, y: bHit.y, z: bHit.z + bHit.nz * 0.16, yaw: 0, onStructure: true };
      }
      if (tHit && !TERRAIN.isWater(tHit.x, tHit.z)) {
        return { kind, x: clampToPlayable(tHit.x, 1.5), y: tHit.y, z: clampToPlayable(tHit.z, 1.5), yaw: 0, onStructure: false };
      }
      return null;
    }
    if (tHit && !TERRAIN.isWater(tHit.x, tHit.z)) {
      return { kind, x: clampToPlayable(tHit.x, 1.5), y: tHit.y, z: clampToPlayable(tHit.z, 1.5), yaw: camera.yaw + Math.PI, onStructure: false };
    }
    return null;
  }

  // ==========================================================================
  // POINTER & TOOL INTERACTION HANDLERS
  // ==========================================================================
  function updatePointerRay(clientX, clientY, targetEl) {
    pointer.x = clientX;
    pointer.y = clientY;
    pointer.overUi = !!(targetEl && targetEl.closest && targetEl.closest('.ui-interactive'));
    pointer.ray = M.screenToRay(
      clientX, clientY,
      window.innerWidth, window.innerHeight,
      RENDERER.getInvViewProj()
    );
    pointer.worldHit = TERRAIN.raycast(pointer.ray, true);

    if (!pointer.overUi && !photoMode && !strollMode) {
      const picked = pickEntityAt(pointer.ray, pointer.worldHit);
      hoveredEntity = picked ? { kind: picked.kind, id: picked.entity.id } : null;
    } else {
      hoveredEntity = null;
    }
  }

  function onPointerDown(e) {
    if (e.target && e.target.closest && e.target.closest('.ui-interactive')) return;
    AUDIO.ensureContext();

    // Auto-close any open floating popover/modal when clicking onto the 3D canvas!
    if (typeof UI !== 'undefined') UI.onCanvasPointerDown();

    updatePointerRay(e.clientX, e.clientY, e.target);
    pointer.down = true;
    pointer.button = e.button;
    pointer.startX = e.clientX;
    pointer.startY = e.clientY;
    pointer.movedDist = 0;

    // First-person Villager Stroll Mode: pet creatures on click or drag to look around!
    if (strollMode) {
      if (e.button === 0 && pointer.ray && NATURE.tryInteractCreature(pointer.ray)) {
        return;
      }
      dragAction = {
        kind: 'stroll_look',
        lastX: e.clientX,
        lastY: e.clientY
      };
      return;
    }

    // Right / Middle button or Space/Alt -> Camera Orbit / Pan!
    if (e.button === 2 || e.button === 1 || keyState['Space'] || e.altKey || photoMode) {
      dragAction = {
        kind: (e.shiftKey || keyState['Space'] || e.button === 1) ? 'cam_pan' : 'cam_orbit',
        lastX: e.clientX,
        lastY: e.clientY
      };
      return;
    }

    const ray = pointer.ray;
    const hit = pointer.worldHit;

    // 1. Select / Roam / Unified Tweaking Tool
    if (activeTool === 'select') {
      const petted = NATURE.tryInteractCreature(ray);
      if (petted) return;

      const picked = pickEntityAt(ray, hit);
      if (picked) {
        selectEntity(picked.kind, picked.entity.id);
        triggerSpring(picked.entity, picked.kind, -0.09);
        AUDIO.playSpringPop(1.08);

        if (picked.kind === 'building') {
          pushUndo();
          dragAction = {
            kind: 'move_building',
            building: picked.entity,
            offsetX: picked.entity.x - picked.hit.x,
            offsetZ: picked.entity.z - picked.hit.z,
            changed: false
          };
        } else if (picked.kind === 'stamp' && !picked.entity.onStructure) {
          pushUndo();
          dragAction = {
            kind: 'move_stamp',
            stamp: picked.entity,
            offsetX: picked.entity.x - picked.hit.x,
            offsetZ: picked.entity.z - picked.hit.z,
            changed: false
          };
        }
      } else {
        clearSelection();
        dragAction = { kind: 'cam_orbit', lastX: e.clientX, lastY: e.clientY };
      }
      return;
    }

    // 2. Cottage ('rect') or Tower ('tower') Tool
    if (activeTool === 'rect' || activeTool === 'tower') {
      const bHit = raycastBuildings(ray);
      if (!bHit && NATURE.tryInteractCreature(ray)) return;
      if (!hit) return;

      let startX = clampToPlayable(hit.x, 2.2);
      let startZ = clampToPlayable(hit.z, 2.2);
      let stackLift = 0;
      if (bHit && bHit.roofZone) {
        startX = clampToPlayable(bHit.x, 2.0);
        startZ = clampToPlayable(bHit.z, 2.0);
        const baseLand = Math.max(TERRAIN.WATER_LEVEL + 0.12, TERRAIN.getHeight(startX, startZ));
        stackLift = Math.max(0, (bHit.floorY + bHit.building.wallH - 0.15) - baseLand);
      }

      dragAction = {
        kind: activeTool === 'tower' ? 'create_tower' : 'create_rect',
        anchorX: startX,
        anchorZ: startZ,
        stacking: stackLift > 0.35,
        clickedBuildingId: bHit ? bHit.building.id : null,
        tempBuilding: activeTool === 'tower'
          ? {
              id: nextId,
              type: 'tower',
              x: startX, z: startZ,
              r: 1.65, yaw: -camera.yaw,
              wallH: 4.2, roofH: 3.1,
              baseLift: stackLift,
              roofId: activeRoofId, wallId: activeWallId
            }
          : {
              id: nextId,
              type: 'rect',
              x: startX, z: startZ,
              w: 3.4, d: 3.0, yaw: -camera.yaw,
              wallH: 2.7, roofH: 2.4,
              baseLift: stackLift,
              roofId: activeRoofId, wallId: activeWallId
            }
      };
      triggerClickRipple(startX, startZ);
      return;
    }

    // 3. Curved Stone Wall / Wooden Fence Tool
    if (activeTool === 'wall') {
      if (!hit) return;
      const existingWall = findWallNear(hit.x, hit.z, 0.95);
      const wx = clampToPlayable(hit.x, 1.4);
      const wz = clampToPlayable(hit.z, 1.4);
      const wKind = subTool.wall === 'fence' ? 'fence' : 'stone';
      const wHeight = subTool.wall === 'tall_stone' ? 2.55 : (wKind === 'fence' ? 0.95 : 1.42);
      dragAction = {
        kind: 'draw_wall',
        clickedWallId: existingWall ? existingWall.id : null,
        totalLen: 0,
        tempWall: {
          id: nextId,
          kind: wKind,
          height: wHeight,
          pts: [{ x: wx, z: wz }]
        }
      };
      triggerClickRipple(wx, wz);
      AUDIO.playStonePlace(1.1);
      return;
    }

    // 4. Path Painting Tool
    if (activeTool === 'path') {
      if (!hit) return;
      pushUndo();
      dragAction = { kind: 'paint_path', lastX: hit.x, lastZ: hit.z };
      triggerClickRipple(hit.x, hit.z);
      applyPathStroke(hit.x, hit.z, hit.x, hit.z);
      return;
    }

    // 5. Stamp / Clutter Tool
    if (activeTool === 'stamp') {
      // If clicking directly on an already-placed ground stamp of same area, allow selecting or placing
      const placement = computeStampPlacement(ray);
      if (placement) {
        pushUndo();
        placement.id = nextId++;
        triggerSpring(placement, 'stamp', -0.26);
        stamps.push(placement);
        dirtyStamps = true;
        selectEntity('stamp', placement.id);
        triggerClickRipple(placement.x, placement.z);
        NATURE.emitBurst(placement.x, (placement.y || 0) + 0.3, placement.z, 'dust', 6);
        AUDIO.playStonePlace(1.25);
        if (typeof UI !== 'undefined') UI.refreshStats();
      }
      return;
    }

    // 6. Palette Color Painter
    if (activeTool === 'palette') {
      const bHit = raycastBuildings(ray);
      if (bHit) {
        pushUndo();
        bHit.building.roofId = activeRoofId;
        bHit.building.wallId = activeWallId;
        triggerSpring(bHit.building, 'building', -0.14);
        rebuildSingleBuilding(bHit.building);
        uploadCombinedBuildings();
        selectEntity('building', bHit.building.id);
        AUDIO.playTileClatter(1.15);
        AUDIO.playSpringPop(1.05);
      }
      dragAction = { kind: 'paint_palette' };
      return;
    }

    // 7. Terrain & Pond Water Tool
    if (activeTool === 'terrain') {
      if (!hit) return;
      pushUndo();
      dragAction = {
        kind: 'sculpt_terrain',
        plateauY: TERRAIN.getBaseHeight(hit.x, hit.z)
      };
      triggerClickRipple(hit.x, hit.z);
      applyTerrainBrush(hit.x, hit.z, dragAction.plateauY);
      return;
    }

    // 8. Nature Brush Tool
    if (activeTool === 'nature') {
      if (!hit) return;
      pushUndo();
      dragAction = { kind: 'paint_nature', lastX: hit.x, lastZ: hit.z };
      triggerClickRipple(hit.x, hit.z);
      applyNatureBrush(hit.x, hit.z, true);
      return;
    }

    // 9. Demolish Hammer Tool
    if (activeTool === 'demolish') {
      performDemolishAt(ray, hit);
      dragAction = { kind: 'demolish_sweep' };
    }
  }

  function onPointerMove(e) {
    updatePointerRay(e.clientX, e.clientY, e.target);
    if (!pointer.down || !dragAction) return;

    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;
    pointer.movedDist = Math.hypot(dx, dy);

    if (dragAction.kind === 'stroll_look') {
      const mdx = e.clientX - dragAction.lastX;
      const mdy = e.clientY - dragAction.lastY;
      dragAction.lastX = e.clientX;
      dragAction.lastY = e.clientY;
      stroll.yaw -= mdx * 0.0052;
      stroll.pitch = M.clamp(stroll.pitch - mdy * 0.0046, -0.78, 0.72);
      return;
    }

    if (dragAction.kind === 'cam_orbit') {
      const mdx = e.clientX - dragAction.lastX;
      const mdy = e.clientY - dragAction.lastY;
      dragAction.lastX = e.clientX;
      dragAction.lastY = e.clientY;
      camera.desiredYaw -= mdx * 0.0068;
      camera.desiredPitch = M.clamp(camera.desiredPitch + mdy * 0.0058, 0.10, 1.38);
      return;
    }

    if (dragAction.kind === 'cam_pan') {
      const mdx = e.clientX - dragAction.lastX;
      const mdy = e.clientY - dragAction.lastY;
      dragAction.lastX = e.clientX;
      dragAction.lastY = e.clientY;
      const panScale = camera.desiredDist * 0.0016;
      const rightX = Math.cos(camera.desiredYaw), rightZ = -Math.sin(camera.desiredYaw);
      const fwdX = -Math.sin(camera.desiredYaw), fwdZ = -Math.cos(camera.desiredYaw);
      camera.desiredTarget[0] -= (rightX * mdx - fwdX * mdy) * panScale;
      camera.desiredTarget[2] -= (rightZ * mdx - fwdZ * mdy) * panScale;
      return;
    }

    if (dragAction.kind === 'gizmo_handle') {
      handleGizmoDrag(e.clientX, e.clientY);
      return;
    }

    const hit = pointer.worldHit;
    if (!hit) return;

    if (dragAction.kind === 'move_building') {
      if (pointer.movedDist > 4) {
        const b = dragAction.building;
        b.x = clampToPlayable(hit.x + dragAction.offsetX, 2.2);
        b.z = clampToPlayable(hit.z + dragAction.offsetZ, 2.2);
        dragAction.changed = true;
        rebuildSingleBuilding(b);
        uploadCombinedBuildings();
        TERRAIN.updateBuildingSuppression(buildings, walls);
        TERRAIN.markDirtyMesh();
        NATURE.markTreesDirty();
        AUDIO.playTileClatter(0.95);
      }
      return;
    }

    if (dragAction.kind === 'move_stamp') {
      if (pointer.movedDist > 4) {
        const st = dragAction.stamp;
        const nx = clampToPlayable(hit.x + dragAction.offsetX, 1.5);
        const nz = clampToPlayable(hit.z + dragAction.offsetZ, 1.5);
        if (!TERRAIN.isWater(nx, nz)) {
          st.x = nx;
          st.z = nz;
          st.y = TERRAIN.getHeight(nx, nz);
          dragAction.changed = true;
          dirtyStamps = true;
          AUDIO.playTileClatter(1.1);
        }
      }
      return;
    }

    if (dragAction.kind === 'create_rect') {
      const tb = dragAction.tempBuilding;
      const c = Math.cos(tb.yaw), s = Math.sin(tb.yaw);
      const cx = clampToPlayable(hit.x, 2.0);
      const cz = clampToPlayable(hit.z, 2.0);
      const vx = cx - dragAction.anchorX;
      const vz = cz - dragAction.anchorZ;
      const localX = vx * c + vz * s;
      const localZ = -vx * s + vz * c;
      tb.w = M.clamp(Math.max(2.4, Math.abs(localX) * 1.35), 2.0, 14.0);
      tb.d = M.clamp(Math.max(2.4, Math.abs(localZ) * 1.35), 2.0, 14.0);
      tb.x = clampToPlayable(dragAction.anchorX + vx * 0.5, 2.2);
      tb.z = clampToPlayable(dragAction.anchorZ + vz * 0.5, 2.2);
      tb.roofH = M.clamp(Math.min(tb.w, tb.d) * 0.65, 1.4, 4.4);
      AUDIO.playTileClatter(1.05 - tb.w * 0.025);
      return;
    }

    if (dragAction.kind === 'create_tower') {
      const tb = dragAction.tempBuilding;
      const rad = M.clamp(M.dist2D(dragAction.anchorX, dragAction.anchorZ, hit.x, hit.z), 1.15, 4.6);
      tb.r = rad;
      tb.roofH = M.clamp(rad * 1.75, 1.8, 5.2);
      AUDIO.playTileClatter(1.2 - rad * 0.08);
      return;
    }

    if (dragAction.kind === 'draw_wall') {
      const pts = dragAction.tempWall.pts;
      const last = pts[pts.length - 1];
      const wx = clampToPlayable(hit.x, 1.4);
      const wz = clampToPlayable(hit.z, 1.4);
      const seg = M.dist2D(last.x, last.z, wx, wz);
      if (seg >= 0.72) {
        pts.push({ x: wx, z: wz });
        dragAction.totalLen += seg;
        AUDIO.playTileClatter(0.85);
      }
      return;
    }

    if (dragAction.kind === 'paint_path') {
      if (M.dist2D(dragAction.lastX, dragAction.lastZ, hit.x, hit.z) >= 0.35) {
        applyPathStroke(dragAction.lastX, dragAction.lastZ, hit.x, hit.z);
        dragAction.lastX = hit.x;
        dragAction.lastZ = hit.z;
      }
      return;
    }

    if (dragAction.kind === 'paint_palette') {
      const bHit = raycastBuildings(pointer.ray);
      if (bHit && (bHit.building.roofId !== activeRoofId || bHit.building.wallId !== activeWallId)) {
        bHit.building.roofId = activeRoofId;
        bHit.building.wallId = activeWallId;
        triggerSpring(bHit.building, 'building', -0.12);
        rebuildSingleBuilding(bHit.building);
        uploadCombinedBuildings();
        AUDIO.playTileClatter(1.15);
      }
      return;
    }

    if (dragAction.kind === 'sculpt_terrain') {
      applyTerrainBrush(hit.x, hit.z, dragAction.plateauY);
      return;
    }

    if (dragAction.kind === 'paint_nature') {
      if (M.dist2D(dragAction.lastX, dragAction.lastZ, hit.x, hit.z) >= 0.85) {
        applyNatureBrush(hit.x, hit.z, false);
        dragAction.lastX = hit.x;
        dragAction.lastZ = hit.z;
      }
      return;
    }
  }

  function onPointerUp() {
    if (!pointer.down) return;
    pointer.down = false;

    if (dragAction) {
      if ((dragAction.kind === 'move_building' || dragAction.kind === 'move_stamp') && !dragAction.changed) {
        undoStack.pop();
        if (typeof UI !== 'undefined') UI.updateHistoryButtons();
      } else if (dragAction.kind === 'move_building' && dragAction.changed) {
        triggerSpring(dragAction.building, 'building', -0.12);
        AUDIO.playStonePlace(1.05);
      } else if (dragAction.kind === 'move_stamp' && dragAction.changed) {
        triggerSpring(dragAction.stamp, 'stamp', -0.16);
        AUDIO.playStonePlace(1.18);
      } else if (dragAction.kind === 'create_rect' || dragAction.kind === 'create_tower') {
        if (pointer.movedDist < 6 && dragAction.clickedBuildingId && !dragAction.stacking) {
          selectEntity('building', dragAction.clickedBuildingId);
          const b = getSelectedBuilding();
          if (b) triggerSpring(b, 'building', -0.09);
          AUDIO.playSpringPop(1.08);
        } else {
          pushUndo();
          const nb = { ...dragAction.tempBuilding, id: nextId++ };
          triggerSpring(nb, 'building', -0.24);
          rebuildSingleBuilding(nb);
          buildings.push(nb);
          uploadCombinedBuildings();
          TERRAIN.updateBuildingSuppression(buildings, walls);
          TERRAIN.markDirtyMesh();
          NATURE.markTreesDirty();

          const fy = nb._computedFloorY || 0;
          triggerClickRipple(nb.x, nb.z);
          NATURE.emitBurst(nb.x, fy + 0.35, nb.z, 'dust', 12);
          AUDIO.playStonePlace(nb.type === 'tower' ? 0.92 : 1.0);
          AUDIO.playSpringPop(0.96);
          selectEntity('building', nb.id);
          if (typeof UI !== 'undefined') UI.refreshStats();
        }
      } else if (dragAction.kind === 'draw_wall') {
        if (dragAction.tempWall.pts.length >= 2) {
          pushUndo();
          const nw = dragAction.tempWall;
          nw.id = nextId++;
          triggerSpring(nw, 'wall', -0.22);
          walls.push(nw);
          dirtyWalls = true;
          const mid = nw.pts[Math.floor(nw.pts.length / 2)];
          triggerClickRipple(mid.x, mid.z);
          NATURE.emitBurst(mid.x, TERRAIN.getHeight(mid.x, mid.z) + 0.4, mid.z, 'dust', 9);
          AUDIO.playStonePlace(1.08);
          selectEntity('wall', nw.id);
          if (typeof UI !== 'undefined') UI.refreshStats();
        } else if (pointer.movedDist < 6 && dragAction.clickedWallId) {
          selectEntity('wall', dragAction.clickedWallId);
          const w = getSelectedWall();
          if (w) triggerSpring(w, 'wall', -0.10);
          AUDIO.playSpringPop(1.1);
        }
      } else if (dragAction.kind === 'gizmo_handle') {
        if (dragAction.building) triggerSpring(dragAction.building, 'building', -0.09);
        if (dragAction.wall) triggerSpring(dragAction.wall, 'wall', -0.10);
        if (dragAction.stamp) triggerSpring(dragAction.stamp, 'stamp', -0.12);
        AUDIO.playSpringPop(1.06);
      }
    }

    dragAction = null;
    updateLivePreview();
  }

  function applyPathStroke(x0, z0, x1, z1) {
    const mode = subTool.path;
    const baseRad = mode === 'narrow' ? 0.78 : mode === 'erase' ? 1.5 : 1.25;
    TERRAIN.paintPathSegment(x0, z0, x1, z1, baseRad * brushScale, mode === 'erase');
    dirtyBuildingsAll = true;
    dirtyWalls = true;
    NATURE.markTreesDirty();
    AUDIO.playBrushRustle('dirt');
  }

  function applyTerrainBrush(wx, wz, plateauY) {
    const mode = subTool.terrain;
    if (mode === 'water') {
      TERRAIN.paintWater(wx, wz, 2.65 * brushScale, 1.35, keyState['ShiftLeft'] || keyState['ShiftRight']);
      NATURE.refreshPondDucks();
      AUDIO.playBrushRustle('water');
    } else if (mode === 'raise') {
      TERRAIN.sculptHeight(wx, wz, 3.6 * brushScale, 0.22, 'raise');
      AUDIO.playBrushRustle('dirt');
    } else if (mode === 'lower') {
      TERRAIN.sculptHeight(wx, wz, 3.6 * brushScale, 0.22, 'lower');
      AUDIO.playBrushRustle('dirt');
    } else if (mode === 'plateau') {
      TERRAIN.sculptHeight(wx, wz, 4.0 * brushScale, 0.26, 'plateau', plateauY);
      AUDIO.playBrushRustle('dirt');
    }
    dirtyBuildingsAll = true;
    dirtyWalls = true;
    dirtyStamps = true;
    NATURE.markTreesDirty();
  }

  function applyNatureBrush(wx, wz, initialClick) {
    const mode = subTool.nature;
    if (mode === 'tree') {
      const added = NATURE.addTree(
        clampToPlayable(wx + (Math.random() - 0.5) * 0.5, 1.6),
        clampToPlayable(wz + (Math.random() - 0.5) * 0.5, 1.6)
      );
      if (added) {
        NATURE.emitBurst(wx, TERRAIN.getHeight(wx, wz) + 0.4, wz, 'dust', 5);
        AUDIO.playBrushRustle('foliage');
      }
    } else if (mode === 'flower') {
      TERRAIN.paintFlowers(wx, wz, 2.6 * brushScale, 1.0);
      AUDIO.playBrushRustle('foliage');
    } else if (mode === 'sheep' && initialClick) {
      const sh = NATURE.spawnSheepAt(clampToPlayable(wx, 2.5), clampToPlayable(wz, 2.5));
      if (sh) AUDIO.playSheepBaa();
    } else if (mode === 'clear_nature') {
      NATURE.removeTreesInRadius(wx, wz, 2.6 * brushScale);
      TERRAIN.paintFlowers(wx, wz, 2.6 * brushScale, -1.0);
      AUDIO.playBrushRustle('foliage');
    }
    if (typeof UI !== 'undefined') UI.refreshStats();
  }

  function performDemolishAt(ray, hit) {
    const picked = pickEntityAt(ray, hit);
    if (picked) {
      pushUndo();
      if (picked.kind === 'stamp') {
        const st = picked.entity;
        stamps = stamps.filter((s) => s !== st);
        if (selection && selection.kind === 'stamp' && selection.id === st.id) clearSelection();
        dirtyStamps = true;
        NATURE.emitBurst(st.x, (st.y || (hit ? hit.y : 1)) + 0.4, st.z, 'dust', 10);
      } else if (picked.kind === 'building') {
        const b = picked.entity;
        buildings = buildings.filter((x) => x.id !== b.id);
        if (selection && selection.kind === 'building' && selection.id === b.id) clearSelection();
        uploadCombinedBuildings();
        TERRAIN.updateBuildingSuppression(buildings, walls);
        TERRAIN.markDirtyMesh();
        NATURE.markTreesDirty();
        NATURE.emitBurst(b.x, (b._computedFloorY || 0) + 1.2, b.z, 'dust', 16);
      } else if (picked.kind === 'wall') {
        const w = picked.entity;
        walls = walls.filter((x) => x !== w);
        if (selection && selection.kind === 'wall' && selection.id === w.id) clearSelection();
        dirtyWalls = true;
        if (hit) NATURE.emitBurst(hit.x, hit.y + 0.5, hit.z, 'dust', 12);
      }
      AUDIO.playDemolish();
      if (typeof UI !== 'undefined') UI.refreshStats();
      return;
    }

    if (hit) {
      const removedTrees = NATURE.removeTreesInRadius(hit.x, hit.z, 1.8 * brushScale);
      if (removedTrees > 0) {
        NATURE.emitBurst(hit.x, hit.y + 0.6, hit.z, 'dust', 8);
        AUDIO.playDemolish();
      }
    }
  }

  // ==========================================================================
  // UNIFIED SELECTION & DE-OVERLAPPED 3D GIZMO HANDLES
  // ==========================================================================
  function selectEntity(kind, id) {
    if (!kind || !id) {
      clearSelection();
      return;
    }
    selection = { kind, id };
    if (typeof UI !== 'undefined') UI.onSelectionChanged(getSelectionDetail());
  }

  function clearSelection() {
    selection = null;
    if (typeof UI !== 'undefined') UI.onSelectionChanged(null);
  }

  function selectBuilding(id) {
    if (!id) clearSelection();
    else selectEntity('building', id);
  }

  function getSelectedBuilding() {
    if (!selection || selection.kind !== 'building') return null;
    return buildings.find((b) => b.id === selection.id) || null;
  }

  function getSelectedWall() {
    if (!selection || selection.kind !== 'wall') return null;
    return walls.find((w) => w.id === selection.id) || null;
  }

  function getSelectedStamp() {
    if (!selection || selection.kind !== 'stamp') return null;
    return stamps.find((s) => s.id === selection.id) || null;
  }

  function getSelectionDetail() {
    if (!selection) return null;
    if (selection.kind === 'building') {
      const b = getSelectedBuilding();
      return b ? { kind: 'building', entity: b } : null;
    }
    if (selection.kind === 'wall') {
      const w = getSelectedWall();
      return w ? { kind: 'wall', entity: w } : null;
    }
    if (selection.kind === 'stamp') {
      const s = getSelectedStamp();
      return s ? { kind: 'stamp', entity: s } : null;
    }
    return null;
  }

  function startGizmoHandleDrag(handleType, clientX, clientY) {
    const sel = getSelectionDetail();
    if (!sel) return;
    AUDIO.ensureContext();
    pushUndo();
    pointer.down = true;
    pointer.startX = clientX;
    pointer.startY = clientY;

    if (sel.kind === 'building') {
      const b = sel.entity;
      dragAction = {
        kind: 'gizmo_handle',
        handleType,
        building: b,
        wasBattlement: (b.roofH || 0) <= 0.22,
        startWallH: b.wallH,
        startRoofH: b.roofH,
        startW: b.w || 3,
        startD: b.d || 3,
        startR: b.r || 1.8,
        startYaw: b.yaw || 0,
        startLift: b.baseLift || 0,
        startClientX: clientX,
        startClientY: clientY
      };
    } else if (sel.kind === 'wall') {
      const w = sel.entity;
      dragAction = {
        kind: 'gizmo_handle',
        handleType,
        wall: w,
        startWallH: w.height || 1.45,
        startClientX: clientX,
        startClientY: clientY
      };
    } else if (sel.kind === 'stamp') {
      const st = sel.entity;
      dragAction = {
        kind: 'gizmo_handle',
        handleType,
        stamp: st,
        startYaw: st.yaw || 0,
        startClientX: clientX,
        startClientY: clientY
      };
    }
  }

  function handleGizmoDrag(clientX, clientY) {
    const da = dragAction;
    const dy = da.startClientY - clientY;
    const dx = clientX - da.startClientX;
    const worldScale = (camera.dist || 20) * 0.0036;

    if (da.building) {
      const b = da.building;
      if (da.handleType === 'roof') {
        b.roofH = M.clamp(da.startRoofH + dy * worldScale, 0.0, 6.4);
        const nowBattlement = b.roofH <= 0.22;
        if (nowBattlement && !da.wasBattlement) {
          da.wasBattlement = true;
          spawnWorldBadge(b.x, (b._computedTopY || 4) + 0.6, b.z, '🏰 已化作古堡垛口女墙');
          AUDIO.playArchChime();
        } else if (!nowBattlement && da.wasBattlement) {
          da.wasBattlement = false;
        }
        AUDIO.playTileClatter(0.88 + b.roofH * 0.09);
      } else if (da.handleType === 'wall') {
        b.wallH = M.clamp(da.startWallH + dy * worldScale, 1.0, 11.5);
        AUDIO.playTileClatter(0.95);
      } else if (da.handleType === 'size') {
        const delta = (dx - dy * 0.35) * worldScale;
        if (b.type === 'tower') {
          b.r = M.clamp(da.startR + delta * 0.65, 1.05, 4.8);
        } else {
          b.w = M.clamp(da.startW + delta, 1.8, 14.5);
          b.d = M.clamp(da.startD + delta * 0.85, 1.8, 14.5);
        }
        TERRAIN.updateBuildingSuppression(buildings, walls);
        TERRAIN.markDirtyMesh();
        NATURE.markTreesDirty();
        AUDIO.playTileClatter(1.0);
      } else if (da.handleType === 'rotate') {
        b.yaw = da.startYaw + dx * 0.014;
        TERRAIN.updateBuildingSuppression(buildings, walls);
        TERRAIN.markDirtyMesh();
        AUDIO.playTileClatter(1.1);
      } else if (da.handleType === 'lift') {
        b.baseLift = M.clamp(da.startLift + dy * worldScale, 0.0, 7.0);
        TERRAIN.updateBuildingSuppression(buildings, walls);
        TERRAIN.markDirtyMesh();
        AUDIO.playTileClatter(0.82);
      }

      rebuildSingleBuilding(b);
      uploadCombinedBuildings();
      return;
    }

    if (da.wall && da.handleType === 'wall_height') {
      da.wall.height = M.clamp(da.startWallH + dy * worldScale, 0.65, 3.8);
      dirtyWalls = true;
      AUDIO.playTileClatter(0.92 + da.wall.height * 0.08);
      return;
    }

    if (da.stamp && da.handleType === 'stamp_rotate') {
      da.stamp.yaw = da.startYaw + dx * 0.018;
      dirtyStamps = true;
      AUDIO.playTileClatter(1.15);
    }
  }

  // Resolve screen-space pill overlaps so 3D handles stay 100% legible at any camera angle!
  function resolveGizmoOverlap(points) {
    const vis = points.filter((p) => p.visible);
    const minDx = 88;
    const minDy = 31;
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
          const a = vis[i], b = vis[j];
          const dx = b.sx - a.sx;
          const dy = b.sy - a.sy;
          if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
            const pushY = (minDy - Math.abs(dy)) * 0.52 * (dy >= 0 ? 1 : -1 || 1);
            const pushX = (minDx - Math.abs(dx)) * 0.18 * (dx >= 0 ? 1 : -1 || 1);
            a.sy -= pushY;
            b.sy += pushY;
            a.sx -= pushX;
            b.sx += pushX;
          }
        }
      }
    }
    return points;
  }

  function getSelectedGizmoScreenPoints() {
    if (photoMode || strollMode || hudHidden) return [];
    const sel = getSelectionDetail();
    if (!sel) return [];

    const vp = RENDERER.getViewProj();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let anchors = [];

    if (sel.kind === 'building') {
      const b = sel.entity;
      const floorY = b._computedFloorY ?? TERRAIN.getLandHeight(b.x, b.z);
      const eaveY = floorY + b.wallH;
      const peakY = eaveY + Math.max(0.25, b.roofH);
      const rad = b.type === 'tower' ? b.r : Math.max(b.w, b.d) * 0.5;
      const c = Math.cos(b.yaw || 0), s = Math.sin(b.yaw || 0);

      anchors = [
        { id: 'roof', label: b.roofH <= 0.22 ? '女墙/尖顶' : '屋顶尖度', icon: '▲', wx: b.x, wy: peakY + 0.42, wz: b.z, cursor: 'ns-resize' },
        { id: 'wall', label: '墙体高度', icon: '⇕', wx: b.x - s * (rad + 0.42), wy: eaveY + 0.1, wz: b.z + c * (rad + 0.42), cursor: 'ns-resize' },
        { id: 'size', label: '缩放尺寸', icon: '⇔', wx: b.x + c * (rad + 0.48), wy: floorY + b.wallH * 0.52, wz: b.z + s * (rad + 0.48), cursor: 'ew-resize' },
        { id: 'lift', label: '石拱抬升', icon: '拱', wx: b.x - c * (rad + 0.48), wy: floorY + 0.30, wz: b.z - s * (rad + 0.48), cursor: 'ns-resize' }
      ];
      if (b.type === 'rect') {
        anchors.push({
          id: 'rotate', label: '旋转朝向', icon: '↻',
          wx: b.x + s * (rad + 0.55), wy: floorY + 0.35, wz: b.z - c * (rad + 0.55), cursor: 'grab'
        });
      }
    } else if (sel.kind === 'wall') {
      const w = sel.entity;
      const mp = w._midPoint || (w.pts && w.pts[Math.floor(w.pts.length / 2)]);
      if (mp) {
        const gy = mp.gy ?? TERRAIN.getLandHeight(mp.x, mp.z);
        anchors = [
          {
            id: 'wall_height',
            label: `墙高 ${(w.height || 1.45).toFixed(1)}m`,
            icon: '⇕',
            wx: mp.x,
            wy: gy + (w.height || 1.45) + 0.45,
            wz: mp.z,
            cursor: 'ns-resize'
          }
        ];
      }
    } else if (sel.kind === 'stamp') {
      const st = sel.entity;
      const baseY = st._computedY ?? (st.y || TERRAIN.getLandHeight(st.x, st.z));
      anchors = [
        {
          id: 'stamp_rotate',
          label: '旋转朝向',
          icon: '↻',
          wx: st.x,
          wy: baseY + 1.45,
          wz: st.z,
          cursor: 'ew-resize'
        }
      ];
    }

    const projected = anchors.map((a) => {
      const scr = M.projectToScreen(a.wx, a.wy, a.wz, vp, vw, vh);
      return { ...a, sx: scr.x, sy: scr.y, visible: scr.visible };
    });
    return resolveGizmoOverlap(projected);
  }

  // Live Drag Dimension Pill & Emergent Floating Badges projected to screen!
  function getWorldFeedbackOverlays() {
    if (photoMode || hudHidden) return { dragPill: null, badges: [] };

    const vp = RENDERER.getViewProj();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let dragPill = null;
    if (dragAction) {
      if (dragAction.kind === 'create_rect') {
        const tb = dragAction.tempBuilding;
        const scr = M.projectToScreen(tb.x, (tb._computedTopY || 4) + 0.55, tb.z, vp, vw, vh);
        if (scr.visible) {
          const prefix = dragAction.stacking ? '叠层上筑 · ' : '';
          dragPill = { sx: scr.x, sy: scr.y, text: `${prefix}${tb.w.toFixed(1)} × ${tb.d.toFixed(1)}m` };
        }
      } else if (dragAction.kind === 'create_tower') {
        const tb = dragAction.tempBuilding;
        const scr = M.projectToScreen(tb.x, (tb._computedTopY || 5) + 0.55, tb.z, vp, vw, vh);
        if (scr.visible) {
          const prefix = dragAction.stacking ? '叠建塔楼 · ' : '';
          dragPill = { sx: scr.x, sy: scr.y, text: `${prefix}直径 ${(tb.r * 2).toFixed(1)}m` };
        }
      } else if (dragAction.kind === 'draw_wall' && dragAction.tempWall.pts.length >= 2) {
        const last = dragAction.tempWall.pts[dragAction.tempWall.pts.length - 1];
        const gy = TERRAIN.getLandHeight(last.x, last.z) + (dragAction.tempWall.height || 1.4) + 0.5;
        const scr = M.projectToScreen(last.x, gy, last.z, vp, vw, vh);
        if (scr.visible) {
          const kindLbl = dragAction.tempWall.kind === 'fence' ? '木篱笆' : '石墙';
          dragPill = { sx: scr.x, sy: scr.y, text: `${kindLbl} · ${dragAction.totalLen.toFixed(1)}m` };
        }
      } else if (dragAction.kind === 'gizmo_handle') {
        if (dragAction.building) {
          const b = dragAction.building;
          const scr = M.projectToScreen(b.x, (b._computedTopY || 4) + 0.75, b.z, vp, vw, vh);
          if (scr.visible) {
            let txt = '';
            if (dragAction.handleType === 'roof') {
              txt = b.roofH <= 0.22 ? '🏰 垛口女墙露台' : `屋顶尖度 ${b.roofH.toFixed(1)}m`;
            } else if (dragAction.handleType === 'wall') {
              txt = `墙体高度 ${b.wallH.toFixed(1)}m`;
            } else if (dragAction.handleType === 'size') {
              txt = b.type === 'tower' ? `塔径 ${(b.r * 2).toFixed(1)}m` : `尺寸 ${b.w.toFixed(1)} × ${b.d.toFixed(1)}m`;
            } else if (dragAction.handleType === 'lift') {
              txt = b.baseLift > 0.55 ? `石拱高架 +${b.baseLift.toFixed(1)}m` : '贴地石砌基座';
            } else if (dragAction.handleType === 'rotate') {
              const deg = Math.round((((b.yaw || 0) * 180 / Math.PI) % 360 + 360) % 360);
              txt = `朝向 ${deg}°`;
            }
            if (txt) dragPill = { sx: scr.x, sy: scr.y - 26, text: txt };
          }
        } else if (dragAction.wall && dragAction.handleType === 'wall_height') {
          const w = dragAction.wall;
          const mp = w._midPoint || (w.pts && w.pts[Math.floor(w.pts.length / 2)]);
          if (mp) {
            const gy = mp.gy ?? TERRAIN.getLandHeight(mp.x, mp.z);
            const scr = M.projectToScreen(mp.x, gy + (w.height || 1.45) + 0.75, mp.z, vp, vw, vh);
            if (scr.visible) {
              dragPill = { sx: scr.x, sy: scr.y - 24, text: `墙垣高度 ${(w.height || 1.45).toFixed(2)}m` };
            }
          }
        } else if (dragAction.stamp && dragAction.handleType === 'stamp_rotate') {
          const st = dragAction.stamp;
          const baseY = st._computedY ?? (st.y || TERRAIN.getLandHeight(st.x, st.z));
          const scr = M.projectToScreen(st.x, baseY + 1.75, st.z, vp, vw, vh);
          if (scr.visible) {
            const deg = Math.round((((st.yaw || 0) * 180 / Math.PI) % 360 + 360) % 360);
            dragPill = { sx: scr.x, sy: scr.y - 24, text: `装饰朝向 ${deg}°` };
          }
        }
      }
    }

    const badges = [];
    for (let i = 0; i < worldBadges.length; i++) {
      const wb = worldBadges[i];
      const scr = M.projectToScreen(wb.wx, wb.wy, wb.wz, vp, vw, vh);
      if (scr.visible) {
        const progress = wb.age / wb.life;
        const opacity = progress < 0.15 ? (progress / 0.15) : (1.0 - Math.pow(Math.max(0, (progress - 0.55) / 0.45), 1.4));
        badges.push({ sx: scr.x, sy: scr.y, text: wb.text, opacity: M.saturate(opacity) });
      }
    }

    return { dragPill, badges };
  }

  function deleteSelectedEntity() {
    const sel = getSelectionDetail();
    if (!sel) return;
    pushUndo();
    if (sel.kind === 'building') {
      const b = sel.entity;
      buildings = buildings.filter((x) => x.id !== b.id);
      uploadCombinedBuildings();
      TERRAIN.updateBuildingSuppression(buildings, walls);
      TERRAIN.markDirtyMesh();
      NATURE.markTreesDirty();
      NATURE.emitBurst(b.x, (b._computedFloorY || 0) + 1.0, b.z, 'dust', 14);
    } else if (sel.kind === 'wall') {
      const w = sel.entity;
      walls = walls.filter((x) => x !== w);
      dirtyWalls = true;
      const mp = w._midPoint || w.pts[0];
      if (mp) NATURE.emitBurst(mp.x, TERRAIN.getHeight(mp.x, mp.z) + 0.6, mp.z, 'dust', 11);
    } else if (sel.kind === 'stamp') {
      const st = sel.entity;
      stamps = stamps.filter((x) => x !== st);
      dirtyStamps = true;
      NATURE.emitBurst(st.x, (st.y || 1) + 0.4, st.z, 'dust', 9);
    }
    clearSelection();
    AUDIO.playDemolish();
    if (typeof UI !== 'undefined') UI.refreshStats();
  }

  function duplicateSelectedEntity() {
    const sel = getSelectionDetail();
    if (!sel) return;
    if (sel.kind === 'building') {
      const b = sel.entity;
      pushUndo();
      const copy = {
        ...b,
        id: nextId++,
        x: clampToPlayable(b.x + 2.4, 2.2),
        z: clampToPlayable(b.z + 1.9, 2.2),
        _mesh: null,
        _lights: null
      };
      triggerSpring(copy, 'building', -0.24);
      rebuildSingleBuilding(copy);
      buildings.push(copy);
      uploadCombinedBuildings();
      TERRAIN.updateBuildingSuppression(buildings, walls);
      TERRAIN.markDirtyMesh();
      NATURE.markTreesDirty();
      AUDIO.playStonePlace(1.05);
      selectEntity('building', copy.id);
      if (typeof UI !== 'undefined') UI.refreshStats();
    } else if (sel.kind === 'stamp') {
      const st = sel.entity;
      pushUndo();
      const copy = {
        ...st,
        id: nextId++,
        x: clampToPlayable(st.x + 1.3, 1.5),
        z: clampToPlayable(st.z + 1.1, 1.5)
      };
      if (!copy.onStructure) {
        copy.y = TERRAIN.getHeight(copy.x, copy.z);
      }
      triggerSpring(copy, 'stamp', -0.24);
      stamps.push(copy);
      dirtyStamps = true;
      AUDIO.playStonePlace(1.2);
      selectEntity('stamp', copy.id);
      if (typeof UI !== 'undefined') UI.refreshStats();
    }
  }

  function setSelectedWallKind(newKind) {
    const w = getSelectedWall();
    if (!w) return;
    pushUndo();
    if (newKind === 'fence') {
      w.kind = 'fence';
      w.height = 0.95;
    } else if (newKind === 'tall_stone') {
      w.kind = 'stone';
      w.height = 2.6;
    } else {
      w.kind = 'stone';
      w.height = 1.45;
    }
    triggerSpring(w, 'wall', -0.18);
    dirtyWalls = true;
    AUDIO.playStonePlace(1.1);
    if (typeof UI !== 'undefined') UI.onSelectionChanged(getSelectionDetail());
  }

  function rotateSelectedStamp(deltaRad = Math.PI * 0.25) {
    const st = getSelectedStamp();
    if (!st) return;
    pushUndo();
    st.yaw = (st.yaw || 0) + deltaRad;
    triggerSpring(st, 'stamp', -0.14);
    dirtyStamps = true;
    AUDIO.playSpringPop(1.15);
  }

  function toggleSelectedBattlement() {
    const b = getSelectedBuilding();
    if (!b) return null;
    pushUndo();
    const toBattlement = b.roofH > 0.22;
    b.roofH = toBattlement ? 0.05 : (b.type === 'tower' ? 3.2 : 2.5);
    triggerSpring(b, 'building', -0.16);
    rebuildSingleBuilding(b);
    uploadCombinedBuildings();
    if (toBattlement) AUDIO.playArchChime();
    else AUDIO.playTileClatter(1.1);
    if (typeof UI !== 'undefined') UI.onSelectionChanged(getSelectionDetail());
    return toBattlement;
  }

  function toggleSelectedArchLift() {
    const b = getSelectedBuilding();
    if (!b) return null;
    pushUndo();
    const toArch = (b.baseLift || 0) <= 0.6;
    b.baseLift = toArch ? 1.68 : 0.0;
    triggerSpring(b, 'building', -0.16);
    rebuildSingleBuilding(b);
    uploadCombinedBuildings();
    TERRAIN.updateBuildingSuppression(buildings, walls);
    TERRAIN.markDirtyMesh();
    AUDIO.playStonePlace(toArch ? 1.15 : 0.92);
    if (typeof UI !== 'undefined') UI.onSelectionChanged(getSelectionDetail());
    return toArch;
  }

  // ==========================================================================
  // MAP WORKSHOP: LIVE LOSSLESS EXPANSION & CUSTOM WORLD GENERATOR
  // ==========================================================================
  function expandCurrentMap(targetWorldSize = null) {
    const nextSize = targetWorldSize || (TERRAIN.WORLD_SIZE < 80 ? 96 : 136);
    if (nextSize <= TERRAIN.WORLD_SIZE + 0.5) return false;

    if (strollMode) setStrollMode(false);
    pushUndo();

    const oldHalf = TERRAIN.HALF_SIZE;
    const expanded = TERRAIN.expandDomainPreservingContent(nextSize, Math.floor(Math.random() * 8000) + 1000);
    if (!expanded) return false;

    NATURE.populateExpandedRing(oldHalf, TERRAIN.HALF_SIZE, Math.floor(Math.random() * 8000) + 500);
    NATURE.refreshPondDucks();
    RENDERER.rebuildInstancedNature();

    suppressEmergentBadges = true;
    markEverythingDirty();
    syncDirtyGeometry();
    suppressEmergentBadges = false;

    // Pull camera back gently so the newly unfolded surrounding valley comes into view!
    camera.desiredDist = Math.min(getMaxCamDist(), Math.max(camera.desiredDist * 1.28, nextSize * 0.34));
    AUDIO.playMapExpandFanfare();

    if (typeof UI !== 'undefined') {
      UI.refreshStats();
      UI.syncMapBadges();
      UI.updateHistoryButtons();
    }
    return true;
  }

  function generateCustomMap(config = {}) {
    const {
      worldSize = 96,
      archetype = 'clearing',
      season = seasonId,
      seed = Math.floor(Math.random() * 89999) + 10000,
      treeDensity = 1.0,
      waterAmount = 1.0
    } = config;

    if (strollMode) setStrollMode(false);
    undoStack.length = 0;
    redoStack.length = 0;
    clearSelection();
    worldBadges.length = 0;

    seasonId = PALETTES.SEASONS[season] ? season : 'summer';

    TERRAIN.generateArchetypeTerrain({
      worldSize,
      archetype,
      seed,
      waterLevelMul: waterAmount
    });

    nextId = 1;
    buildings = [];
    walls = [];
    stamps = [];

    // Populate atmospheric mossy starter ruins if 'ancient_ruins' biome chosen!
    if (archetype === 'ancient_ruins') {
      const rng = M.mulberry32(seed ^ 4242);
      const ruinPath = [
        { x: -13.5, z: 11.0 }, { x: -7.5, z: 5.5 }, { x: -3.2, z: 1.5 }, { x: 1.5, z: -2.0 }
      ];
      const dense = M.resampleSpline2D(ruinPath, 0.55);
      for (let i = 0; i < dense.length - 1; i++) {
        TERRAIN.paintPathSegment(dense[i].x, dense[i].z, dense[i + 1].x, dense[i + 1].z, 1.15, false);
      }

      buildings.push(
        {
          id: nextId++,
          type: 'tower',
          x: -2.4, z: -2.2, r: 2.25, yaw: 0.3,
          wallH: 3.9, roofH: 0.05, baseLift: 0,
          roofId: 'moss', wallId: 'moss_ruin'
        },
        {
          id: nextId++,
          type: 'rect',
          x: 1.6, z: -2.6, w: 4.6, d: 3.6, yaw: -0.18,
          wallH: 2.5, roofH: 0.05, baseLift: 0,
          roofId: 'moss', wallId: 'castle_grey'
        }
      );

      walls.push(
        {
          id: nextId++,
          kind: 'stone',
          height: 1.65,
          pts: [
            { x: -9.5, z: 1.2 }, { x: -6.8, z: 4.6 }, { x: -2.5, z: 5.2 }, { x: 2.2, z: 3.4 }
          ]
        },
        {
          id: nextId++,
          kind: 'stone',
          height: 1.25,
          pts: [
            { x: 4.5, z: -0.8 }, { x: 6.4, z: -3.8 }, { x: 4.8, z: -6.5 }
          ]
        }
      );

      stamps.push(
        { id: nextId++, kind: 'well', x: -5.4, y: 0, z: 0.8, yaw: rng() * 3, onStructure: false },
        { id: nextId++, kind: 'lantern_post', x: -4.2, y: 0, z: 4.2, yaw: 0, onStructure: false }
      );
    }

    NATURE.resetTrees((seed ^ 777) | 0, treeDensity);
    NATURE.initCreatures();
    RENDERER.rebuildInstancedNature();

    suppressEmergentBadges = true;
    markEverythingDirty();
    syncDirtyGeometry();
    suppressEmergentBadges = false;

    camera.desiredTarget = [0, 1.8, 0];
    camera.desiredYaw = 0.68;
    camera.desiredPitch = 0.39;
    camera.desiredDist = M.clamp(TERRAIN.WORLD_SIZE * 0.31, 21.0, 44.0);
    camera.yaw = camera.desiredYaw;
    camera.pitch = camera.desiredPitch;
    camera.dist = camera.desiredDist;
    camera.target = [...camera.desiredTarget];

    AUDIO.playMapExpandFanfare();

    if (typeof UI !== 'undefined') {
      UI.syncAtmosphereControls();
      UI.updateHistoryButtons();
      UI.onSelectionChanged(null);
      UI.refreshStats();
      UI.syncMapBadges();
    }
  }

  // ==========================================================================
  // PRESET DIORAMA LOADER & SAVE / LOAD (.glade.json & Multi-Slot LocalStorage)
  // ==========================================================================
  function loadPreset(presetId) {
    const preset = PALETTES.PRESET_GLADES.find((p) => p.id === presetId) || PALETTES.PRESET_GLADES[0];
    if (strollMode) setStrollMode(false);
    undoStack.length = 0;
    redoStack.length = 0;
    clearSelection();
    worldBadges.length = 0;

    seasonId = preset.season || 'summer';
    timeOfDay = preset.timeOfDay ?? 16.2;
    sunAzimuth = preset.sunAzimuth ?? 0.72;

    const targetWorldSize = preset.worldSize || 96;
    TERRAIN.resetToNaturalClearing(101, targetWorldSize);

    if (preset.hills) {
      for (const h of preset.hills) {
        TERRAIN.sculptHeight(h.x, h.z, h.r, h.h, 'raise');
      }
    }
    if (preset.ponds) {
      for (const p of preset.ponds) {
        TERRAIN.paintWater(p.x, p.z, p.r, p.depth || 1.3, false);
      }
    }
    if (preset.paths) {
      for (const stroke of preset.paths) {
        const dense = M.resampleSpline2D(stroke, 0.55);
        for (let i = 0; i < dense.length - 1; i++) {
          TERRAIN.paintPathSegment(dense[i].x, dense[i].z, dense[i + 1].x, dense[i + 1].z, 1.22, false);
        }
      }
    }

    nextId = 1;
    buildings = (preset.buildings || []).map((b) => ({
      ...b,
      id: nextId++,
      _mesh: null,
      _lights: null
    }));
    walls = (preset.walls || []).map((w) => ({
      id: nextId++,
      kind: w.kind || 'stone',
      height: w.height || 1.45,
      pts: w.pts.map((pt) => ({ x: pt.x, z: pt.z }))
    }));
    stamps = (preset.stamps || []).map((s) => {
      const copy = { ...s, id: nextId++ };
      if (copy.kind === 'chimney' || copy.kind === 'flag' || copy.kind === 'dormer') {
        copy.onStructure = true;
      }
      return copy;
    });

    NATURE.resetTrees(777, 1.0);
    NATURE.initCreatures();
    RENDERER.rebuildInstancedNature();

    suppressEmergentBadges = true;
    markEverythingDirty();
    syncDirtyGeometry();
    suppressEmergentBadges = false;

    if (presetId === 'lakeside_castle') {
      camera.desiredTarget = [0, 2.2, 2.0];
      camera.desiredYaw = 0.52;
      camera.desiredPitch = 0.36;
      camera.desiredDist = 26.0;
    } else if (presetId === 'autumn_mill') {
      camera.desiredTarget = [-1.5, 1.8, 0.5];
      camera.desiredYaw = 0.68;
      camera.desiredPitch = 0.35;
      camera.desiredDist = 24.0;
    } else {
      camera.desiredTarget = [-0.5, 1.8, 0.8];
      camera.desiredYaw = 0.66;
      camera.desiredPitch = 0.34;
      camera.desiredDist = 23.0;
    }
    camera.yaw = camera.desiredYaw;
    camera.pitch = camera.desiredPitch;
    camera.dist = camera.desiredDist;
    camera.target = [...camera.desiredTarget];

    if (typeof UI !== 'undefined') {
      UI.syncAtmosphereControls();
      UI.updateHistoryButtons();
      UI.onSelectionChanged(null);
      UI.refreshStats();
      UI.syncMapBadges();
    }
  }

  function exportGladeData(customTitle = '') {
    return {
      magic: 'TINY_GLADE_OFFLINE_V1',
      version: 2,
      title: customTitle || '',
      savedAt: new Date().toISOString(),
      worldSize: TERRAIN.WORLD_SIZE,
      seasonId,
      timeOfDay,
      sunAzimuth,
      buildings: buildings.map((b) => ({
        id: b.id, type: b.type, x: b.x, z: b.z,
        w: b.w, d: b.d, r: b.r, yaw: b.yaw,
        wallH: b.wallH, roofH: b.roofH, baseLift: b.baseLift,
        roofId: b.roofId, wallId: b.wallId
      })),
      walls: walls.map((w) => ({
        id: w.id, kind: w.kind, height: w.height,
        pts: w.pts.map((p) => ({ x: p.x, z: p.z }))
      })),
      stamps: stamps.map((s) => ({
        id: s.id, kind: s.kind, x: s.x, y: s.y, z: s.z,
        yaw: s.yaw, onStructure: s.onStructure, color: s.color, roofId: s.roofId
      })),
      trees: NATURE.serializeTrees(),
      terrain: TERRAIN.serialize()
    };
  }

  function importGladeData(data) {
    if (!data || data.magic !== 'TINY_GLADE_OFFLINE_V1') {
      throw new Error('无效的林间存档文件格式');
    }
    if (strollMode) setStrollMode(false);
    pushUndo();
    seasonId = data.seasonId || 'summer';
    timeOfDay = data.timeOfDay ?? 16.0;
    sunAzimuth = data.sunAzimuth ?? 0.72;

    TERRAIN.deserialize(data.terrain);
    NATURE.deserializeTrees(data.trees);
    RENDERER.rebuildInstancedNature();

    buildings = (data.buildings || []).map((b) => ({ ...b, _mesh: null, _lights: null }));
    walls = (data.walls || []).map((w) => ({
      id: w.id || nextId++,
      kind: w.kind, height: w.height,
      pts: w.pts.map((p) => ({ x: p.x, z: p.z }))
    }));
    stamps = (data.stamps || []).map((s) => ({ ...s }));
    nextId = Math.max(
      100,
      ...buildings.map((b) => b.id || 0),
      ...walls.map((w) => w.id || 0),
      ...stamps.map((s) => s.id || 0)
    ) + 1;

    clearSelection();
    NATURE.refreshPondDucks();
    suppressEmergentBadges = true;
    markEverythingDirty();
    syncDirtyGeometry();
    suppressEmergentBadges = false;

    if (typeof UI !== 'undefined') {
      UI.syncAtmosphereControls();
      UI.onSelectionChanged(null);
      UI.refreshStats();
      UI.syncMapBadges();
    }
  }

  // ==========================================================================
  // CURSOR RING & MAIN RENDER LOOP
  // ==========================================================================
  function computeCursorUniforms() {
    const hit = pointer.worldHit;
    if (!hit || pointer.overUi || photoMode || strollMode || activeTool === 'select' || activeTool === 'palette') {
      return { ring: [0, -100, 0, 1], color: [1, 1, 1, 0] };
    }
    let rad = 1.0;
    let col = [0.98, 0.90, 0.68, 1];
    if (activeTool === 'path') {
      const base = subTool.path === 'narrow' ? 0.78 : subTool.path === 'erase' ? 1.5 : 1.25;
      rad = base * brushScale;
      col = subTool.path === 'erase' ? [1.0, 0.62, 0.52, 1] : [0.95, 0.84, 0.58, 1];
    } else if (activeTool === 'terrain') {
      const base = subTool.terrain === 'water' ? 2.65 : subTool.terrain === 'plateau' ? 4.0 : 3.6;
      rad = base * brushScale;
      col = subTool.terrain === 'water' ? [0.42, 0.88, 0.95, 1] : [0.85, 0.95, 0.65, 1];
    } else if (activeTool === 'nature') {
      const base = subTool.nature === 'flower' || subTool.nature === 'clear_nature' ? 2.6 : 1.15;
      rad = base * (subTool.nature === 'tree' || subTool.nature === 'sheep' ? 1.0 : brushScale);
      col = subTool.nature === 'clear_nature' ? [1.0, 0.64, 0.48, 1] : [0.58, 0.96, 0.58, 1];
    } else if (activeTool === 'demolish') {
      rad = 1.2 * brushScale;
      col = [1.0, 0.46, 0.40, 1];
    } else if (activeTool === 'rect' || activeTool === 'tower' || activeTool === 'wall') {
      rad = 0.82;
      col = [1.0, 0.88, 0.62, 1];
    } else {
      return { ring: [hit.x, hit.y, hit.z, 0.8], color: [0, 0, 0, 0] };
    }
    return { ring: [hit.x, hit.y, hit.z, rad], color: col };
  }

  function computeHoverBoxUniform() {
    if (photoMode || strollMode) return [0, 0, 0, 0];
    const target = selection || hoveredEntity;
    if (!target) return [0, 0, 0, 0];

    if (target.kind === 'building') {
      const b = buildings.find((x) => x.id === target.id);
      if (!b) return [0, 0, 0, 0];
      const rad = b.type === 'tower' ? b.r + 0.38 : Math.hypot(b.w * 0.5, b.d * 0.5) + 0.28;
      return [b.x, b.z, rad, 1.0];
    }
    if (target.kind === 'wall') {
      const w = walls.find((x) => x.id === target.id);
      const mp = w && (w._midPoint || (w.pts && w.pts[Math.floor(w.pts.length / 2)]));
      if (!mp) return [0, 0, 0, 0];
      return [mp.x, mp.z, 2.2, 1.0];
    }
    if (target.kind === 'stamp') {
      const st = stamps.find((x) => x.id === target.id);
      if (!st) return [0, 0, 0, 0];
      return [st.x, st.z, 1.05, 1.0];
    }
    return [0, 0, 0, 0];
  }

  function buildRenderState(dt) {
    const seasonObj = PALETTES.SEASONS[seasonId] || PALETTES.SEASONS.summer;
    const isNight = timeOfDay < 5.7 || timeOfDay > 19.2;
    const focusXZ = strollMode ? [stroll.x, stroll.z] : [camera.target[0], camera.target[2]];

    const dyn = NATURE.updateAndBuildDynamic(
      dt, timeSec, seasonObj, isNight, buildings, walls, smokeSources, focusXZ
    );
    RENDERER.uploadSolidSlot('creatures', dyn.creatureVerts, dyn.creatureCount);
    RENDERER.updateParticles(dyn.particleData, dyn.particleCount);

    const cur = computeCursorUniforms();
    const focusDist = M.V3.len([
      camera.eye[0] - camera.target[0],
      camera.eye[1] - camera.target[1],
      camera.eye[2] - camera.target[2]
    ]);

    return {
      camera,
      timeSec,
      timeOfDay,
      sunAzimuth,
      seasonObj,
      pointLights,
      cursorRing: cur.ring,
      cursorColor: cur.color,
      hoverBox: computeHoverBoxUniform(),
      clickRipple: clickRipple.active ? [clickRipple.x, clickRipple.z, clickRipple.age, 1.0] : [0, 0, 0, 0],
      previewMode: activePreviewMode,
      sheepFlat: NATURE.getSheepPositionsFlat(8),
      duckFlat: NATURE.getDuckPositionsFlat(6),
      dofAmount,
      focusDist
    };
  }

  function frame(nowMs) {
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) * 0.001));
    lastFrameMs = nowMs;
    timeSec += dt;

    if (autoCycleTime) {
      timeOfDay = (timeOfDay + dt * 0.32) % 24.0;
      if (typeof UI !== 'undefined') UI.syncTimeDisplayOnly();
    }

    updateCameraVectors(dt);
    updateSpringsAndFeedback(dt);
    syncDirtyGeometry();
    updateLivePreview();

    const state = buildRenderState(dt);
    RENDERER.render(state);

    const isNight = timeOfDay < 5.7 || timeOfDay > 19.2;
    AUDIO.update(timeSec, isNight);

    if (typeof UI !== 'undefined') {
      UI.updateGizmoOverlay();
      UI.updateWorldFeedbackOverlay();
    }

    requestAnimationFrame(frame);
  }

  function capturePostcardDataUrl() {
    const state = buildRenderState(0.001);
    state.cursorColor = [0, 0, 0, 0];
    state.hoverBox = [0, 0, 0, 0];
    state.clickRipple = [0, 0, 0, 0];
    state.previewMode = 0;
    RENDERER.render(state);
    return RENDERER.getCanvas().toDataURL('image/png');
  }

  function bindEvents(canvasEl) {
    canvasEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());

    canvasEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey && !strollMode && !photoMode) {
        const nextScale = brushScale * (e.deltaY < 0 ? 1.08 : 0.92);
        setBrushScale(nextScale);
        return;
      }
      if (strollMode) return;
      const zoomFactor = Math.exp(e.deltaY * 0.0011);
      camera.desiredDist = M.clamp(camera.desiredDist * zoomFactor, 4.2, getMaxCamDist());
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      keyState[e.code] = true;

      if (e.code === 'Tab') {
        e.preventDefault();
        setHudHidden(!hudHidden);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyY') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selection) {
          e.preventDefault();
          deleteSelectedEntity();
        }
        return;
      }
      if (e.code === 'BracketLeft') {
        setBrushScale(brushScale - 0.15);
        return;
      }
      if (e.code === 'BracketRight') {
        setBrushScale(brushScale + 0.15);
        return;
      }
      if (e.code === 'KeyG') {
        setStrollMode(!strollMode);
        return;
      }
      if (e.code === 'KeyM') {
        if (typeof UI !== 'undefined') UI.openMapWorkshop();
        return;
      }
      if (e.code === 'Escape') {
        if (typeof UI !== 'undefined' && UI.hasOpenPopover()) {
          UI.closeAllPopovers();
        } else if (strollMode) {
          setStrollMode(false);
        } else if (photoMode) {
          setPhotoMode(false);
        } else if (hudHidden) {
          setHudHidden(false);
        } else if (selection) {
          clearSelection();
        } else {
          setTool('select');
        }
        return;
      }
      if (e.code === 'KeyP') {
        setPhotoMode(!photoMode);
        return;
      }

      if (!strollMode) {
        const toolKeys = {
          Digit1: 'select',
          Digit2: 'rect',
          Digit3: 'tower',
          Digit4: 'wall',
          Digit5: 'path',
          Digit6: 'stamp',
          Digit7: 'palette',
          Digit8: 'terrain',
          Digit9: 'nature',
          Digit0: 'demolish'
        };
        if (toolKeys[e.code]) {
          setTool(toolKeys[e.code]);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      keyState[e.code] = false;
    });

    window.addEventListener('resize', () => RENDERER.resize());
  }

  function setTool(toolName) {
    if (strollMode) setStrollMode(false);
    activeTool = toolName;
    AUDIO.playUiClick(true);
    if (typeof UI !== 'undefined') UI.syncToolBar();
  }

  function setSubTool(group, val) {
    subTool[group] = val;
    AUDIO.playUiClick(true);
    if (typeof UI !== 'undefined') UI.syncToolBar();
  }

  function setBrushScale(val) {
    brushScale = M.clamp(val, 0.45, 2.25);
    if (typeof UI !== 'undefined') UI.syncBrushScaleUI();
  }

  function setRoofSwatch(id) {
    activeRoofId = id;
    const sel = getSelectedBuilding();
    if (sel) {
      pushUndo();
      sel.roofId = id;
      triggerSpring(sel, 'building', -0.14);
      rebuildSingleBuilding(sel);
      uploadCombinedBuildings();
      AUDIO.playTileClatter(1.1);
    } else {
      AUDIO.playUiClick(true);
    }
    if (typeof UI !== 'undefined') UI.syncPaletteBar();
  }

  function setWallStyle(id) {
    activeWallId = id;
    const sel = getSelectedBuilding();
    if (sel) {
      pushUndo();
      sel.wallId = id;
      triggerSpring(sel, 'building', -0.14);
      rebuildSingleBuilding(sel);
      uploadCombinedBuildings();
      AUDIO.playStonePlace(1.1);
    } else {
      AUDIO.playUiClick(true);
    }
    if (typeof UI !== 'undefined') UI.syncPaletteBar();
  }

  function setSeason(id) {
    if (!PALETTES.SEASONS[id]) return;
    seasonId = id;
    TERRAIN.markDirtyMesh();
    NATURE.markTreesDirty();
    AUDIO.playUiClick(true);
    if (typeof UI !== 'undefined') UI.syncAtmosphereControls();
  }

  function setTimeOfDay(val) {
    timeOfDay = M.clamp(val, 0, 24);
  }

  function setSunAzimuth(val) {
    sunAzimuth = val;
  }

  function setAutoCycle(flag) {
    autoCycleTime = !!flag;
  }

  function setDofAmount(val) {
    dofAmount = M.clamp(val, 0, 1.25);
    if (!strollMode) savedOrbitalDof = dofAmount;
  }

  function setFov(val) {
    camera.desiredFov = M.clamp(val, 24, 68);
  }

  function setPhotoMode(flag) {
    if (flag && strollMode) setStrollMode(false);
    photoMode = !!flag;
    if (photoMode) {
      dofAmount = Math.max(0.46, dofAmount);
    }
    AUDIO.playUiClick(true);
    if (typeof UI !== 'undefined') UI.syncPhotoMode();
  }

  function setHudHidden(flag) {
    hudHidden = !!flag;
    AUDIO.playUiClick(true);
    if (typeof UI !== 'undefined') UI.syncHudHidden();
  }

  function nextInspirationTheme() {
    currentThemeIndex = (currentThemeIndex + 1) % PALETTES.DAILY_THEMES.length;
    AUDIO.playUiClick(true);
    return PALETTES.DAILY_THEMES[currentThemeIndex];
  }

  function start(canvasEl) {
    RENDERER.init(canvasEl);
    bindEvents(canvasEl);

    loadPreset('shepherd_haven');

    lastFrameMs = performance.now();
    requestAnimationFrame(frame);
  }

  return {
    start,
    loadPreset,
    generateCustomMap,
    expandCurrentMap,
    canExpandMap: () => TERRAIN.WORLD_SIZE < 135,
    getNextExpandSize: () => (TERRAIN.WORLD_SIZE < 80 ? 96 : 136),
    getMapWorldSize: () => TERRAIN.WORLD_SIZE,
    getMapConfig: () => PALETTES.getMapSizeConfig(TERRAIN.WORLD_SIZE),
    exportGladeData,
    importGladeData,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    setTool,
    getTool: () => activeTool,
    setSubTool,
    getSubTool: (g) => subTool[g],
    setBrushScale,
    getBrushScale: () => brushScale,
    setRoofSwatch,
    getRoofSwatchId: () => activeRoofId,
    setWallStyle,
    getWallStyleId: () => activeWallId,
    setSeason,
    getSeasonId: () => seasonId,
    setTimeOfDay,
    getTimeOfDay: () => timeOfDay,
    setSunAzimuth,
    getSunAzimuth: () => sunAzimuth,
    setAutoCycle,
    isAutoCycle: () => autoCycleTime,
    setDofAmount,
    getDofAmount: () => dofAmount,
    setFov,
    getFov: () => camera.desiredFov,
    setPhotoMode,
    isPhotoMode: () => photoMode,
    setStrollMode,
    isStrollMode: () => strollMode,
    setHudHidden,
    isHudHidden: () => hudHidden,
    selectEntity,
    clearSelection,
    selectBuilding,
    getSelectedBuilding,
    getSelectedWall,
    getSelectedStamp,
    getSelectionDetail,
    setSelectedWallKind,
    rotateSelectedStamp,
    toggleSelectedBattlement,
    toggleSelectedArchLift,
    getSelectedGizmoScreenPoints,
    getWorldFeedbackOverlays,
    startGizmoHandleDrag,
    deleteSelectedEntity,
    deleteSelectedBuilding: deleteSelectedEntity,
    duplicateSelectedEntity,
    duplicateSelectedBuilding: duplicateSelectedEntity,
    capturePostcardDataUrl,
    nextInspirationTheme,
    getCurrentTheme: () => PALETTES.DAILY_THEMES[currentThemeIndex],
    getStats: () => ({
      worldSize: TERRAIN.WORLD_SIZE,
      buildings: buildings.length,
      walls: walls.length,
      arches: knownArches.length,
      bridges: knownBridges.length,
      sheep: NATURE.getSheepCount()
    })
  };
})();
