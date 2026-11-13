// ============================================================================
// shaders.js — WebGL2 (#version 300 es) HDR Stylized Deferred/Multi-Pass Shaders
// ============================================================================

const SHADERS = (() => {

  const COMMON_NOISE = `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 3; i++) {
      v += a * noise2(p);
      p = rot * p * 2.03;
      a *= 0.5;
    }
    return v;
  }
  `;

  const COZY_FOG_GLSL = `
  uniform vec3 uFogParams; // x: fogStartDist, y: fogEndDist, z: halfWorldSize
  float computeCozyFog(vec3 worldPos, float camDist) {
    float distMist = smoothstep(uFogParams.x, uFogParams.y, camDist) * 0.68;
    float domainOutside = max(abs(worldPos.x), abs(worldPos.z)) - uFogParams.z;
    float vistaMist = smoothstep(6.0, 195.0, domainOutside) * 0.84;
    return clamp(max(distMist, vistaMist), 0.0, 0.88);
  }
  `;

  const SHADOW_SAMPLE_GLSL = `
  uniform sampler2D uShadowMap;
  uniform mat4 uLightViewProj;

  float sampleSunShadow(vec3 worldPos, vec3 N, vec3 L) {
    vec3 offsetPos = worldPos + N * 0.055;
    vec4 sc = uLightViewProj * vec4(offsetPos, 1.0);
    vec3 proj = sc.xyz / max(sc.w, 0.0001);
    proj = proj * 0.5 + 0.5;
    if (proj.x <= 0.01 || proj.x >= 0.99 || proj.y <= 0.01 || proj.y >= 0.99 || proj.z >= 0.995) {
      return 1.0;
    }
    float ndl = max(0.0, dot(N, L));
    float bias = mix(0.0022, 0.00045, ndl);
    float currentDepth = proj.z - bias;

    // 12-tap rotated Vogel disk PCF for silky soft miniature shadows
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float rotAng = ign * 6.2831853;
    float radius = 0.00145;
    float sum = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 12.0) * radius;
      float theta = fi * 2.3999632 + rotAng;
      vec2 uv = proj.xy + vec2(cos(theta), sin(theta)) * r;
      float closest = texture(uShadowMap, uv).r;
      sum += (currentDepth <= closest) ? 1.0 : 0.0;
    }
    return sum / 12.0;
  }

  float sampleCloudShadow(vec2 xz, float timeSec, float sunElev) {
    if (sunElev < 0.02) return 1.0;
    vec2 uv = xz * 0.032 + vec2(timeSec * 0.0085, timeSec * 0.0042);
    float c = fbm3(uv);
    return mix(1.0, 0.78, smoothstep(0.52, 0.78, c));
  }
  `;

  // ==========================================================================
  // 1. SHADOW MAP PASS
  // ==========================================================================
  const SHADOW_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPos;
  layout(location = 1) in vec3 aNormal;
  layout(location = 2) in vec3 aColor;
  layout(location = 3) in vec3 aParam;

  uniform mat4 uLightViewProj;
  uniform float uTime;

  void main() {
    vec3 pos = aPos;
    float matId = aParam.x;
    float extra = aParam.z;
    if (abs(matId - 5.0) < 0.2) {
      // Foliage sway
      float w = extra * 0.14;
      pos.x += sin(uTime * 1.7 + aPos.x * 0.7 + aPos.z * 0.5) * w;
      pos.z += cos(uTime * 1.4 + aPos.z * 0.6) * w * 0.7;
    } else if (abs(matId - 8.0) < 0.2) {
      // Banner wave
      pos.z += sin(uTime * 5.2 - extra * 4.5 + aPos.x) * extra * 0.22;
      pos.y += cos(uTime * 4.1 - extra * 3.2) * extra * 0.05;
    }
    gl_Position = uLightViewProj * vec4(pos, 1.0);
  }
  `;

  const SHADOW_FS = `#version 300 es
  precision highp float;
  void main() {}
  `;

  // ==========================================================================
  // 2. PROCEDURAL VOLUMETRIC-STYLE PAINTERLY SKY & CUMULUS CLOUD DOME
  // ==========================================================================
  const SKY_VS = `#version 300 es
  precision highp float;
  out vec2 vUv;
  void main() {
    vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = pos;
    gl_Position = vec4(pos * 2.0 - 1.0, 0.9999, 1.0);
  }
  `;

  const SKY_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  layout(location = 0) out vec4 oColor;
  layout(location = 1) out vec4 oNormalDepth;

  uniform mat4 uInvViewProj;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunColor;
  uniform float uTime;
  uniform float uNightFactor;

  ${COMMON_NOISE}

  float cloudFbm(vec2 p) {
    float v = 0.0;
    float a = 0.52;
    mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 5; i++) {
      v += a * noise2(p);
      p = rot * p * 2.07;
      a *= 0.50;
    }
    return v;
  }

  void main() {
    vec4 ndcNear = vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
    vec4 ndcFar  = vec4(vUv * 2.0 - 1.0,  1.0, 1.0);
    vec4 wNear = uInvViewProj * ndcNear;
    vec4 wFar  = uInvViewProj * ndcFar;
    vec3 dir = normalize(wFar.xyz / wFar.w - wNear.xyz / wNear.w);

    float h = clamp(dir.y, -0.15, 1.0);
    float horizonCurve = pow(1.0 - max(0.0, h), 2.8);
    vec3 sky = mix(uSkyZenith, uSkyHorizon, horizonCurve);

    // Warm golden-rose horizon glow toward sun
    float sunDot = dot(dir, uSunDir);
    float mie = pow(max(0.0, sunDot), 6.0) * (0.35 + 0.45 * horizonCurve);
    sky += uSunColor * mie * (1.0 - uNightFactor * 0.85);

    // Crisp soft sun disc
    float sunDisc = smoothstep(0.9978, 0.9993, sunDot) * (1.0 - uNightFactor);
    sky += uSunColor * sunDisc * 4.5;

    // Night moon & twinkling starfield
    if (uNightFactor > 0.02) {
      vec3 moonDir = normalize(vec3(-uSunDir.x, max(0.32, -uSunDir.y), -uSunDir.z));
      float mDot = dot(dir, moonDir);
      float moonDisc = smoothstep(0.9982, 0.9992, mDot);
      float moonGlow = pow(max(0.0, mDot), 28.0) * 0.35;
      sky += vec3(0.75, 0.86, 1.15) * (moonDisc * 3.2 + moonGlow) * uNightFactor;

      if (dir.y > 0.04) {
        vec2 starUv = dir.xz / (dir.y + 0.35) * 95.0;
        vec2 starCell = floor(starUv);
        vec2 starFrac = fract(starUv) - 0.5;
        float rnd = hash12(starCell);
        if (rnd > 0.968) {
          float d = length(starFrac);
          float twinkle = 0.65 + 0.35 * sin(uTime * 2.8 + rnd * 40.0);
          float star = smoothstep(0.22, 0.02, d) * twinkle * smoothstep(0.04, 0.28, dir.y);
          sky += vec3(0.90, 0.94, 1.0) * star * uNightFactor * 1.4;
        }
      }
    }

    // Painterly fluffy cumulus clouds above horizon!
    if (dir.y > 0.015) {
      vec2 cloudPlane = dir.xz / (dir.y + 0.19);
      vec2 wind = vec2(uTime * 0.014, uTime * 0.006);
      float baseD = cloudFbm(cloudPlane * 0.68 + wind);
      float puffD = cloudFbm(cloudPlane * 1.45 - wind * 0.6);
      float density = smoothstep(0.50, 0.78, baseD * 0.72 + puffD * 0.34);
      density *= smoothstep(0.015, 0.16, dir.y) * smoothstep(7.5, 1.8, length(cloudPlane));

      if (density > 0.005) {
        // Directional sun-step lighting for fluffy cream tops & lavender-blue bellies!
        vec2 sunStep = uSunDir.xz * 0.16;
        float occ = cloudFbm((cloudPlane + sunStep) * 0.68 + wind);
        float lit = clamp(1.0 - max(0.0, occ - baseD) * 3.6, 0.15, 1.0);
        float silver = pow(max(0.0, sunDot), 4.0) * (1.0 - density * 0.55);

        vec3 cloudLitCol = mix(vec3(1.02, 0.99, 0.95), uSunColor * 1.15 + vec3(0.25), 0.38);
        vec3 cloudShadowCol = mix(uSkyZenith * 0.75 + vec3(0.16, 0.17, 0.25), uSkyHorizon * 0.85, 0.45);
        if (uNightFactor > 0.3) {
          cloudLitCol = mix(cloudLitCol, vec3(0.22, 0.28, 0.42), uNightFactor * 0.85);
          cloudShadowCol = mix(cloudShadowCol, vec3(0.07, 0.10, 0.18), uNightFactor * 0.88);
        }
        vec3 cCol = mix(cloudShadowCol, cloudLitCol, lit) + uSunColor * silver * 0.45 * (1.0 - uNightFactor);
        sky = mix(sky, cCol, density * 0.92);
      }
    }

    oColor = vec4(max(sky, vec3(0.0)), 1.0);
    oNormalDepth = vec4(0.0, 1.0, 0.0, 1000.0);
  }
  `;

  // ==========================================================================
  // 3. MAIN SOLID STYLIZED PBR + GOUACHE SHADER
  // ==========================================================================
  const SOLID_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPos;
  layout(location = 1) in vec3 aNormal;
  layout(location = 2) in vec3 aColor;
  layout(location = 3) in vec3 aParam;

  uniform mat4 uViewProj;
  uniform mat4 uView;
  uniform float uTime;

  out vec3 vWorldPos;
  out vec3 vNormal;
  out vec3 vViewNormal;
  out vec3 vColor;
  out vec3 vParam;
  out float vViewDepth;

  void main() {
    vec3 pos = aPos;
    float matId = aParam.x;
    float extra = aParam.z;

    if (abs(matId - 5.0) < 0.2) {
      // Gentle breeze in Ghibli puff canopies & reeds
      float w = extra * 0.13;
      pos.x += sin(uTime * 1.7 + aPos.x * 0.7 + aPos.z * 0.5) * w;
      pos.y += sin(uTime * 2.1 + aPos.x * 1.1) * w * 0.25;
      pos.z += cos(uTime * 1.4 + aPos.z * 0.6) * w * 0.7;
    } else if (abs(matId - 8.0) < 0.2) {
      // Fluttering medieval pennant flag
      pos.z += sin(uTime * 5.2 - extra * 4.5 + aPos.x) * extra * 0.22;
      pos.y += cos(uTime * 4.1 - extra * 3.2) * extra * 0.05;
    }

    vec4 viewPos = uView * vec4(pos, 1.0);
    vWorldPos = pos;
    vNormal = normalize(aNormal);
    vViewNormal = normalize(mat3(uView) * vNormal);
    vColor = aColor;
    vParam = aParam;
    vViewDepth = -viewPos.z;

    gl_Position = uViewProj * vec4(pos, 1.0);
  }
  `;

  const SOLID_FS = `#version 300 es
  precision highp float;

  in vec3 vWorldPos;
  in vec3 vNormal;
  in vec3 vViewNormal;
  in vec3 vColor;
  in vec3 vParam;
  in float vViewDepth;

  layout(location = 0) out vec4 oColor;
  layout(location = 1) out vec4 oNormalDepth;

  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform vec3 uFogColor;
  uniform float uTime;
  uniform float uNightFactor;
  uniform float uSnowAmount;
  uniform float uWaterLevel;
  uniform float uClipAboveWater; // > 0.5 during water reflection pass!

  // Up to 20 warm dynamic point lights (x,y,z,radius) & (r,g,b,intensity)
  uniform int uPointLightCount;
  uniform vec4 uPointLightPos[20];
  uniform vec4 uPointLightCol[20];

  // Interactive 3D brush cursor ring: (x, y, z, radius), uCursorColor (r,g,b,active)
  uniform vec4 uCursorRing;
  uniform vec4 uCursorColor;
  uniform vec4 uHoverBox; // (cx, cz, radius, active)
  uniform vec4 uClickRipple; // (x, z, progress 0..1, active)
  uniform float uPreviewMode; // 0: normal, 1: active drag preview, 2: ghost hover blueprint

  ${COMMON_NOISE}
  ${COZY_FOG_GLSL}
  ${SHADOW_SAMPLE_GLSL}

  void main() {
    if (uClipAboveWater > 0.5 && vWorldPos.y < uWaterLevel - 0.03) {
      discard;
    }

    if (uPreviewMode > 1.5) {
      float pIgn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (pIgn > 0.66) discard;
    }

    float matId = vParam.x;
    float vertAO = clamp(vParam.y, 0.25, 1.15);
    float extra = vParam.z;

    float nearDist = length(vWorldPos - uCamPos);
    if (uClipAboveWater < 0.5 && abs(matId - 5.0) < 0.2 && nearDist < 9.5) {
      float fade = smoothstep(5.2, 9.5, nearDist);
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (ign > fade) discard;
    }

    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCamPos - vWorldPos);
    vec3 L = normalize(uSunDir);

    // Base linear albedo
    vec3 albedo = pow(max(vColor, vec3(0.001)), vec3(2.2));
    float roughness = 0.82;

    // --- PROCEDURAL MICRO-SURFACE DETAIL PER MATERIAL ---
    if (matId < 0.5) {
      // MAT.TERRAIN (0): painterly meadow + path pebbles + shoreline wetness
      float grain = fbm3(vWorldPos.xz * 2.6);
      albedo *= 0.90 + 0.22 * grain;
      if (extra > 0.22) {
        // Painted dirt/cobble road micro-stones
        float cob = noise2(vWorldPos.xz * 9.5);
        albedo *= 0.88 + 0.26 * smoothstep(0.35, 0.75, cob);
        roughness = 0.72;
      }
      // Wet shoreline sheen just above pond level
      float shore = smoothstep(uWaterLevel + 0.16, uWaterLevel - 0.02, vWorldPos.y);
      albedo *= mix(1.0, 0.62, shore);
      roughness = mix(roughness, 0.25, shore);
    }
    else if (matId < 2.5) {
      // MAT.PLASTER (1) & MAT.STONE (2): stucco/mortar + creeping damp moss + winter snow!
      float stucco = fbm3(vWorldPos.xz * 4.5 + vWorldPos.y * 4.5);
      if (matId > 1.5) {
        // Masonry mortar variation
        float brick = noise2(vec2(vWorldPos.x + vWorldPos.z, vWorldPos.y * 2.2) * 3.8 + extra * 7.0);
        albedo *= 0.86 + 0.28 * brick;
        roughness = 0.85;
      } else {
        albedo *= 0.93 + 0.14 * stucco;
        roughness = 0.88;
      }
      // Creeping moss near ground/water on north/shaded faces!
      float lowH = smoothstep(1.15, -0.05, vWorldPos.y - uWaterLevel - 0.35);
      float mossMask = lowH * smoothstep(0.42, 0.75, stucco) * (1.0 - uSnowAmount * 0.8);
      vec3 mossLin = pow(vec3(0.28, 0.46, 0.22), vec3(2.2));
      albedo = mix(albedo, mossLin, mossMask * 0.52);
    }
    else if (matId < 3.5) {
      // MAT.ROOF_TILE (3): ceramic/slate tile sheen & subtle row variation
      float shingle = noise2(vec2((vWorldPos.x + vWorldPos.z) * 6.5, vWorldPos.y * 9.0) + extra * 11.0);
      albedo *= 0.90 + 0.20 * shingle;
      roughness = 0.62;
    }
    else if (matId < 4.5) {
      // MAT.WOOD (4): warm oak grain
      float grain = noise2(vec2(vWorldPos.x * 3.0 + vWorldPos.z * 3.0, vWorldPos.y * 14.0));
      albedo *= 0.88 + 0.24 * grain;
      roughness = 0.76;
    }

    // Seasonal Winter Snow Accumulation on upward-facing roofs, walls, rocks & trees!
    if (uSnowAmount > 0.01 && matId > 0.5 && matId < 5.8) {
      float snowNoise = fbm3(vWorldPos.xz * 1.8);
      float upDot = N.y + (snowNoise - 0.5) * 0.28;
      float snowMask = smoothstep(0.46, 0.72, upDot) * uSnowAmount;
      vec3 snowLin = pow(vec3(0.91, 0.95, 0.99), vec3(2.2));
      albedo = mix(albedo, snowLin, snowMask * 0.90);
      roughness = mix(roughness, 0.75, snowMask);
    }

    // --- EMISSIVE WINDOWS & LANTERNS ---
    if (abs(matId - 6.0) < 0.2) {
      // Cottage Window Pane: reflective cozy dark-teal glass by day -> warm golden candle glow at dusk/night!
      float glowStrength = smoothstep(0.08, 0.58, uNightFactor) * 3.4 + 0.18;
      float flicker = 0.94 + 0.06 * sin(uTime * 3.8 + extra * 25.0);
      vec3 dayGlass = pow(vec3(0.20, 0.30, 0.38), vec3(2.2)) + uSkyAmbient * 0.35;
      vec3 warmCandle = vec3(1.45, 0.78, 0.26) * glowStrength * flicker;
      vec3 col = mix(dayGlass + warmCandle * 0.25, warmCandle, smoothstep(0.05, 0.45, uNightFactor));
      oColor = vec4(col, 1.0);
      oNormalDepth = vec4(vViewNormal, vViewDepth);
      return;
    }
    if (abs(matId - 7.0) < 0.2) {
      // Wrought-iron Lantern Core: always softly warm, bright beacon at dusk/night!
      float flicker = 0.92 + 0.08 * sin(uTime * 5.5 + vWorldPos.x * 7.0);
      float boost = mix(1.4, 4.2, uNightFactor);
      oColor = vec4(vec3(1.5, 0.85, 0.32) * boost * flicker, 1.0);
      oNormalDepth = vec4(vViewNormal, vViewDepth);
      return;
    }

    // --- STYLIZED GHIBLI / TINY GLADE LIGHTING ---
    float shadow = sampleSunShadow(vWorldPos, N, L);
    float cloudSh = sampleCloudShadow(vWorldPos.xz, uTime, L.y);
    float sunVis = shadow * cloudSh;

    // Soft wrap diffuse so sunlit surfaces feel warm and touchable, never harsh
    float ndl = dot(N, L);
    float wrapDiff = clamp((ndl + 0.22) / 1.22, 0.0, 1.0);
    float directDiff = mix(max(0.0, ndl), wrapDiff, 0.45) * sunVis;

    // Hemisphere Sky + Ground Bounce GI
    float skyWeight = N.y * 0.5 + 0.5;
    vec3 hemiAmbient = mix(uGroundAmbient, uSkyAmbient, skyWeight) * vertAO;

    vec3 litColor = albedo * (hemiAmbient + uSunColor * directDiff);

    // Foliage Subsurface Scattering (SSS) when backlit by sun!
    if (abs(matId - 5.0) < 0.2) {
      float backLit = pow(clamp(dot(-V, L), 0.0, 1.0), 3.2) * (0.35 + 0.65 * shadow);
      float leafRim = clamp(0.45 - ndl, 0.0, 1.0) * 0.25;
      litColor += albedo * uSunColor * (backLit * 0.85 + leafRim * sunVis);
    }

    // Fluffy Sheep Wool rim-light!
    if (abs(matId - 9.0) < 0.2) {
      float rim = pow(1.0 - max(0.0, dot(N, V)), 2.6);
      litColor += albedo * (uSunColor * 0.35 + uSkyAmbient * 0.5) * rim * vertAO;
    }

    // Soft specular highlight on roof tiles, wet shores & wood
    vec3 H = normalize(L + V);
    float specPow = mix(48.0, 10.0, roughness);
    float spec = pow(max(0.0, dot(N, H)), specPow) * (1.0 - roughness) * 0.32 * sunVis;
    litColor += uSunColor * spec;

    // --- WARM DYNAMIC POINT LIGHTS (WINDOWS & LANTERNS) ---
    for (int i = 0; i < 20; i++) {
      if (i >= uPointLightCount) break;
      vec4 lp = uPointLightPos[i];
      vec3 toL = lp.xyz - vWorldPos;
      float dist = length(toL);
      if (dist < lp.w) {
        vec3 pDir = toL / max(dist, 0.001);
        float atten = pow(1.0 - dist / lp.w, 2.0);
        float pDiff = clamp(dot(N, pDir) * 0.7 + 0.3, 0.0, 1.0);
        litColor += albedo * uPointLightCol[i].rgb * (uPointLightCol[i].w * atten * pDiff);
      }
    }

    // Subtle highlight tint when hovering/selecting an entity
    if (uHoverBox.w > 0.5) {
      float hd = length(vWorldPos.xz - uHoverBox.xy);
      if (hd < uHoverBox.z && matId > 0.5) {
        float selPulse = 0.08 + 0.03 * sin(uTime * 4.5);
        litColor += vec3(1.1, 0.92, 0.62) * selPulse;
      }
    }

    // Blueprint / Live Construction Preview Warm Rim Glow
    if (uPreviewMode > 0.5) {
      float pRim = pow(1.0 - max(0.0, dot(N, V)), 2.0);
      vec3 bpTint = uPreviewMode > 1.5 ? vec3(1.15, 0.96, 0.68) : vec3(1.08, 0.94, 0.72);
      litColor = mix(litColor, litColor * 1.18 + bpTint * 0.22, uPreviewMode > 1.5 ? 0.55 : 0.28);
      litColor += bpTint * pRim * (uPreviewMode > 1.5 ? 0.55 : 0.32);
    }

    // 3D Interactive Brush Cursor Ring & Subtle Border Guide on Terrain & Structures
    if (uCursorColor.w > 0.5 && uPreviewMode < 0.5) {
      float cd = length(vWorldPos.xz - uCursorRing.xz);
      float ringW = max(0.06, uCursorRing.w * 0.055);
      float ring = smoothstep(ringW, 0.0, abs(cd - uCursorRing.w));
      float inner = smoothstep(uCursorRing.w, 0.0, cd) * 0.10;
      litColor = mix(litColor, uCursorColor.rgb * 1.35, clamp(ring * 0.85 + inner, 0.0, 0.9));

      // Gentle dashed boundary ribbon when cursor approaches playable edge
      float curEdgeDist = uFogParams.z - max(abs(uCursorRing.x), abs(uCursorRing.z));
      if (curEdgeDist < 6.5 && cd < 14.0) {
        float fragEdge = abs(max(abs(vWorldPos.x), abs(vWorldPos.z)) - (uFogParams.z - 0.5));
        float dash = step(0.35, fract((vWorldPos.x + vWorldPos.z) * 0.65));
        float bLine = smoothstep(0.14, 0.02, fragEdge) * dash * smoothstep(6.5, 1.5, curEdgeDist) * smoothstep(14.0, 4.0, cd);
        litColor = mix(litColor, vec3(1.25, 0.95, 0.58), bLine * 0.72);
      }
    }

    // Tactile Ground Click / Place Expanding Golden Ripple
    if (uClickRipple.w > 0.5 && uPreviewMode < 0.5) {
      float rd = length(vWorldPos.xz - uClickRipple.xy);
      float targetR = 0.35 + uClickRipple.z * 3.8;
      float rFade = pow(1.0 - clamp(uClickRipple.z, 0.0, 1.0), 1.65);
      float rBand = smoothstep(0.18, 0.0, abs(rd - targetR)) * rFade;
      litColor += vec3(1.25, 0.98, 0.58) * rBand * 0.65;
    }

    // Orbit-Aware Cozy Aerial Perspective & Distant Horizon Vista Mist
    float camDist = length(vWorldPos - uCamPos);
    float fogFactor = computeCozyFog(vWorldPos, camDist);
    litColor = mix(litColor, uFogColor, fogFactor);

    oColor = vec4(max(litColor, vec3(0.0)), 1.0);
    oNormalDepth = vec4(vViewNormal, vViewDepth);
  }
  `;

  // ==========================================================================
  // 4. GPU-INSTANCED 42,000 MEADOW GRASS BLADES & 4,400 WILDFLOWERS
  // ==========================================================================
  const TERRAIN_FETCH_GLSL = `
  uniform sampler2D uTerrainMap;
  uniform float uWorldSize;
  uniform float uHeightMin;
  uniform float uHeightSpan;

  // Exact 16-bit height + bilinear suppression/flower fetch from RGBA8 map!
  void sampleTerrainMap(vec2 worldXZ, out float outH, out float outSuppress, out float outFlower, out vec3 outNormal) {
    vec2 gridMax = vec2(textureSize(uTerrainMap, 0) - 1);
    vec2 uv = clamp((worldXZ + uWorldSize * 0.5) / uWorldSize, 0.0, 0.9999);
    vec2 gf = uv * gridMax;
    ivec2 i0 = ivec2(floor(gf));
    ivec2 i1 = min(i0 + ivec2(1, 1), ivec2(gridMax));
    vec2 f = fract(gf);

    vec4 t00 = texelFetch(uTerrainMap, ivec2(i0.x, i0.y), 0);
    vec4 t10 = texelFetch(uTerrainMap, ivec2(i1.x, i0.y), 0);
    vec4 t01 = texelFetch(uTerrainMap, ivec2(i0.x, i1.y), 0);
    vec4 t11 = texelFetch(uTerrainMap, ivec2(i1.x, i1.y), 0);

    float h00 = (t00.r * 255.0 * 256.0 + t00.g * 255.0) / 65535.0 * uHeightSpan + uHeightMin;
    float h10 = (t10.r * 255.0 * 256.0 + t10.g * 255.0) / 65535.0 * uHeightSpan + uHeightMin;
    float h01 = (t01.r * 255.0 * 256.0 + t01.g * 255.0) / 65535.0 * uHeightSpan + uHeightMin;
    float h11 = (t11.r * 255.0 * 256.0 + t11.g * 255.0) / 65535.0 * uHeightSpan + uHeightMin;

    outH = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
    outSuppress = mix(mix(t00.b, t10.b, f.x), mix(t01.b, t11.b, f.x), f.y);
    outFlower = mix(mix(t00.a, t10.a, f.x), mix(t01.a, t11.a, f.x), f.y);

    float cell = uWorldSize / gridMax.x;
    float dx = mix(h10 - h00, h11 - h01, f.y);
    float dz = mix(h01 - h00, h11 - h10, f.x);
    outNormal = normalize(vec3(-dx, cell, -dz));
  }
  `;

  const GRASS_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec4 aBlade;     // (bx, by, bz, hFrac)
  layout(location = 1) in vec4 aInstA;     // (wx, wz, scale, yaw)
  layout(location = 2) in float aInstSeed; // (seed)

  uniform mat4 uViewProj;
  uniform mat4 uView;
  uniform float uTime;
  uniform vec4 uCursorRing;
  uniform vec4 uSheepPos[8];

  ${TERRAIN_FETCH_GLSL}

  out vec3 vWorldPos;
  out vec3 vTerrainNormal;
  out vec3 vViewNormal;
  out float vHFrac;
  out float vSeed;
  out float vViewDepth;

  void main() {
    float groundY, suppress, flowerBoost;
    vec3 tNorm;
    sampleTerrainMap(aInstA.xy, groundY, suppress, flowerBoost, tNorm);

    // Smoothly shrink & sink suppressed blades under paths, water & buildings!
    float visScale = clamp(1.0 - smoothstep(0.18, 0.72, suppress), 0.0, 1.0);
    if (visScale <= 0.02) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float c = cos(aInstA.w), s = sin(aInstA.w);
    float bladeH = aInstA.z * visScale * 0.92;
    float bladeW = (0.75 + aInstSeed * 0.45) * min(1.0, visScale * 1.4);

    vec3 local = vec3(aBlade.x * bladeW, aBlade.y * bladeH, aBlade.z * bladeH * 0.65);
    vec3 rotated = vec3(local.x * c - local.z * s, local.y, local.x * s + local.z * c);

    float bendPow = aBlade.w * aBlade.w;

    // Rolling Ghibli meadow wind waves!
    float gustWave = sin(aInstA.x * 0.24 + aInstA.y * 0.16 - uTime * 2.15) * 0.5 + 0.5;
    float flutter = sin(uTime * 3.8 + aInstSeed * 19.0 + aInstA.x * 1.2) * 0.07;
    vec2 windPush = vec2(0.18 + gustWave * 0.24 + flutter, 0.07 + gustWave * 0.10) * bendPow * bladeH;

    // Interactive cursor & sheep grass-parting!
    vec2 pushTotal = windPush;
    vec2 toCur = aInstA.xy - uCursorRing.xz;
    float curD = length(toCur);
    float curR = max(0.85, uCursorRing.w * 0.75);
    if (curD < curR && curD > 0.001) {
      pushTotal += (toCur / curD) * (1.0 - curD / curR) * 0.38 * bendPow;
    }
    for (int i = 0; i < 8; i++) {
      if (uSheepPos[i].w > 0.5) {
        vec2 toS = aInstA.xy - uSheepPos[i].xy;
        float sd = length(toS);
        if (sd < 0.85 && sd > 0.001) {
          pushTotal += (toS / sd) * (1.0 - sd / 0.85) * 0.45 * bendPow;
        }
      }
    }

    vec3 worldPos = vec3(
      aInstA.x + rotated.x + pushTotal.x,
      groundY + rotated.y - length(pushTotal) * 0.22 - 0.02,
      aInstA.y + rotated.z + pushTotal.y
    );

    vec4 viewPos = uView * vec4(worldPos, 1.0);
    vWorldPos = worldPos;
    vTerrainNormal = tNorm;
    vViewNormal = normalize(mat3(uView) * normalize(mix(tNorm, vec3(0.0, 1.0, 0.0), 0.55)));
    vHFrac = aBlade.w;
    vSeed = aInstSeed;
    vViewDepth = -viewPos.z;

    gl_Position = uViewProj * vec4(worldPos, 1.0);
  }
  `;

  const GRASS_FS = `#version 300 es
  precision highp float;

  in vec3 vWorldPos;
  in vec3 vTerrainNormal;
  in vec3 vViewNormal;
  in float vHFrac;
  in float vSeed;
  in float vViewDepth;

  layout(location = 0) out vec4 oColor;
  layout(location = 1) out vec4 oNormalDepth;

  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform vec3 uFogColor;
  uniform vec3 uGrassBase;
  uniform vec3 uGrassTip;
  uniform float uTime;
  uniform float uSnowAmount;
  uniform int uPointLightCount;
  uniform vec4 uPointLightPos[20];
  uniform vec4 uPointLightCol[20];

  ${COMMON_NOISE}
  ${COZY_FOG_GLSL}
  ${SHADOW_SAMPLE_GLSL}

  void main() {
    vec3 baseLin = pow(uGrassBase, vec3(2.2));
    vec3 tipLin  = pow(uGrassTip, vec3(2.2));

    // Subtle meadow patch variation so grass blends seamlessly into terrain!
    float patchN = fbm3(vWorldPos.xz * 0.14);
    vec3 bladeCol = mix(baseLin * 0.82, tipLin * (0.92 + 0.20 * vSeed), smoothstep(0.0, 0.92, vHFrac));
    bladeCol *= 0.88 + 0.24 * patchN;

    if (uSnowAmount > 0.01) {
      vec3 snowLin = pow(vec3(0.90, 0.94, 0.98), vec3(2.2));
      bladeCol = mix(bladeCol, snowLin, uSnowAmount * smoothstep(0.2, 0.85, vHFrac) * 0.82);
    }

    vec3 N = normalize(mix(vTerrainNormal, vec3(0.0, 1.0, 0.0), 0.35));
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(uCamPos - vWorldPos);

    float shadow = sampleSunShadow(vWorldPos, N, L);
    float cloudSh = sampleCloudShadow(vWorldPos.xz, uTime, L.y);
    float sunVis = shadow * cloudSh;

    float rootAO = mix(0.56, 1.08, vHFrac);
    float diff = clamp(dot(N, L) * 0.65 + 0.35, 0.0, 1.0) * sunVis;
    float sss = pow(clamp(dot(-V, L), 0.0, 1.0), 2.8) * vHFrac * (0.4 + 0.6 * shadow);

    vec3 amb = mix(uGroundAmbient, uSkyAmbient, 0.68) * rootAO;
    vec3 col = bladeCol * (amb + uSunColor * (diff + sss * 0.72));

    for (int i = 0; i < 12; i++) {
      if (i >= uPointLightCount) break;
      vec4 lp = uPointLightPos[i];
      vec3 toL = lp.xyz - vWorldPos;
      float d = length(toL);
      if (d < lp.w) {
        float att = pow(1.0 - d / lp.w, 2.0);
        col += bladeCol * uPointLightCol[i].rgb * (uPointLightCol[i].w * att * 0.75);
      }
    }

    float camDist = length(vWorldPos - uCamPos);
    col = mix(col, uFogColor, computeCozyFog(vWorldPos, camDist));

    oColor = vec4(col, 1.0);
    oNormalDepth = vec4(vViewNormal, vViewDepth);
  }
  `;

  // Wildflower Instanced Shader
  const FLOWER_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec4 aVert;      // (vx, vy, vz, partFlag)
  layout(location = 1) in vec4 aInstA;     // (wx, wz, scale, yaw)
  layout(location = 2) in float aInstSeed;

  uniform mat4 uViewProj;
  uniform mat4 uView;
  uniform float uTime;

  ${TERRAIN_FETCH_GLSL}

  out vec3 vWorldPos;
  out vec3 vViewNormal;
  out float vPartFlag;
  out float vSeed;
  out float vViewDepth;

  void main() {
    float groundY, suppress, flowerBoost;
    vec3 tNorm;
    sampleTerrainMap(aInstA.xy, groundY, suppress, flowerBoost, tNorm);

    // Show flowers where not suppressed and where natural/painted flowerMask allows!
    float allow = step(aInstSeed * 0.68, flowerBoost + 0.16) * (1.0 - smoothstep(0.12, 0.45, suppress));
    if (allow < 0.05) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float c = cos(aInstA.w), s = sin(aInstA.w);
    float sc = aInstA.z * allow;
    vec3 lp = aVert.xyz * sc;
    vec3 rot = vec3(lp.x * c - lp.z * s, lp.y, lp.x * s + lp.z * c);

    float sway = smoothstep(0.0, 0.35, aVert.y);
    rot.x += sin(uTime * 2.4 + aInstA.x + aInstSeed * 12.0) * 0.06 * sway;
    rot.z += cos(uTime * 2.0 + aInstA.y) * 0.04 * sway;

    vec3 worldPos = vec3(aInstA.x + rot.x, groundY + rot.y - 0.02, aInstA.y + rot.z);
    vec4 viewPos = uView * vec4(worldPos, 1.0);

    vWorldPos = worldPos;
    vViewNormal = normalize(mat3(uView) * vec3(0.0, 1.0, 0.0));
    vPartFlag = aVert.w;
    vSeed = aInstSeed;
    vViewDepth = -viewPos.z;
    gl_Position = uViewProj * vec4(worldPos, 1.0);
  }
  `;

  const FLOWER_FS = `#version 300 es
  precision highp float;
  in vec3 vWorldPos;
  in vec3 vViewNormal;
  in float vPartFlag;
  in float vSeed;
  in float vViewDepth;

  layout(location = 0) out vec4 oColor;
  layout(location = 1) out vec4 oNormalDepth;

  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uFogColor;
  uniform vec3 uFlowerColors[4];
  uniform float uTime;

  ${COMMON_NOISE}
  ${COZY_FOG_GLSL}
  ${SHADOW_SAMPLE_GLSL}

  void main() {
    vec3 srgbCol;
    if (vPartFlag < 0.5) {
      srgbCol = vec3(0.26, 0.50, 0.21);
    } else if (vPartFlag > 1.5) {
      srgbCol = vec3(0.96, 0.78, 0.22);
    } else {
      int idx = int(mod(floor(vSeed * 16.0), 4.0));
      srgbCol = uFlowerColors[idx];
    }
    vec3 albedo = pow(srgbCol, vec3(2.2));
    vec3 N = vec3(0.0, 1.0, 0.0);
    vec3 L = normalize(uSunDir);
    float shadow = sampleSunShadow(vWorldPos, N, L);
    vec3 col = albedo * (uSkyAmbient * 0.95 + uSunColor * max(0.2, dot(N, L)) * shadow * 0.95);

    float camDist = length(vWorldPos - uCamPos);
    col = mix(col, uFogColor, computeCozyFog(vWorldPos, camDist));

    oColor = vec4(col, 1.0);
    oNormalDepth = vec4(vViewNormal, vViewDepth);
  }
  `;

  // ==========================================================================
  // 5. CRYSTAL POND & STREAM WATER SHADER (WITH PLANAR REFLECTION & FOAM)
  // ==========================================================================
  const WATER_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPos;
  layout(location = 1) in vec3 aNormal;
  layout(location = 2) in vec3 aColor;
  layout(location = 3) in vec3 aParam;

  uniform mat4 uViewProj;
  uniform mat4 uView;

  out vec3 vWorldPos;
  out vec4 vClipPos;
  out float vWaterDepth;
  out float vViewDepth;
  out vec3 vViewNormal;

  void main() {
    vec4 viewPos = uView * vec4(aPos, 1.0);
    vec4 clip = uViewProj * vec4(aPos, 1.0);
    vWorldPos = aPos;
    vClipPos = clip;
    vWaterDepth = aParam.y;
    vViewDepth = -viewPos.z;
    vViewNormal = normalize(mat3(uView) * vec3(0.0, 1.0, 0.0));
    gl_Position = clip;
  }
  `;

  const WATER_FS = `#version 300 es
  precision highp float;

  in vec3 vWorldPos;
  in vec4 vClipPos;
  in float vWaterDepth;
  in float vViewDepth;
  in vec3 vViewNormal;

  layout(location = 0) out vec4 oColor;
  layout(location = 1) out vec4 oNormalDepth;

  uniform sampler2D uReflectionTex;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uFogColor;
  uniform vec3 uWaterShallow;
  uniform vec3 uWaterDeep;
  uniform float uTime;
  uniform vec4 uDuckPos[6];
  uniform vec4 uCursorRing;
  uniform vec4 uCursorColor;
  uniform vec4 uClickRipple;

  ${COMMON_NOISE}
  ${COZY_FOG_GLSL}
  ${SHADOW_SAMPLE_GLSL}

  void main() {
    if (vWaterDepth <= 0.002) {
      discard;
    }

    // Dual-scrolling gentle pond ripples
    vec2 p = vWorldPos.xz;
    float w1 = noise2(p * 2.8 + vec2(uTime * 0.42, uTime * 0.28));
    float w2 = noise2(p * 5.2 - vec2(uTime * 0.35, -uTime * 0.31));
    float waveH = (w1 - 0.5) * 0.5 + (w2 - 0.5) * 0.35;

    // Expanding concentric ripples around swimming pond ducks!
    float duckFoam = 0.0;
    for (int i = 0; i < 6; i++) {
      if (uDuckPos[i].z > 0.5) {
        float dd = length(p - uDuckPos[i].xy);
        if (dd < 1.6) {
          float ring = sin(dd * 15.0 - uTime * 5.5) * exp(-dd * 2.2);
          waveH += ring * 0.25;
          duckFoam += max(0.0, ring) * smoothstep(1.2, 0.15, dd) * 0.35;
        }
      }
    }

    vec3 N = normalize(vec3(
      dFdx(waveH) * 2.2,
      1.0,
      dFdy(waveH) * 2.2
    ));
    vec3 V = normalize(uCamPos - vWorldPos);
    vec3 L = normalize(uSunDir);

    // Planar reflection lookup (mirror Y across water horizon: reflUv.y = 1.0 - screenUv.y!)
    vec2 screenUv = (vClipPos.xy / max(vClipPos.w, 0.0001)) * 0.5 + 0.5;
    vec2 reflUv = clamp(vec2(screenUv.x, 1.0 - screenUv.y) + N.xz * 0.028, vec2(0.004), vec2(0.996));
    vec3 reflCol = texture(uReflectionTex, reflUv).rgb;

    // Beer-Lambert shallow turquoise -> deep emerald water body color
    vec3 shallowLin = pow(uWaterShallow, vec3(2.2));
    vec3 deepLin    = pow(uWaterDeep, vec3(2.2));
    float depthFactor = 1.0 - exp(-vWaterDepth * 1.85);
    float shadow = sampleSunShadow(vWorldPos, vec3(0.0, 1.0, 0.0), L);
    vec3 bodyCol = mix(shallowLin, deepLin, depthFactor) * (uSkyAmbient * 0.85 + uSunColor * (0.35 + 0.65 * shadow) * 0.55);

    // Schlick Fresnel blend between crystal water body & sky/castle mirror reflection!
    float fresnel = 0.06 + 0.88 * pow(1.0 - max(0.0, dot(N, V)), 3.8);
    vec3 waterCol = mix(bodyCol, reflCol, clamp(fresnel, 0.08, 0.88));

    // Sparkling sun specular glints on water ripples!
    vec3 H = normalize(L + V);
    float spec = pow(max(0.0, dot(N, H)), 140.0) * shadow * 2.4;
    waterCol += uSunColor * spec;

    // Animated stylized Tiny Glade shoreline foam rings!
    float foamNoise = noise2(p * 4.5 + uTime * 0.3);
    float shoreWave = sin(vWaterDepth * 26.0 - uTime * 2.6 + foamNoise * 3.0);
    float shoreFoam = smoothstep(0.16, 0.01, vWaterDepth) * smoothstep(0.15, 0.65, shoreWave * 0.5 + 0.5);
    float edgeLine = smoothstep(0.035, 0.004, vWaterDepth) * 0.75;
    vec3 foamCol = (uSkyAmbient + uSunColor * 0.65) * 0.92;
    waterCol = mix(waterCol, foamCol, clamp(shoreFoam * 0.65 + edgeLine + duckFoam, 0.0, 0.88));

    // Smooth feathering right at sub-centimeter shoreline edge
    float alpha = smoothstep(0.002, 0.045, vWaterDepth);

    // Interactive 3D Brush Ring & Click Ripple on Water Surface!
    if (uCursorColor.w > 0.5) {
      float cd = length(vWorldPos.xz - uCursorRing.xz);
      float ringW = max(0.06, uCursorRing.w * 0.055);
      float ring = smoothstep(ringW, 0.0, abs(cd - uCursorRing.w));
      waterCol = mix(waterCol, uCursorColor.rgb * 1.4, ring * 0.85);
      alpha = max(alpha, ring * 0.85);
    }
    if (uClickRipple.w > 0.5) {
      float rd = length(vWorldPos.xz - uClickRipple.xy);
      float targetR = 0.35 + uClickRipple.z * 4.2;
      float rFade = pow(1.0 - clamp(uClickRipple.z, 0.0, 1.0), 1.5);
      float rBand = smoothstep(0.22, 0.0, abs(rd - targetR)) * rFade;
      waterCol += vec3(1.1, 1.05, 0.85) * rBand * 0.75;
    }

    float camDist = length(vWorldPos - uCamPos);
    waterCol = mix(waterCol, uFogColor, computeCozyFog(vWorldPos, camDist));

    oColor = vec4(waterCol, alpha);
    oNormalDepth = vec4(vViewNormal, vViewDepth);
  }
  `;

  // ==========================================================================
  // 6. BILLBOARD PARTICLE SHADER (SMOKE, FIREFLIES, PETALS, SNOW, HEARTS)
  // ==========================================================================
  const PARTICLE_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 aCorner; // (-1..1, -1..1)
  layout(location = 1) in vec4 aPartPosSize; // (x, y, z, size)
  layout(location = 2) in vec4 aPartColor;   // (r, g, b, alpha)

  uniform mat4 uViewProj;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;

  out vec2 vCorner;
  out vec4 vColor;

  void main() {
    vec3 worldPos = aPartPosSize.xyz
      + uCamRight * (aCorner.x * aPartPosSize.w)
      + uCamUp * (aCorner.y * aPartPosSize.w);
    vCorner = aCorner;
    vColor = aPartColor;
    gl_Position = uViewProj * vec4(worldPos, 1.0);
  }
  `;

  const PARTICLE_FS = `#version 300 es
  precision highp float;
  in vec2 vCorner;
  in vec4 vColor;
  layout(location = 0) out vec4 oColor;

  void main() {
    float r = length(vCorner);
    if (r > 1.0) discard;
    float soft = pow(1.0 - r * r, 1.8);
    oColor = vec4(vColor.rgb, vColor.a * soft);
  }
  `;

  // ==========================================================================
  // 7. POST-PROCESSING: SSAO, BILATERAL BLUR, DUAL-KAWASE BLOOM & COMPOSITE
  // ==========================================================================
  const QUAD_VS = `#version 300 es
  precision highp float;
  out vec2 vUv;
  void main() {
    vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = pos;
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  }
  `;

  // Screen-Space Ambient Occlusion (reconstructs view pos from linear depth!)
  const SSAO_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 oAo;

  uniform sampler2D uNormalDepthTex;
  uniform vec2 uProjScale; // (1/proj[0], 1/proj[5])
  uniform mat4 uProj;

  vec3 getViewPos(vec2 uv, float linearDepth) {
    vec2 ndc = uv * 2.0 - 1.0;
    return vec3(ndc * uProjScale * linearDepth, -linearDepth);
  }

  void main() {
    vec4 nd = texture(uNormalDepthTex, vUv);
    float centerDepth = nd.w;
    if (centerDepth > 420.0 || centerDepth <= 0.05) {
      oAo = vec4(1.0);
      return;
    }

    vec3 P = getViewPos(vUv, centerDepth);
    vec3 N = normalize(nd.xyz);

    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float rot = ign * 6.2831853;

    float radius = 0.58;
    float occ = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float ang = fi * 2.3999632 + rot;
      float h = (fi + 0.5) / 12.0;
      float r = sqrt(1.0 - h * h);
      vec3 dir = vec3(cos(ang) * r, sin(ang) * r, h);
      // Orient hemisphere sample into normal half-space
      if (dot(dir, N) < 0.0) dir = -dir;
      dir = normalize(dir + N * 0.35);

      vec3 samplePos = P + dir * (radius * (0.25 + 0.75 * fract(fi * 0.618 + ign)));
      vec4 clip = uProj * vec4(samplePos, 1.0);
      vec2 suv = (clip.xy / max(clip.w, 0.0001)) * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;

      float sampleD = texture(uNormalDepthTex, suv).w;
      float sampleZ = -sampleD;
      float rangeCheck = smoothstep(0.0, 1.0, radius / max(0.02, abs(P.z - sampleZ)));
      occ += (sampleZ >= samplePos.z + 0.035 ? 1.0 : 0.0) * rangeCheck;
    }

    float ao = clamp(1.0 - (occ / 12.0) * 1.18, 0.22, 1.0);
    oAo = vec4(ao, ao, ao, 1.0);
  }
  `;

  // Depth-aware bilateral blur for silky noise-free SSAO
  const SSAO_BLUR_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 oAo;

  uniform sampler2D uAoTex;
  uniform sampler2D uNormalDepthTex;
  uniform vec2 uTexelSize;

  void main() {
    float centerD = texture(uNormalDepthTex, vUv).w;
    if (centerD > 420.0) {
      oAo = vec4(1.0);
      return;
    }
    float sum = 0.0;
    float wSum = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 uv = vUv + vec2(float(x), float(y)) * uTexelSize;
        float ao = texture(uAoTex, uv).r;
        float d = texture(uNormalDepthTex, uv).w;
        float w = exp(-abs(d - centerD) * 2.5 - float(x * x + y * y) * 0.18);
        sum += ao * w;
        wSum += w;
      }
    }
    float res = sum / max(wSum, 0.0001);
    oAo = vec4(res, res, res, 1.0);
  }
  `;

  // HDR Bloom Downsample (with optional soft-knee threshold on first pass)
  const BLOOM_DOWN_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 oBloom;

  uniform sampler2D uSrcTex;
  uniform vec2 uTexelSize;
  uniform float uThreshold;

  vec3 prefilter(vec3 c) {
    if (uThreshold <= 0.0) return c;
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + 0.45, 0.0, 0.90);
    soft = (soft * soft) / 1.80;
    float contrib = max(soft, br - uThreshold) / max(br, 0.0001);
    return c * max(0.0, contrib);
  }

  void main() {
    vec2 h = uTexelSize * 0.5;
    vec3 c = prefilter(texture(uSrcTex, vUv).rgb) * 4.0;
    c += prefilter(texture(uSrcTex, vUv - h).rgb);
    c += prefilter(texture(uSrcTex, vUv + h).rgb);
    c += prefilter(texture(uSrcTex, vUv + vec2(h.x, -h.y)).rgb);
    c += prefilter(texture(uSrcTex, vUv + vec2(-h.x, h.y)).rgb);
    oBloom = vec4(c / 8.0, 1.0);
  }
  `;

  // Dual-Kawase Bloom Upsample
  const BLOOM_UP_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 oBloom;

  uniform sampler2D uSrcTex;
  uniform vec2 uTexelSize;

  void main() {
    vec2 d = uTexelSize;
    vec3 sum = vec3(0.0);
    sum += texture(uSrcTex, vUv + vec2(-d.x * 2.0, 0.0)).rgb;
    sum += texture(uSrcTex, vUv + vec2(-d.x, d.y)).rgb * 2.0;
    sum += texture(uSrcTex, vUv + vec2(0.0, d.y * 2.0)).rgb;
    sum += texture(uSrcTex, vUv + vec2(d.x, d.y)).rgb * 2.0;
    sum += texture(uSrcTex, vUv + vec2(d.x * 2.0, 0.0)).rgb;
    sum += texture(uSrcTex, vUv + vec2(d.x, -d.y)).rgb * 2.0;
    sum += texture(uSrcTex, vUv + vec2(0.0, -d.y * 2.0)).rgb;
    sum += texture(uSrcTex, vUv + vec2(-d.x, -d.y)).rgb * 2.0;
    oBloom = vec4(sum / 12.0, 1.0);
  }
  `;

  // Final Composite: Colored SSAO + Miniature Tilt-Shift DoF + HDR Bloom + Cozy ACES Tone Mapping
  const COMPOSITE_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 oFinal;

  uniform sampler2D uSceneTex;
  uniform sampler2D uAoTex;
  uniform sampler2D uBloomTex;
  uniform sampler2D uNormalDepthTex;
  uniform vec2 uTexelSize;
  uniform float uDofAmount;
  uniform float uFocusDist;
  uniform float uBloomStrength;

  vec3 acesCozy(vec3 x) {
    // Warm cozy filmic curve preserving rich pastel sky & terracotta tones
    const float a = 2.45;
    const float b = 0.04;
    const float c = 2.38;
    const float d = 0.56;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  vec3 sampleSceneWithAo(vec2 uv) {
    vec3 hdr = texture(uSceneTex, uv).rgb;
    float ao = texture(uAoTex, uv).r;
    // Colored Stylized AO: shadows in Tiny Glade are warm slate-violet, never muddy black!
    vec3 aoTint = mix(vec3(0.32, 0.30, 0.42), vec3(1.0), ao);
    return hdr * aoTint;
  }

  void main() {
    float centerDepth = texture(uNormalDepthTex, vUv).w;
    vec3 color = sampleSceneWithAo(vUv);

    // Miniature Diorama Tilt-Shift Depth of Field!
    if (uDofAmount > 0.01) {
      float coc = clamp(abs(centerDepth - uFocusDist) / max(8.0, uFocusDist * 0.62), 0.0, 1.0);
      // Combine depth CoC with gentle top/bottom tilt-shift miniature lens band!
      float tiltBand = pow(abs(vUv.y - 0.52) * 1.65, 2.2) * 0.42;
      float blurFactor = clamp(max(coc * 0.85, tiltBand) * uDofAmount, 0.0, 1.0);

      if (blurFactor > 0.03) {
        vec3 acc = color;
        float wSum = 1.0;
        float maxRad = blurFactor * 6.5;
        for (int i = 0; i < 12; i++) {
          float fi = float(i);
          float r = sqrt((fi + 0.5) / 12.0) * maxRad;
          float ang = fi * 2.3999632;
          vec2 suv = clamp(vUv + vec2(cos(ang), sin(ang)) * uTexelSize * r, vec2(0.002), vec2(0.998));
          float sd = texture(uNormalDepthTex, suv).w;
          float sCoc = clamp(abs(sd - uFocusDist) / max(8.0, uFocusDist * 0.62), 0.0, 1.0);
          // Prevent sharp foreground bleeding onto blurry background
          float w = (sd < centerDepth - 1.2) ? sCoc : 1.0;
          acc += sampleSceneWithAo(suv) * w;
          wSum += w;
        }
        color = acc / wSum;
      }
    }

    // Add dreamy Dual-Kawase HDR Bloom
    vec3 bloom = texture(uBloomTex, vUv).rgb;
    color += bloom * uBloomStrength;

    // Warm cozy exposure & saturation lift
    color *= 1.08;
    vec3 mapped = acesCozy(color);

    // Gentle saturation boost in midtones for storybook gouache vibrancy
    float luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
    mapped = mix(vec3(luma), mapped, 1.14);

    // Linear -> sRGB gamma
    vec3 srgb = pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2));

    // Soft warm parchment vignette
    vec2 vigUv = vUv - 0.5;
    float vig = 1.0 - dot(vigUv, vigUv) * 0.36;
    srgb *= mix(vec3(0.94, 0.90, 0.88), vec3(1.0), clamp(vig, 0.0, 1.0));

    // Subtle paper grain to prevent 8-bit sky banding
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
    srgb += dither * (1.2 / 255.0);

    oFinal = vec4(clamp(srgb, 0.0, 1.0), 1.0);
  }
  `;

  return {
    SHADOW_VS, SHADOW_FS,
    SKY_VS, SKY_FS,
    SOLID_VS, SOLID_FS,
    GRASS_VS, GRASS_FS,
    FLOWER_VS, FLOWER_FS,
    WATER_VS, WATER_FS,
    PARTICLE_VS, PARTICLE_FS,
    QUAD_VS,
    SSAO_FS, SSAO_BLUR_FS,
    BLOOM_DOWN_FS, BLOOM_UP_FS,
    COMPOSITE_FS
  };
})();
