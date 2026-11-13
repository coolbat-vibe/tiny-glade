// ============================================================================
// renderer.js — WebGL2 Multi-Pass HDR Stylized Renderer
// Passes:
//   1. 2048x2048 Directional Sun Shadow Map
//   2. Planar Water Reflection Pass (Sky + Clipped Scene)
//   3. Main HDR Lit Scene MRT Pass (Color + ViewNormal/LinearDepth)
//   4. 12-Sample Screen-Space Ambient Occlusion (SSAO) + Bilateral Blur
//   5. 3-Level Dual-Kawase HDR Bloom (Downsample + Upsample)
//   6. Final Composite (Colored AO + Miniature Tilt-Shift DoF + Bloom + ACES)
// ============================================================================

const RENDERER = (() => {
  let canvas = null;
  let gl = null;
  let extColorFloat = null;
  let extFloatLinear = null;

  let width = 1;
  let height = 1;
  let dpr = 1;

  const programs = {};
  let emptyVAO = null;
  let terrainMapTex = null;

  // Solid mesh slots
  const meshes = {};
  let grassGpu = null;
  let flowerGpu = null;
  let particleGpu = null;

  // Framebuffers
  const SHADOW_RES = 2048;
  let shadowFBO = null;
  let shadowDepthTex = null;

  const REFL_W = 640;
  const REFL_H = 360;
  let reflFBO = null;
  let reflColorTex = null;
  let reflNormalDummyTex = null;
  let reflDepthRB = null;

  let sceneFBO = null;
  let sceneColorTex = null;
  let sceneNormalDepthTex = null;
  let sceneDepthRB = null;

  let ssaoFBO = null;
  let ssaoTex = null;
  let ssaoBlurFBO = null;
  let ssaoBlurTex = null;

  const BLOOM_MIPS = 3;
  let bloomDownFBOs = [];
  let bloomDownTexs = [];
  let bloomUpFBOs = [];
  let bloomUpTexs = [];

  // Reusable matrices
  const matProj = M.Mat4.create();
  const matView = M.Mat4.create();
  const matViewProj = M.Mat4.create();
  const matInvViewProj = M.Mat4.create();

  const matReflView = M.Mat4.create();
  const matReflViewProj = M.Mat4.create();
  const matInvReflViewProj = M.Mat4.create();

  const matLightProj = M.Mat4.create();
  const matLightView = M.Mat4.create();
  const matLightViewProj = M.Mat4.create();

  const pointLightPosArr = new Float32Array(20 * 4);
  const pointLightColArr = new Float32Array(20 * 4);

  function compileShader(type, src, label) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      console.error(`Shader compile error [${label}]:\n`, log);
      throw new Error(`Shader compile failed [${label}]: ${log}`);
    }
    return sh;
  }

  function createProgram(vsSrc, fsSrc, label) {
    const vs = compileShader(gl.VERTEX_SHADER, vsSrc, label + '_VS');
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc, label + '_FS');
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      console.error(`Program link error [${label}]:\n`, log);
      throw new Error(`Program link failed [${label}]: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const uniforms = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i);
      const baseName = info.name.replace(/\[0\]$/, '');
      uniforms[baseName] = gl.getUniformLocation(prog, info.name);
    }
    return { prog, u: uniforms };
  }

  function createSolidSlot(dynamic = false) {
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const strideBytes = GEO.STRIDE * 4;
    // loc 0: aPos
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, strideBytes, 0);
    // loc 1: aNormal
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, strideBytes, 12);
    // loc 2: aColor
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, strideBytes, 24);
    // loc 3: aParam
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, strideBytes, 36);
    gl.bindVertexArray(null);
    return { vao, vbo, count: 0, usage: dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW };
  }

  function uploadSolidSlot(name, floatData, vertCount) {
    const slot = meshes[name];
    if (!slot) return;
    slot.count = vertCount | 0;
    if (slot.count <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, floatData, slot.usage);
  }

  function createColorTex(w, h, hdr = true, nearest = false) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const useFloat = hdr && !!extColorFloat;
    const internalFormat = useFloat ? gl.RGBA16F : gl.RGBA8;
    const type = useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const canLinear = !nearest && (!useFloat || !!extFloatLinear);
    const filter = canLinear ? gl.LINEAR : gl.NEAREST;

    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function initShadowFBO() {
    shadowDepthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowDepthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_RES, SHADOW_RES, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowDepthTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function initReflectionFBO() {
    reflColorTex = createColorTex(REFL_W, REFL_H, true, false);
    reflNormalDummyTex = createColorTex(REFL_W, REFL_H, true, true);
    reflDepthRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, reflDepthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, REFL_W, REFL_H);

    reflFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflColorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, reflNormalDummyTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, reflDepthRB);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function destroyScreenFBOs() {
    const delTex = (t) => t && gl.deleteTexture(t);
    const delFB = (f) => f && gl.deleteFramebuffer(f);
    const delRB = (r) => r && gl.deleteRenderbuffer(r);

    delTex(sceneColorTex);
    delTex(sceneNormalDepthTex);
    delRB(sceneDepthRB);
    delFB(sceneFBO);

    delTex(ssaoTex);
    delFB(ssaoFBO);
    delTex(ssaoBlurTex);
    delFB(ssaoBlurFBO);

    bloomDownTexs.forEach(delTex);
    bloomDownFBOs.forEach(delFB);
    bloomUpTexs.forEach(delTex);
    bloomUpFBOs.forEach(delFB);
    bloomDownTexs = [];
    bloomDownFBOs = [];
    bloomUpTexs = [];
    bloomUpFBOs = [];
  }

  function buildScreenFBOs(w, h) {
    destroyScreenFBOs();

    // 1. Main HDR Scene MRT FBO
    sceneColorTex = createColorTex(w, h, true, false);
    // Normal + linear depth needs float precision! If no float ext, fallback gracefully
    sceneNormalDepthTex = createColorTex(w, h, true, true);
    sceneDepthRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);

    sceneFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneColorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, sceneNormalDepthTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepthRB);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    // If RGBA16F FBO incomplete on exotic hardware, fallback to RGBA8 cleanly
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && extColorFloat) {
      extColorFloat = null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return buildScreenFBOs(w, h);
    }

    // 2. Half-Res SSAO + Bilateral Blur FBOs
    const aoW = Math.max(2, (w * 0.65) | 0);
    const aoH = Math.max(2, (h * 0.65) | 0);
    ssaoTex = createColorTex(aoW, aoH, false, false);
    ssaoFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ssaoTex, 0);

    ssaoBlurTex = createColorTex(aoW, aoH, false, false);
    ssaoBlurFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoBlurFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ssaoBlurTex, 0);

    // 3. Multi-Mip Dual-Kawase HDR Bloom Pyramid
    let bw = Math.max(2, w >> 1);
    let bh = Math.max(2, h >> 1);
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const dt = createColorTex(bw, bh, true, false);
      const df = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, df);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dt, 0);
      bloomDownTexs.push(dt);
      bloomDownFBOs.push(df);

      const ut = createColorTex(bw, bh, true, false);
      const uf = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, uf);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ut, 0);
      bloomUpTexs.push(ut);
      bloomUpFBOs.push(uf);

      bw = Math.max(2, bw >> 1);
      bh = Math.max(2, bh >> 1);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function initInstancedNature() {
    // 1. Grass VAO
    const blade = NATURE.createGrassBladeMesh();
    const grassInst = NATURE.createGrassInstances();
    const gVao = gl.createVertexArray();
    gl.bindVertexArray(gVao);

    const gVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gVbo);
    gl.bufferData(gl.ARRAY_BUFFER, blade.verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);

    const gIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, blade.indices, gl.STATIC_DRAW);

    const gInstBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, grassInst, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    grassGpu = { vao: gVao, instBuf: gInstBuf, indexCount: blade.indices.length, instanceCount: NATURE.GRASS_COUNT };

    // 2. Wildflower VAO
    const flVerts = NATURE.createFlowerMesh();
    const flInst = NATURE.createFlowerInstances();
    const fVao = gl.createVertexArray();
    gl.bindVertexArray(fVao);

    const fVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fVbo);
    gl.bufferData(gl.ARRAY_BUFFER, flVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);

    const fInstBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, flInst, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    flowerGpu = { vao: fVao, instBuf: fInstBuf, vertCount: flVerts.length / 4, instanceCount: NATURE.FLOWER_COUNT };

    // 3. Billboard Particle VAO
    const pVao = gl.createVertexArray();
    gl.bindVertexArray(pVao);
    const quadCorners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const pCornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pCornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadCorners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    const pInstBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, NATURE.MAX_PARTICLES * 32, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    particleGpu = { vao: pVao, instBuf: pInstBuf, count: 0 };
  }

  function init(canvasEl) {
    canvas = canvasEl;
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL2，请使用现代浏览器打开。');
    }

    extColorFloat = gl.getExtension('EXT_color_buffer_float');
    extFloatLinear = gl.getExtension('OES_texture_float_linear');

    programs.shadow = createProgram(SHADERS.SHADOW_VS, SHADERS.SHADOW_FS, 'SHADOW');
    programs.sky = createProgram(SHADERS.SKY_VS, SHADERS.SKY_FS, 'SKY');
    programs.solid = createProgram(SHADERS.SOLID_VS, SHADERS.SOLID_FS, 'SOLID');
    programs.grass = createProgram(SHADERS.GRASS_VS, SHADERS.GRASS_FS, 'GRASS');
    programs.flower = createProgram(SHADERS.FLOWER_VS, SHADERS.FLOWER_FS, 'FLOWER');
    programs.water = createProgram(SHADERS.WATER_VS, SHADERS.WATER_FS, 'WATER');
    programs.particle = createProgram(SHADERS.PARTICLE_VS, SHADERS.PARTICLE_FS, 'PARTICLE');
    programs.ssao = createProgram(SHADERS.QUAD_VS, SHADERS.SSAO_FS, 'SSAO');
    programs.ssaoBlur = createProgram(SHADERS.QUAD_VS, SHADERS.SSAO_BLUR_FS, 'SSAO_BLUR');
    programs.bloomDown = createProgram(SHADERS.QUAD_VS, SHADERS.BLOOM_DOWN_FS, 'BLOOM_DOWN');
    programs.bloomUp = createProgram(SHADERS.QUAD_VS, SHADERS.BLOOM_UP_FS, 'BLOOM_UP');
    programs.composite = createProgram(SHADERS.QUAD_VS, SHADERS.COMPOSITE_FS, 'COMPOSITE');

    emptyVAO = gl.createVertexArray();

    // Create terrain GPU data texture (145x145 RGBA8)
    terrainMapTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, terrainMapTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TERRAIN.GRID_N, TERRAIN.GRID_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    meshes.terrain = createSolidSlot(false);
    meshes.vista = createSolidSlot(false);
    meshes.water = createSolidSlot(false);
    meshes.buildings = createSolidSlot(false);
    meshes.walls = createSolidSlot(false);
    meshes.stamps = createSolidSlot(false);
    meshes.nature = createSolidSlot(false);
    meshes.creatures = createSolidSlot(true);
    meshes.preview = createSolidSlot(true);

    initInstancedNature();
    initShadowFBO();
    initReflectionFBO();
    resize();
  }

  function resize() {
    if (!canvas || !gl) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    const cw = Math.max(2, Math.floor(window.innerWidth * dpr));
    const ch = Math.max(2, Math.floor(window.innerHeight * dpr));
    if (cw === width && ch === height && sceneFBO) return;
    width = cw;
    height = ch;
    canvas.width = width;
    canvas.height = height;
    buildScreenFBOs(width, height);
  }

  function resizeTerrainGpuMap() {
    if (!gl || !terrainMapTex) return;
    gl.bindTexture(gl.TEXTURE_2D, terrainMapTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TERRAIN.GRID_N, TERRAIN.GRID_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  function rebuildInstancedNature() {
    if (!gl || !grassGpu || !flowerGpu) return;
    const grassInst = NATURE.createGrassInstances();
    gl.bindBuffer(gl.ARRAY_BUFFER, grassGpu.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, grassInst, gl.STATIC_DRAW);

    const flInst = NATURE.createFlowerInstances();
    gl.bindBuffer(gl.ARRAY_BUFFER, flowerGpu.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, flInst, gl.STATIC_DRAW);
  }

  function updateTerrainGpuMap(rgbaBytes) {
    gl.bindTexture(gl.TEXTURE_2D, terrainMapTex);
    if (TERRAIN.consumeGpuTexResize()) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TERRAIN.GRID_N, TERRAIN.GRID_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbaBytes);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TERRAIN.GRID_N, TERRAIN.GRID_N, gl.RGBA, gl.UNSIGNED_BYTE, rgbaBytes);
    }
  }

  function updateParticles(floatData, count) {
    particleGpu.count = count | 0;
    if (particleGpu.count <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, particleGpu.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, floatData);
  }

  // Compute sun vector, sky colors, ambient & fog for any time of day (0..24) & season!
  function computeAtmosphere(timeOfDay, sunAzimuth, seasonObj) {
    // Sun elevation: rises ~5:45, peaks at 12:30, sets ~19:15
    const dayPhase = ((timeOfDay - 6.0) / 13.0) * Math.PI; // 0 at 6:00, PI at 19:00
    const rawElev = Math.sin(dayPhase) * 0.92;
    const sunElev = M.clamp(rawElev, -0.55, 0.92);

    const horizR = Math.cos(Math.asin(M.clamp(sunElev, -0.98, 0.98)));
    const sx = Math.cos(sunAzimuth) * horizR;
    const sz = Math.sin(sunAzimuth) * horizR;
    const sy = Math.max(0.08, Math.abs(sunElev)); // shadow light stays slightly above horizon even at night (moonlight!)
    const sunDir = M.V3.normalize([0, 1, 0], [
      sunElev >= 0 ? sx : -sx,
      sunElev >= 0 ? Math.max(0.11, sunElev) : Math.max(0.28, -sunElev),
      sunElev >= 0 ? sz : -sz
    ]);

    const nightFactor = M.smoothstep(0.14, -0.18, rawElev);
    const sunsetFactor = M.smoothstep(0.45, 0.04, Math.abs(rawElev - 0.08)) * (1.0 - nightFactor * 0.75);

    // Day palette
    let skyZenith = [0.16, 0.38, 0.78];
    let skyHorizon = [0.64, 0.80, 0.95];
    let sunColor = [1.55, 1.38, 1.12];
    let skyAmbient = [0.30, 0.38, 0.52];
    let groundAmbient = [0.22, 0.19, 0.14];

    if (seasonObj.id === 'enchanted') {
      skyZenith = [0.08, 0.24, 0.36];
      skyHorizon = [0.35, 0.58, 0.62];
      sunColor = [1.15, 1.18, 0.95];
      skyAmbient = [0.22, 0.34, 0.38];
    } else if (seasonObj.id === 'autumn') {
      sunColor = [1.68, 1.28, 0.88];
      skyHorizon = [0.76, 0.78, 0.84];
    } else if (seasonObj.id === 'winter') {
      skyZenith = [0.26, 0.44, 0.72];
      skyHorizon = [0.76, 0.84, 0.94];
      skyAmbient = [0.38, 0.45, 0.58];
      groundAmbient = [0.32, 0.35, 0.42];
    }

    // Golden hour / Coral-Violet Sunset blend!
    if (sunsetFactor > 0.001) {
      skyZenith = M.mixColor(skyZenith, [0.18, 0.20, 0.48], sunsetFactor * 0.85);
      skyHorizon = M.mixColor(skyHorizon, [0.98, 0.48, 0.32], sunsetFactor * 0.92);
      sunColor = M.mixColor(sunColor, [2.05, 0.86, 0.38], sunsetFactor * 0.95);
      skyAmbient = M.mixColor(skyAmbient, [0.34, 0.26, 0.38], sunsetFactor * 0.8);
      groundAmbient = M.mixColor(groundAmbient, [0.26, 0.15, 0.12], sunsetFactor * 0.8);
    }

    // Cozy Starry Moonlit Night blend!
    if (nightFactor > 0.001) {
      skyZenith = M.mixColor(skyZenith, [0.025, 0.045, 0.11], nightFactor);
      skyHorizon = M.mixColor(skyHorizon, [0.065, 0.11, 0.22], nightFactor);
      // Cool silver moonlight casts gentle readable shadows at night
      sunColor = M.mixColor(sunColor, [0.20, 0.28, 0.48], nightFactor);
      skyAmbient = M.mixColor(skyAmbient, [0.085, 0.125, 0.22], nightFactor);
      groundAmbient = M.mixColor(groundAmbient, [0.045, 0.055, 0.09], nightFactor);
    }

    const fogColor = M.mixColor(skyHorizon, seasonObj.fogTint.map((c) => Math.pow(c, 2.2)), (1 - nightFactor) * 0.35);

    return {
      sunDir,
      rawSunDir: M.V3.normalize([0, 1, 0], [sx, rawElev, sz]),
      sunColor,
      skyZenith,
      skyHorizon,
      skyAmbient,
      groundAmbient,
      fogColor,
      nightFactor
    };
  }

  function packPointLights(lights, nightFactor) {
    const count = Math.min(20, lights.length);
    const windowScale = 0.15 + nightFactor * 1.45;
    const lanternScale = 0.55 + nightFactor * 1.35;

    for (let i = 0; i < count; i++) {
      const l = lights[i];
      const o = i * 4;
      pointLightPosArr[o] = l.x;
      pointLightPosArr[o + 1] = l.y;
      pointLightPosArr[o + 2] = l.z;
      pointLightPosArr[o + 3] = l.radius;

      const intensity = l.kind === 'lantern' ? lanternScale : windowScale;
      pointLightColArr[o] = l.r;
      pointLightColArr[o + 1] = l.g;
      pointLightColArr[o + 2] = l.b;
      pointLightColArr[o + 3] = intensity;
    }
    return count;
  }

  function bindSolidCommonUniforms(p, viewMat, viewProjMat, eyePos, atm, seasonObj, timeSec, lightCount, cursorRing, cursorColor, hoverBox, clickRipple, fogParams, clipWater) {
    const u = p.u;
    gl.uniformMatrix4fv(u.uViewProj, false, viewProjMat);
    gl.uniformMatrix4fv(u.uView, false, viewMat);
    gl.uniformMatrix4fv(u.uLightViewProj, false, matLightViewProj);
    gl.uniform3fv(u.uCamPos, eyePos);
    gl.uniform3fv(u.uSunDir, atm.sunDir);
    gl.uniform3fv(u.uSunColor, atm.sunColor);
    gl.uniform3fv(u.uSkyAmbient, atm.skyAmbient);
    gl.uniform3fv(u.uGroundAmbient, atm.groundAmbient);
    gl.uniform3fv(u.uFogColor, atm.fogColor);
    gl.uniform3fv(u.uFogParams, fogParams);
    gl.uniform1f(u.uTime, timeSec);
    gl.uniform1f(u.uNightFactor, atm.nightFactor);
    gl.uniform1f(u.uSnowAmount, seasonObj.snowAmount);
    gl.uniform1f(u.uWaterLevel, TERRAIN.WATER_LEVEL);
    gl.uniform1f(u.uClipAboveWater, clipWater ? 1.0 : 0.0);
    gl.uniform1f(u.uPreviewMode, 0.0);

    gl.uniform1i(u.uPointLightCount, lightCount);
    if (lightCount > 0) {
      gl.uniform4fv(u.uPointLightPos, pointLightPosArr);
      gl.uniform4fv(u.uPointLightCol, pointLightColArr);
    }
    gl.uniform4fv(u.uCursorRing, cursorRing);
    gl.uniform4fv(u.uCursorColor, cursorColor);
    gl.uniform4fv(u.uHoverBox, hoverBox);
    gl.uniform4fv(u.uClickRipple, clickRipple);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowDepthTex);
    gl.uniform1i(u.uShadowMap, 0);
  }

  function drawSolidList(names) {
    for (let i = 0; i < names.length; i++) {
      const slot = meshes[names[i]];
      if (slot && slot.count > 0) {
        gl.bindVertexArray(slot.vao);
        gl.drawArrays(gl.TRIANGLES, 0, slot.count);
      }
    }
  }

  function renderSkyPass(invVP, eyePos, atm, timeSec) {
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const p = programs.sky;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uInvViewProj, false, invVP);
    gl.uniform3fv(p.u.uCamPos, eyePos);
    gl.uniform3fv(p.u.uSunDir, atm.rawSunDir);
    gl.uniform3fv(p.u.uSkyZenith, atm.skyZenith);
    gl.uniform3fv(p.u.uSkyHorizon, atm.skyHorizon);
    gl.uniform3fv(p.u.uSunColor, atm.sunColor);
    gl.uniform1f(p.u.uTime, timeSec);
    gl.uniform1f(p.u.uNightFactor, atm.nightFactor);

    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  function render(state) {
    resize();
    const {
      camera,
      timeSec,
      timeOfDay,
      sunAzimuth,
      seasonObj,
      pointLights,
      cursorRing,
      cursorColor,
      hoverBox,
      clickRipple = [0, 0, 0, 0],
      previewMode = 0,
      sheepFlat,
      duckFlat,
      dofAmount,
      focusDist
    } = state;

    const atm = computeAtmosphere(timeOfDay, sunAzimuth, seasonObj);
    const lightCount = packPointLights(pointLights, atm.nightFactor);

    // Orbit-aware distance fog + horizon vista mist
    const fogStart = Math.max(46.0, (camera.dist || 18.0) * 1.32);
    const fogParams = [fogStart, fogStart + 175.0, TERRAIN.HALF_SIZE];

    // Camera matrices (far = 460m covers entire 136m world + +-210m rolling vista!)
    const aspect = width / Math.max(1, height);
    M.Mat4.perspective(matProj, camera.fov * M.DEG2RAD, aspect, 0.35, 460.0);
    M.Mat4.lookAt(matView, camera.eye, camera.target, [0, 1, 0]);
    M.Mat4.multiply(matViewProj, matProj, matView);
    M.Mat4.invert(matInvViewProj, matViewProj);

    // Camera-following texel-snapped Sun Shadow Matrix across any world scale!
    const orthoHalf = M.clamp((camera.dist || 14.0) * 1.05 + 11.0, 22.0, 68.0);
    const snapStep = (orthoHalf * 2.0) / 128.0;
    const shCx = Math.round(camera.target[0] / snapStep) * snapStep;
    const shCz = Math.round(camera.target[2] / snapStep) * snapStep;
    const lightDist = 92.0;
    const lightEye = [
      shCx + atm.sunDir[0] * lightDist,
      atm.sunDir[1] * lightDist,
      shCz + atm.sunDir[2] * lightDist
    ];
    M.Mat4.lookAt(matLightView, lightEye, [shCx, 0, shCz], [0, 1, 0]);
    M.Mat4.ortho(matLightProj, -orthoHalf, orthoHalf, -orthoHalf, orthoHalf, 2.0, 205.0);
    M.Mat4.multiply(matLightViewProj, matLightProj, matLightView);

    // ========================================================================
    // PASS 1: DIRECTIONAL SUN SHADOW MAP (2048x2048)
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const pSh = programs.shadow;
    gl.useProgram(pSh.prog);
    gl.uniformMatrix4fv(pSh.u.uLightViewProj, false, matLightViewProj);
    gl.uniform1f(pSh.u.uTime, timeSec);
    drawSolidList(previewMode === 1
      ? ['terrain', 'buildings', 'walls', 'stamps', 'nature', 'creatures', 'preview']
      : ['terrain', 'buildings', 'walls', 'stamps', 'nature', 'creatures']);

    // ========================================================================
    // PASS 2: PLANAR WATER REFLECTION FBO (640x360)
    // ========================================================================
    if (meshes.water.count > 0) {
      const wy = TERRAIN.WATER_LEVEL;
      const reflEye = [camera.eye[0], 2 * wy - camera.eye[1], camera.eye[2]];
      const reflTarget = [camera.target[0], 2 * wy - camera.target[1], camera.target[2]];
      M.Mat4.lookAt(matReflView, reflEye, reflTarget, [0, 1, 0]);
      M.Mat4.multiply(matReflViewProj, matProj, matReflView);
      M.Mat4.invert(matInvReflViewProj, matReflViewProj);

      gl.bindFramebuffer(gl.FRAMEBUFFER, reflFBO);
      gl.viewport(0, 0, REFL_W, REFL_H);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      renderSkyPass(matInvReflViewProj, reflEye, atm, timeSec);

      gl.useProgram(programs.solid.prog);
      bindSolidCommonUniforms(
        programs.solid, matReflView, matReflViewProj, reflEye,
        atm, seasonObj, timeSec, lightCount,
        [0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], fogParams, true
      );
      drawSolidList(['terrain', 'vista', 'buildings', 'walls', 'stamps', 'nature', 'creatures']);
    }

    // ========================================================================
    // PASS 3: MAIN HDR SCENE MRT PASS (Color + ViewNormal/LinearDepth)
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.viewport(0, 0, width, height);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 3A. Volumetric-style Painterly Sky & Cumulus Clouds
    renderSkyPass(matInvViewProj, camera.eye, atm, timeSec);

    // 3B. Solid Architecture, Terrain, Horizon Vista, Ghibli Trees & Living Creatures
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(programs.solid.prog);
    bindSolidCommonUniforms(
      programs.solid, matView, matViewProj, camera.eye,
      atm, seasonObj, timeSec, lightCount,
      cursorRing, cursorColor, hoverBox, clickRipple, fogParams, false
    );
    drawSolidList(['terrain', 'vista', 'buildings', 'walls', 'stamps', 'nature', 'creatures']);

    if (meshes.preview.count > 0 && previewMode > 0) {
      gl.uniform1f(programs.solid.u.uPreviewMode, previewMode);
      drawSolidList(['preview']);
      gl.uniform1f(programs.solid.u.uPreviewMode, 0.0);
    }

    // 3C. GPU-Instanced 42,000 Wind-Swaying Meadow Grass Blades (Double-sided!)
    gl.disable(gl.CULL_FACE);
    const pGr = programs.grass;
    gl.useProgram(pGr.prog);
    gl.uniformMatrix4fv(pGr.u.uViewProj, false, matViewProj);
    gl.uniformMatrix4fv(pGr.u.uView, false, matView);
    gl.uniformMatrix4fv(pGr.u.uLightViewProj, false, matLightViewProj);
    gl.uniform3fv(pGr.u.uCamPos, camera.eye);
    gl.uniform3fv(pGr.u.uSunDir, atm.sunDir);
    gl.uniform3fv(pGr.u.uSunColor, atm.sunColor);
    gl.uniform3fv(pGr.u.uSkyAmbient, atm.skyAmbient);
    gl.uniform3fv(pGr.u.uGroundAmbient, atm.groundAmbient);
    gl.uniform3fv(pGr.u.uFogColor, atm.fogColor);
    gl.uniform3fv(pGr.u.uFogParams, fogParams);
    gl.uniform3fv(pGr.u.uGrassBase, seasonObj.grassBase);
    gl.uniform3fv(pGr.u.uGrassTip, seasonObj.grassTip);
    gl.uniform1f(pGr.u.uTime, timeSec);
    gl.uniform1f(pGr.u.uSnowAmount, seasonObj.snowAmount);
    gl.uniform1f(pGr.u.uWorldSize, TERRAIN.WORLD_SIZE);
    gl.uniform1f(pGr.u.uHeightMin, TERRAIN.HEIGHT_MIN);
    gl.uniform1f(pGr.u.uHeightSpan, TERRAIN.HEIGHT_SPAN);
    gl.uniform4fv(pGr.u.uCursorRing, cursorRing);
    gl.uniform4fv(pGr.u.uSheepPos, sheepFlat);
    gl.uniform1i(pGr.u.uPointLightCount, lightCount);
    if (lightCount > 0) {
      gl.uniform4fv(pGr.u.uPointLightPos, pointLightPosArr);
      gl.uniform4fv(pGr.u.uPointLightCol, pointLightColArr);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowDepthTex);
    gl.uniform1i(pGr.u.uShadowMap, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, terrainMapTex);
    gl.uniform1i(pGr.u.uTerrainMap, 1);

    gl.bindVertexArray(grassGpu.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, grassGpu.indexCount, gl.UNSIGNED_SHORT, 0, grassGpu.instanceCount);

    // 3D. GPU-Instanced 4,400 Wildflowers (hidden under deep winter snow)
    if (seasonObj.snowAmount < 0.75) {
      const pFl = programs.flower;
      gl.useProgram(pFl.prog);
      gl.uniformMatrix4fv(pFl.u.uViewProj, false, matViewProj);
      gl.uniformMatrix4fv(pFl.u.uView, false, matView);
      gl.uniformMatrix4fv(pFl.u.uLightViewProj, false, matLightViewProj);
      gl.uniform3fv(pFl.u.uCamPos, camera.eye);
      gl.uniform3fv(pFl.u.uSunDir, atm.sunDir);
      gl.uniform3fv(pFl.u.uSunColor, atm.sunColor);
      gl.uniform3fv(pFl.u.uSkyAmbient, atm.skyAmbient);
      gl.uniform3fv(pFl.u.uFogColor, atm.fogColor);
      gl.uniform3fv(pFl.u.uFogParams, fogParams);
      gl.uniform1f(pFl.u.uTime, timeSec);
      gl.uniform1f(pFl.u.uWorldSize, TERRAIN.WORLD_SIZE);
      gl.uniform1f(pFl.u.uHeightMin, TERRAIN.HEIGHT_MIN);
      gl.uniform1f(pFl.u.uHeightSpan, TERRAIN.HEIGHT_SPAN);

      const flCols = new Float32Array(12);
      for (let k = 0; k < 4; k++) {
        const rgb = M.hexToRgb(seasonObj.flowerColors[k % seasonObj.flowerColors.length]);
        flCols[k * 3] = rgb[0]; flCols[k * 3 + 1] = rgb[1]; flCols[k * 3 + 2] = rgb[2];
      }
      gl.uniform3fv(pFl.u.uFlowerColors, flCols);
      gl.uniform1i(pFl.u.uShadowMap, 0);
      gl.uniform1i(pFl.u.uTerrainMap, 1);

      gl.bindVertexArray(flowerGpu.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, flowerGpu.vertCount, flowerGpu.instanceCount);
    }

    // 3E. Crystal Pond & Stream Water Surface (Alpha-Blended)
    if (meshes.water.count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
      const pWa = programs.water;
      gl.useProgram(pWa.prog);
      gl.uniformMatrix4fv(pWa.u.uViewProj, false, matViewProj);
      gl.uniformMatrix4fv(pWa.u.uView, false, matView);
      gl.uniformMatrix4fv(pWa.u.uLightViewProj, false, matLightViewProj);
      gl.uniform3fv(pWa.u.uCamPos, camera.eye);
      gl.uniform3fv(pWa.u.uSunDir, atm.sunDir);
      gl.uniform3fv(pWa.u.uSunColor, atm.sunColor);
      gl.uniform3fv(pWa.u.uSkyAmbient, atm.skyAmbient);
      gl.uniform3fv(pWa.u.uFogColor, atm.fogColor);
      gl.uniform3fv(pWa.u.uFogParams, fogParams);
      gl.uniform3fv(pWa.u.uWaterShallow, seasonObj.waterShallow);
      gl.uniform3fv(pWa.u.uWaterDeep, seasonObj.waterDeep);
      gl.uniform1f(pWa.u.uTime, timeSec);
      gl.uniform4fv(pWa.u.uDuckPos, duckFlat);
      gl.uniform4fv(pWa.u.uCursorRing, cursorRing);
      gl.uniform4fv(pWa.u.uCursorColor, cursorColor);
      gl.uniform4fv(pWa.u.uClickRipple, clickRipple);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, shadowDepthTex);
      gl.uniform1i(pWa.u.uShadowMap, 0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, reflColorTex);
      gl.uniform1i(pWa.u.uReflectionTex, 2);

      gl.bindVertexArray(meshes.water.vao);
      gl.drawArrays(gl.TRIANGLES, 0, meshes.water.count);
      gl.disable(gl.BLEND);
    }

    // 3F. Soft Billboard Particles (Chimney Smoke, Fireflies, Snow, Leaves, Hearts)
    if (particleGpu.count > 0) {
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]); // do not overwrite normalDepth buffer!
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);

      const pPa = programs.particle;
      gl.useProgram(pPa.prog);
      gl.uniformMatrix4fv(pPa.u.uViewProj, false, matViewProj);
      // Extract camera right & up vectors from view matrix
      gl.uniform3f(pPa.u.uCamRight, matView[0], matView[4], matView[8]);
      gl.uniform3f(pPa.u.uCamUp, matView[1], matView[5], matView[9]);

      gl.bindVertexArray(particleGpu.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, particleGpu.count);

      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    }

    // ========================================================================
    // PASS 4: SCREEN-SPACE AMBIENT OCCLUSION (SSAO) + BILATERAL BLUR
    // ========================================================================
    gl.disable(gl.DEPTH_TEST);
    const aoW = Math.max(2, (width * 0.65) | 0);
    const aoH = Math.max(2, (height * 0.65) | 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFBO);
    gl.viewport(0, 0, aoW, aoH);
    const pAo = programs.ssao;
    gl.useProgram(pAo.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneNormalDepthTex);
    gl.uniform1i(pAo.u.uNormalDepthTex, 0);
    gl.uniform2f(pAo.u.uProjScale, 1.0 / matProj[0], 1.0 / matProj[5]);
    gl.uniformMatrix4fv(pAo.u.uProj, false, matProj);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoBlurFBO);
    const pBlur = programs.ssaoBlur;
    gl.useProgram(pBlur.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ssaoTex);
    gl.uniform1i(pBlur.u.uAoTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneNormalDepthTex);
    gl.uniform1i(pBlur.u.uNormalDepthTex, 1);
    gl.uniform2f(pBlur.u.uTexelSize, 1.0 / aoW, 1.0 / aoH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ========================================================================
    // PASS 5: DUAL-KAWASE HDR BLOOM PYRAMID
    // ========================================================================
    const pDown = programs.bloomDown;
    gl.useProgram(pDown.prog);
    let srcTex = sceneColorTex;
    let srcW = width, srcH = height;

    for (let i = 0; i < BLOOM_MIPS; i++) {
      const dstW = Math.max(2, width >> (i + 1));
      const dstH = Math.max(2, height >> (i + 1));
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomDownFBOs[i]);
      gl.viewport(0, 0, dstW, dstH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(pDown.u.uSrcTex, 0);
      gl.uniform2f(pDown.u.uTexelSize, 1.0 / srcW, 1.0 / srcH);
      gl.uniform1f(pDown.u.uThreshold, i === 0 ? 1.05 : 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      srcTex = bloomDownTexs[i];
      srcW = dstW; srcH = dstH;
    }

    const pUp = programs.bloomUp;
    gl.useProgram(pUp.prog);
    srcTex = bloomDownTexs[BLOOM_MIPS - 1];
    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const dstW = Math.max(2, width >> (i + 1));
      const dstH = Math.max(2, height >> (i + 1));
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomUpFBOs[i]);
      gl.viewport(0, 0, dstW, dstH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(pUp.u.uSrcTex, 0);
      gl.uniform2f(pUp.u.uTexelSize, 1.0 / Math.max(2, dstW >> 1), 1.0 / Math.max(2, dstH >> 1));
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Additive blend previous mip
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindTexture(gl.TEXTURE_2D, bloomDownTexs[i]);
      gl.uniform2f(pUp.u.uTexelSize, 0.0, 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);

      srcTex = bloomUpTexs[i];
    }

    // ========================================================================
    // PASS 6: FINAL COMPOSITE (Colored SSAO + Tilt-Shift DoF + Bloom + ACES)
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    const pComp = programs.composite;
    gl.useProgram(pComp.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneColorTex);
    gl.uniform1i(pComp.u.uSceneTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ssaoBlurTex);
    gl.uniform1i(pComp.u.uAoTex, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, bloomUpTexs[0]);
    gl.uniform1i(pComp.u.uBloomTex, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, sceneNormalDepthTex);
    gl.uniform1i(pComp.u.uNormalDepthTex, 3);

    gl.uniform2f(pComp.u.uTexelSize, 1.0 / width, 1.0 / height);
    gl.uniform1f(pComp.u.uDofAmount, dofAmount);
    gl.uniform1f(pComp.u.uFocusDist, focusDist);
    gl.uniform1f(pComp.u.uBloomStrength, 0.34 + atm.nightFactor * 0.24);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    init,
    resize,
    resizeTerrainGpuMap,
    rebuildInstancedNature,
    uploadSolidSlot,
    updateTerrainGpuMap,
    updateParticles,
    render,
    getViewProj: () => matViewProj,
    getInvViewProj: () => matInvViewProj,
    getCanvas: () => canvas
  };
})();
