// ============================================================================
// ui.js — Tiny Glade v2 Cozy Workshop HUD, Unified Map Workshop,
//         6-Slot Save Gallery, 3D Gizmos & World Feedback Overlays
// ============================================================================

const UI = (() => {
  const LEGACY_STORAGE_KEY = 'TINY_GLADE_OFFLINE_SAVE_V1';
  const SLOTS_STORAGE_KEY = 'TINY_GLADE_SLOTS_V2';
  const SLOT_COUNT = 6;
  const POPOVER_IDS = ['modal-map-workshop', 'modal-save', 'modal-help'];

  let toastTimer = null;
  const gizmoDomMap = {};
  const badgePool = [];

  // Map Workshop draft creator state
  const wsDraft = {
    worldSize: 96,
    archetype: 'river_valley',
    season: 'summer',
    treeDensity: 1.0,
    waterAmount: 1.0,
    seed: 20268
  };

  function $(id) {
    return document.getElementById(id);
  }

  // Bespoke inline SVGs (zero xmlns URLs for 100% offline purity)
  const SVG_ICONS = {
    sun: `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="9" r="3.4" fill="currentColor" fill-opacity="0.25"/><path d="M9 1.8 V3.4 M9 14.6 V16.2 M1.8 9 H3.4 M14.6 9 H16.2 M3.9 3.9 L5.1 5.1 M12.9 12.9 L14.1 14.1 M14.1 3.9 L12.9 5.1 M5.1 12.9 L3.9 14.1"/></svg>`,
    dusk: `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 13.5 H16 M4.8 13.5 A4.2 4.2 0 0 1 13.2 13.5" fill="currentColor" fill-opacity="0.25"/><path d="M9 3.5 V5.5 M3.8 7.5 L5.2 8.8 M14.2 7.5 L12.8 8.8"/></svg>`,
    moon: `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.8 11.6 A5.5 5.5 0 0 1 6.4 4.2 A5.6 5.6 0 1 0 13.8 11.6 Z" fill="currentColor" fill-opacity="0.25"/></svg>`,
    audioOn: `<svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7 H6.2 L10.2 3.8 V14.2 L6.2 11 H3 Z" fill="currentColor" fill-opacity="0.2"/><path d="M12.6 6.4 A3.6 3.6 0 0 1 12.6 11.6 M14.5 4.5 A6.2 6.2 0 0 1 14.5 13.5"/></svg>`,
    audioOff: `<svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7 H6.2 L10.2 3.8 V14.2 L6.2 11 H3 Z"/><path d="M12.5 6.8 L16 11.2 M16 6.8 L12.5 11.2"/></svg>`,
    biome_clearing: `<svg viewBox="0 0 28 20" width="24" height="17" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 15 Q9 9 16 14 T26 13" stroke-linecap="round"/><circle cx="8" cy="8" r="2.5" fill="currentColor" fill-opacity="0.25"/></svg>`,
    biome_river_valley: `<svg viewBox="0 0 28 20" width="24" height="17" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 17 C11 13 8 7 16 5 C21 4 21 10 25 3" stroke-linecap="round"/><path d="M9 18 C15 14 13 9 20 7" opacity="0.55" stroke-linecap="round"/></svg>`,
    biome_lake_islands: `<svg viewBox="0 0 28 20" width="24" height="17" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="14" cy="11" rx="10.5" ry="5.5"/><path d="M10 11.5 Q14 6.5 18 11.5 Z" fill="currentColor" fill-opacity="0.3"/></svg>`,
    biome_highland_terraces: `<svg viewBox="0 0 28 20" width="24" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 16 H8 V12 H15 V7.5 H23 V16 H26"/></svg>`,
    biome_twin_brooks: `<svg viewBox="0 0 28 20" width="24" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4 Q11 9 14 11 M24 4 Q17 9 14 11 M14 11 V17.5"/></svg>`,
    biome_ancient_ruins: `<svg viewBox="0 0 28 20" width="24" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M5 16 V7 H9 V10 H13 V5 H17 V16 M20 16 V10.5 H23.5 V16"/><path d="M3 16 H25"/></svg>`
  };

  function showToast(text, duration = 2400) {
    const el = $('toast-msg');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  function formatTimeHHMM(val) {
    const h = Math.floor(val) % 24;
    const m = Math.floor((val - Math.floor(val)) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function timePhaseSvg(val) {
    if (val < 5.5 || val >= 19.3) return SVG_ICONS.moon;
    if (val < 8.0 || val >= 16.2) return SVG_ICONS.dusk;
    return SVG_ICONS.sun;
  }

  function syncTimeDisplayOnly() {
    const t = GAME.getTimeOfDay();
    $('time-label').textContent = formatTimeHHMM(t);
    $('time-icon').innerHTML = timePhaseSvg(t);
    $('slider-time').value = t;
    $('slider-photo-time').value = t;
  }

  function syncAtmosphereControls() {
    syncTimeDisplayOnly();
    const sId = GAME.getSeasonId();
    document.querySelectorAll('#season-bar button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.season === sId);
    });
    $('btn-autocycle').classList.toggle('active', GAME.isAutoCycle());
    $('slider-azimuth').value = GAME.getSunAzimuth();
  }

  function refreshStats() {
    const st = GAME.getStats();
    const parts = [`小屋 ${st.buildings}`];
    if (st.arches > 0) parts.push(`石拱 ${st.arches}`);
    if (st.bridges > 0) parts.push(`木桥 ${st.bridges}`);
    parts.push(`绵羊 ${st.sheep}`);
    $('glade-stats').textContent = parts.join(' · ');
  }

  function updateHistoryButtons() {
    $('btn-undo').disabled = !GAME.canUndo();
    $('btn-redo').disabled = !GAME.canRedo();
  }

  // ==========================================================================
  // MAP BADGES & MAP WORKSHOP MODAL
  // ==========================================================================
  function syncMapBadges() {
    const cfg = GAME.getMapConfig();
    const canExp = GAME.canExpandMap();
    $('map-scale-label').textContent = `${cfg.badge} ${cfg.name}`;
    const tagEl = $('map-expand-tag');
    if (canExp) {
      tagEl.textContent = '扩建 ↗';
      tagEl.classList.remove('hidden');
    } else {
      tagEl.textContent = '最大疆域';
      tagEl.classList.remove('hidden');
    }
    renderExpandTabContent();
  }

  function setWorkshopTab(tabName) {
    document.querySelectorAll('#modal-map-workshop .ws-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.wsTab === tabName);
    });
    $('ws-pane-create').classList.toggle('hidden', tabName !== 'create');
    $('ws-pane-expand').classList.toggle('hidden', tabName !== 'expand');
    $('ws-pane-presets').classList.toggle('hidden', tabName !== 'presets');
    if (tabName === 'expand') renderExpandTabContent();
  }

  function openMapWorkshop(defaultTab = null) {
    const modal = $('modal-map-workshop');
    const wasOpen = !modal.classList.contains('hidden');
    if (wasOpen && !defaultTab) {
      modal.classList.add('hidden');
      AUDIO.playUiClick(false);
      return;
    }
    closeAllPopovers();
    const chosenTab = defaultTab || (GAME.canExpandMap() ? 'create' : 'create');
    setWorkshopTab(chosenTab);
    modal.classList.remove('hidden');
    AUDIO.playUiClick(true);
  }

  function renderWorkshopCreateControls() {
    // 1. Scale cards
    const sizeGrid = $('ws-size-cards');
    sizeGrid.innerHTML = '';
    const relAreas = { 60: '1× 精致', 96: '2.5× 推荐', 136: '5.1× 史诗' };
    PALETTES.MAP_SIZES.forEach((ms) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ws-size-card' + (wsDraft.worldSize === ms.worldSize ? ' active' : '');
      card.innerHTML = `
        <div class="ws-card-top">
          <span class="ws-card-title">${ms.badge} · ${ms.name}</span>
          <span class="ws-card-badge">${relAreas[ms.worldSize] || ''}</span>
        </div>
        <div class="ws-card-desc">${ms.desc}</div>
      `;
      card.addEventListener('click', () => {
        wsDraft.worldSize = ms.worldSize;
        AUDIO.playUiClick(true);
        renderWorkshopCreateControls();
      });
      sizeGrid.appendChild(card);
    });

    // 2. Biome archetype cards
    const biomeGrid = $('ws-biome-cards');
    biomeGrid.innerHTML = '';
    PALETTES.MAP_ARCHETYPES.forEach((ar) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ws-biome-card' + (wsDraft.archetype === ar.id ? ' active' : '');
      const svg = SVG_ICONS[`biome_${ar.id}`] || SVG_ICONS.biome_clearing;
      card.innerHTML = `
        <div class="ws-card-top">
          <span class="biome-ico">${svg}</span>
          <span class="ws-card-badge">${ar.tag}</span>
        </div>
        <div class="ws-card-title">${ar.name}</div>
        <div class="ws-card-desc">${ar.desc}</div>
      `;
      card.addEventListener('click', () => {
        wsDraft.archetype = ar.id;
        AUDIO.playUiClick(true);
        renderWorkshopCreateControls();
      });
      biomeGrid.appendChild(card);
    });

    // 3. Season mini pills
    const seasonWrap = $('ws-season-pills');
    seasonWrap.innerHTML = '';
    Object.values(PALETTES.SEASONS).forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.shortName || s.name;
      if (wsDraft.season === s.id) b.classList.add('active');
      b.addEventListener('click', () => {
        wsDraft.season = s.id;
        AUDIO.playUiClick(true);
        renderWorkshopCreateControls();
      });
      seasonWrap.appendChild(b);
    });
  }

  function renderExpandTabContent() {
    const curSize = GAME.getMapWorldSize();
    const curCfg = GAME.getMapConfig();
    const st = GAME.getStats();
    const curEl = $('ws-expand-current');
    if (curEl) {
      curEl.textContent = `当前领地：${curCfg.badge} · ${curCfg.name}（已建小屋 ${st.buildings} · 石墙 ${st.walls}）`;
    }

    const wrap = $('ws-expand-cards');
    if (!wrap) return;
    wrap.innerHTML = '';

    const targets = [
      {
        worldSize: 96,
        title: '96×96m · 广阔林谷（2.5倍面积）',
        desc: '向外平滑铺展开阔草甸、蜿蜒林带与远山缓坡，适合在原有庭院外围增建石桥村落与护城河。'
      },
      {
        worldSize: 136,
        title: '136×136m · 宏伟领地（5.1倍史诗疆域）',
        desc: '解锁最大尺度山川河谷，原有建筑与池塘在中央毫发无损，四周延展出壮阔连绵的可建造疆域！'
      }
    ];

    targets.forEach((t) => {
      const reached = curSize >= t.worldSize - 0.5;
      const card = document.createElement('div');
      card.className = 'expand-tier-card';
      card.innerHTML = `
        <div>
          <div class="ws-card-top" style="margin-bottom:5px">
            <span class="ws-card-title">${t.title}</span>
            <span class="ws-card-badge">${reached ? '已达成' : '无损扩建'}</span>
          </div>
          <div class="ws-card-desc">${t.desc}</div>
        </div>
      `;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'expand-tier-btn';
      btn.disabled = reached;
      btn.textContent = reached
        ? (Math.abs(curSize - t.worldSize) < 2 ? '✓ 当前所处幅员规格' : '✓ 已包含于当前更大疆域')
        : `↗ 立即无损扩建至 ${t.worldSize}×${t.worldSize}m`;
      if (!reached) {
        btn.addEventListener('click', () => {
          const ok = GAME.expandCurrentMap(t.worldSize);
          if (ok) {
            closeAllPopovers();
            showToast(`✨ 领地已无损扩建至 ${t.worldSize}×${t.worldSize}m！原有建筑与地形已完整保留`, 3200);
          }
        });
      }
      card.appendChild(btn);
      wrap.appendChild(card);
    });
  }

  function initPresetCards() {
    const list = $('preset-list');
    list.innerHTML = '';
    PALETTES.PRESET_GLADES.forEach((p) => {
      const sObj = PALETTES.SEASONS[p.season] || PALETTES.SEASONS.summer;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card';
      card.innerHTML = `
        <div>
          <div class="preset-card-head">
            <span class="preset-card-title">${p.name}</span>
            <span class="ws-card-badge">${p.worldSize || 96}×${p.worldSize || 96}m · ${sObj.shortName}</span>
          </div>
          <div class="preset-card-desc" style="margin-top:4px">${p.desc || ''}</div>
        </div>
        <div class="preset-card-foot">
          <span>建筑 ${(p.buildings || []).length} 座</span>
          <span>加载奇景 →</span>
        </div>
      `;
      card.addEventListener('click', () => {
        GAME.loadPreset(p.id);
        closeAllPopovers();
        showToast(`✨ 已加载微缩奇景：「${p.name}」`);
      });
      list.appendChild(card);
    });
  }

  // ==========================================================================
  // CONTEXTUAL SUBTOOL BAR, BRUSH RADIUS SLIDER & UNIFIED SELECTION BAR
  // ==========================================================================
  function toolSupportsBrushScale(tool) {
    if (tool === 'path' || tool === 'terrain' || tool === 'demolish') return true;
    if (tool === 'nature') {
      const sub = GAME.getSubTool('nature');
      return sub === 'flower' || sub === 'clear_nature';
    }
    return false;
  }

  function syncBrushScaleUI() {
    const slider = $('slider-brush-scale');
    const valEl = $('brush-scale-val');
    const s = GAME.getBrushScale();
    if (slider) slider.value = s;
    if (valEl) valEl.textContent = `${s.toFixed(1)}×`;
  }

  function appendBrushScaleControl(container) {
    const wrap = document.createElement('label');
    wrap.className = 'brush-ctrl-wrap';
    wrap.title = '调节笔刷范围（快捷键 [ / ] 或按住 Shift + 滚轮）';
    const cur = GAME.getBrushScale();
    wrap.innerHTML = `
      <span>笔刷</span>
      <input id="slider-brush-scale" type="range" min="0.45" max="2.25" step="0.05" value="${cur}" />
      <span id="brush-scale-val" class="brush-scale-val">${cur.toFixed(1)}×</span>
    `;
    const input = wrap.querySelector('input');
    input.addEventListener('input', (e) => {
      GAME.setBrushScale(parseFloat(e.target.value));
    });
    container.appendChild(wrap);
  }

  function syncToolBar() {
    const tool = GAME.getTool();
    document.querySelectorAll('#main-toolbar .tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    const subBar = $('subtool-bar');
    subBar.innerHTML = '';

    if (tool === 'rect' || tool === 'tower' || tool === 'palette') {
      renderColorSwatchBar(subBar);
    } else if (tool === 'wall') {
      renderSubButtons(subBar, 'wall', [
        { id: 'stone', label: '田园矮石墙（遇路开石拱）' },
        { id: 'tall_stone', label: '高大女墙城垣' },
        { id: 'fence', label: '木质牧场篱笆（遇路开木门）' }
      ]);
    } else if (tool === 'path') {
      renderSubButtons(subBar, 'path', [
        { id: 'wide', label: '石板宽径（架木桥/开大拱门）' },
        { id: 'narrow', label: '羊肠小径（青苔汀步石）' },
        { id: 'erase', label: '擦除小径恢复草甸' }
      ]);
    } else if (tool === 'stamp') {
      renderSubButtons(subBar, 'stamp', [
        { id: 'window', label: '花格木窗' },
        { id: 'dormer', label: '屋顶老虎窗' },
        { id: 'chimney', label: '冒烟石烟囱' },
        { id: 'flag', label: '迎风三角旗' },
        { id: 'lantern_post', label: '暖光灯笼' },
        { id: 'ivy', label: '攀爬常春藤' },
        { id: 'well', label: '许愿石水井' },
        { id: 'bench', label: '休憩木长椅' },
        { id: 'cart', label: '南瓜木推车' }
      ]);
    } else if (tool === 'terrain') {
      renderSubButtons(subBar, 'terrain', [
        { id: 'water', label: '清澈池塘 / 护城河' },
        { id: 'raise', label: '隆起山丘崖壁' },
        { id: 'lower', label: '平缓降低河谷' },
        { id: 'plateau', label: '平整建筑台地' }
      ]);
    } else if (tool === 'nature') {
      renderSubButtons(subBar, 'nature', [
        { id: 'tree', label: '种植林木' },
        { id: 'flower', label: '播撒繁花草甸' },
        { id: 'sheep', label: '呼唤小绵羊' },
        { id: 'clear_nature', label: '清理林木花草' }
      ]);
    } else if (tool === 'demolish') {
      const tip = document.createElement('span');
      tip.className = 'swatch-label';
      tip.textContent = '点击或扫过即可轻柔拆除房屋、石墙、装饰或树木';
      subBar.appendChild(tip);
    }

    if (toolSupportsBrushScale(tool)) {
      appendBrushScaleControl(subBar);
    }
  }

  function renderSubButtons(container, group, items) {
    const cur = GAME.getSubTool(group);
    items.forEach((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      if (cur === item.id) b.classList.add('active');
      b.addEventListener('click', () => GAME.setSubTool(group, item.id));
      container.appendChild(b);
    });
  }

  function renderColorSwatchBar(container) {
    const roofWrap = document.createElement('div');
    roofWrap.className = 'swatch-group';
    const rl = document.createElement('span');
    rl.className = 'swatch-label';
    rl.textContent = '屋顶瓦色';
    roofWrap.appendChild(rl);

    const curRoof = GAME.getRoofSwatchId();
    PALETTES.ROOF_SWATCHES.forEach((sw) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'swatch-dot' + (sw.id === curRoof ? ' active' : '');
      dot.style.background = sw.hex;
      dot.title = `屋顶：${sw.name}`;
      dot.addEventListener('click', () => GAME.setRoofSwatch(sw.id));
      roofWrap.appendChild(dot);
    });
    container.appendChild(roofWrap);

    const div = document.createElement('div');
    div.className = 'swatch-divider';
    container.appendChild(div);

    const wallWrap = document.createElement('div');
    wallWrap.className = 'swatch-group';
    const wl = document.createElement('span');
    wl.className = 'swatch-label';
    wl.textContent = '墙体材质';
    wallWrap.appendChild(wl);

    const curWall = GAME.getWallStyleId();
    PALETTES.WALL_STYLES.forEach((ws) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'swatch-dot' + (ws.id === curWall ? ' active' : '');
      dot.style.background = ws.wallHex;
      dot.title = `墙体：${ws.name}`;
      dot.addEventListener('click', () => GAME.setWallStyle(ws.id));
      wallWrap.appendChild(dot);
    });
    container.appendChild(wallWrap);
  }

  function syncPaletteBar() {
    const tool = GAME.getTool();
    if (tool === 'rect' || tool === 'tower' || tool === 'palette') {
      syncToolBar();
    }
  }

  function onSelectionChanged(selDetail) {
    const bar = $('selection-bar');
    bar.innerHTML = '';
    if (!selDetail || GAME.isPhotoMode() || GAME.isStrollMode() || GAME.isHudHidden()) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');

    if (selDetail.kind === 'building') {
      const b = selDetail.entity;
      const isBattlement = (b.roofH || 0) <= 0.22;
      const isArched = (b.baseLift || 0) > 0.6;

      const badge = document.createElement('span');
      badge.className = 'sel-badge';
      badge.textContent = b.type === 'tower' ? '已选中圆塔 · 拖动上方手柄塑形' : '已选中方屋 · 拖动上方手柄塑形';
      bar.appendChild(badge);

      const btnBat = document.createElement('button');
      btnBat.type = 'button';
      btnBat.textContent = isBattlement ? '恢复尖顶斜屋面' : '切换城堡女墙';
      btnBat.addEventListener('click', () => {
        const nowBat = GAME.toggleSelectedBattlement();
        showToast(nowBat ? '🏰 已切换为石质城堡垛口女墙' : '🏠 已恢复童话斜顶屋面');
      });
      bar.appendChild(btnBat);

      const btnArch = document.createElement('button');
      btnArch.type = 'button';
      btnArch.textContent = isArched ? '降回贴地石基' : '拱 抬升石拱廊';
      btnArch.addEventListener('click', () => {
        const nowArch = GAME.toggleSelectedArchLift();
        showToast(nowArch ? '拱 已抬升石拱基座（小径与村民可从下方穿过）' : '已降回贴地石砌基座');
      });
      bar.appendChild(btnArch);

      const btnDup = document.createElement('button');
      btnDup.type = 'button';
      btnDup.textContent = '⧉ 复制';
      btnDup.addEventListener('click', () => {
        GAME.duplicateSelectedEntity();
        showToast('⧉ 已复制同款建筑');
      });
      bar.appendChild(btnDup);

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'danger';
      btnDel.textContent = '拆除';
      btnDel.addEventListener('click', () => GAME.deleteSelectedEntity());
      bar.appendChild(btnDel);
      return;
    }

    if (selDetail.kind === 'wall') {
      const w = selDetail.entity;
      const badge = document.createElement('span');
      badge.className = 'sel-badge';
      badge.textContent = '已选中墙垣 · 拖动 ⇕ 手柄调高度';
      bar.appendChild(badge);

      const curMode = w.kind === 'fence' ? 'fence' : ((w.height || 1.45) > 2.05 ? 'tall_stone' : 'stone');
      [
        { id: 'stone', label: '矮石墙' },
        { id: 'tall_stone', label: '高大城垣' },
        { id: 'fence', label: '木质篱笆' }
      ].forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        if (curMode === opt.id) btn.classList.add('active');
        btn.textContent = opt.label;
        btn.addEventListener('click', () => GAME.setSelectedWallKind(opt.id));
        bar.appendChild(btn);
      });

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'danger';
      btnDel.textContent = '拆除石墙';
      btnDel.addEventListener('click', () => GAME.deleteSelectedEntity());
      bar.appendChild(btnDel);
      return;
    }

    if (selDetail.kind === 'stamp') {
      const st = selDetail.entity;
      const badge = document.createElement('span');
      badge.className = 'sel-badge';
      badge.textContent = st.onStructure ? '已选中建筑装饰' : '已选中庭院装饰 · 可拖拽移动';
      bar.appendChild(badge);

      const btnRot = document.createElement('button');
      btnRot.type = 'button';
      btnRot.textContent = '↻ 旋转 45°';
      btnRot.addEventListener('click', () => GAME.rotateSelectedStamp(Math.PI * 0.25));
      bar.appendChild(btnRot);

      if (!st.onStructure) {
        const btnDup = document.createElement('button');
        btnDup.type = 'button';
        btnDup.textContent = '⧉ 复制';
        btnDup.addEventListener('click', () => GAME.duplicateSelectedEntity());
        bar.appendChild(btnDup);
      }

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'danger';
      btnDel.textContent = '拆除';
      btnDel.addEventListener('click', () => GAME.deleteSelectedEntity());
      bar.appendChild(btnDel);
    }
  }

  // ==========================================================================
  // 3D GIZMO HANDLES & WORLD FEEDBACK FLOATING PILLS
  // ==========================================================================
  function initGizmoLayer() {
    const layer = $('gizmo-layer');
    const types = ['roof', 'wall', 'size', 'lift', 'rotate', 'wall_height', 'stamp_rotate'];
    types.forEach((id) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'gizmo-handle ui-interactive hidden';
      el.innerHTML = `<span class="g-ico"></span><span class="g-lbl"></span>`;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        GAME.startGizmoHandleDrag(id, e.clientX, e.clientY);
      });
      layer.appendChild(el);
      gizmoDomMap[id] = el;
    });

    const badgeWrap = $('world-badges-wrap');
    for (let i = 0; i < 8; i++) {
      const b = document.createElement('div');
      b.className = 'world-float-badge hidden';
      badgeWrap.appendChild(b);
      badgePool.push(b);
    }
  }

  function updateGizmoOverlay() {
    const pts = GAME.getSelectedGizmoScreenPoints();
    const seen = new Set();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const el = gizmoDomMap[p.id];
      if (!el) continue;
      seen.add(p.id);
      if (!p.visible) {
        el.classList.add('hidden');
      } else {
        el.classList.remove('hidden');
        el.style.left = `${p.sx.toFixed(1)}px`;
        el.style.top = `${p.sy.toFixed(1)}px`;
        el.style.cursor = p.cursor;
        el.querySelector('.g-ico').textContent = p.icon;
        el.querySelector('.g-lbl').textContent = p.label;
      }
    }
    Object.keys(gizmoDomMap).forEach((k) => {
      if (!seen.has(k)) gizmoDomMap[k].classList.add('hidden');
    });
  }

  function updateWorldFeedbackOverlay() {
    const { dragPill, badges } = GAME.getWorldFeedbackOverlays();
    const pillEl = $('drag-dim-pill');
    if (dragPill) {
      pillEl.textContent = dragPill.text;
      pillEl.style.left = `${dragPill.sx.toFixed(1)}px`;
      pillEl.style.top = `${dragPill.sy.toFixed(1)}px`;
      pillEl.classList.remove('hidden');
    } else {
      pillEl.classList.add('hidden');
    }

    for (let i = 0; i < badgePool.length; i++) {
      const el = badgePool[i];
      if (i < badges.length) {
        const b = badges[i];
        el.textContent = b.text;
        el.style.left = `${b.sx.toFixed(1)}px`;
        el.style.top = `${b.sy.toFixed(1)}px`;
        el.style.opacity = b.opacity.toFixed(2);
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  }

  // ==========================================================================
  // UNIFIED VIEW MODE VISIBILITY (PHOTO / VILLAGER STROLL / CINEMA TAB)
  // ==========================================================================
  function syncAllModeVisibility() {
    const photo = GAME.isPhotoMode();
    const stroll = GAME.isStrollMode();
    const hudOff = GAME.isHudHidden();
    const hideMainHud = photo || stroll || hudOff;

    $('top-hud').classList.toggle('hidden', hideMainHud);
    $('bottom-dock-wrap').classList.toggle('hidden', hideMainHud);
    $('photo-grid').classList.toggle('hidden', !photo || hudOff);
    $('photo-studio').classList.toggle('hidden', !photo || hudOff);
    $('stroll-banner').classList.toggle('hidden', !stroll || hudOff);
    $('hud-restore-pill').classList.toggle('hidden', !hudOff);

    if (hideMainHud) {
      closeAllPopovers();
    } else {
      onSelectionChanged(GAME.getSelectionDetail());
    }
  }

  function syncPhotoMode() {
    syncAllModeVisibility();
    if (GAME.isPhotoMode()) {
      $('slider-dof').value = GAME.getDofAmount();
      $('slider-fov').value = GAME.getFov();
      $('slider-azimuth').value = GAME.getSunAzimuth();
      $('slider-photo-time').value = GAME.getTimeOfDay();
      showToast('📸 已进入微缩移轴摄影棚 · 拖拽构图，滚轮缩放');
    }
  }

  function syncStrollMode() {
    syncAllModeVisibility();
    if (GAME.isStrollMode()) {
      showToast('🚶 已化身村民漫步林间 · 用 WASD 走过石拱与木桥吧！', 2800);
    }
  }

  function syncHudHidden() {
    syncAllModeVisibility();
  }

  // ==========================================================================
  // POPOVERS & 6-SLOT OFFLINE SAVE GALLERY
  // ==========================================================================
  function hasOpenPopover() {
    return POPOVER_IDS.some((id) => !$(id).classList.contains('hidden'));
  }

  function closeAllPopovers() {
    POPOVER_IDS.forEach((id) => $(id).classList.add('hidden'));
  }

  function onCanvasPointerDown() {
    if (hasOpenPopover()) {
      closeAllPopovers();
    }
  }

  function togglePopover(id) {
    const target = $(id);
    const wasHidden = target.classList.contains('hidden');
    closeAllPopovers();
    if (wasHidden) {
      if (id === 'modal-save') renderSaveSlots();
      target.classList.remove('hidden');
    }
    AUDIO.playUiClick(wasHidden);
  }

  function compactGladeForStorage(data) {
    if (data && data.terrain) {
      const roundArr = (arr) => Array.isArray(arr) ? arr.map((n) => Math.round(n * 1000) / 1000) : arr;
      data.terrain = {
        ...data.terrain,
        baseH: roundArr(data.terrain.baseH),
        waterD: roundArr(data.terrain.waterD),
        pathMask: roundArr(data.terrain.pathMask),
        flowerMask: roundArr(data.terrain.flowerMask)
      };
    }
    return data;
  }

  function loadAllSlots() {
    let slots = new Array(SLOT_COUNT).fill(null);
    try {
      const raw = localStorage.getItem(SLOTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (let i = 0; i < SLOT_COUNT; i++) slots[i] = parsed[i] || null;
        }
      } else {
        // Seamless v1 single-slot migration into Slot 1!
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          const d = JSON.parse(legacy);
          if (d && d.magic === 'TINY_GLADE_OFFLINE_V1') {
            slots[0] = d;
            localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
          }
        }
      }
    } catch (_) {
      // Ignore malformed localStorage entries
    }
    return slots;
  }

  function saveAllSlots(slots) {
    localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
  }

  function formatShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  }

  function renderSaveSlots() {
    const list = $('save-slots-list');
    if (!list) return;
    list.innerHTML = '';
    const slots = loadAllSlots();

    for (let i = 0; i < SLOT_COUNT; i++) {
      const item = slots[i];
      const row = document.createElement('div');
      row.className = 'save-slot-card';

      const info = document.createElement('div');
      info.className = 'slot-info';
      if (item) {
        const sObj = PALETTES.SEASONS[item.seasonId] || PALETTES.SEASONS.summer;
        const ws = item.worldSize || (item.terrain && item.terrain.worldSize) || 60;
        const bCount = (item.buildings || []).length;
        const title = item.title || `林间存档 #${i + 1}`;
        info.innerHTML = `
          <div class="slot-title">${i + 1}. ${title}</div>
          <div class="slot-meta">${ws}×${ws}m · ${sObj.shortName} · 小屋 ${bCount} · ${formatShortDate(item.savedAt)}</div>
        `;
      } else {
        info.innerHTML = `
          <div class="slot-title" style="opacity:0.55">${i + 1}. 空存档槽位</div>
          <div class="slot-meta">点击右侧「存入」保存当前世界</div>
        `;
      }
      row.appendChild(info);

      const btns = document.createElement('div');
      btns.className = 'slot-btns';

      const btnSave = document.createElement('button');
      btnSave.type = 'button';
      btnSave.className = 'slot-btn primary';
      btnSave.textContent = item ? '覆盖' : '存入';
      btnSave.addEventListener('click', () => {
        try {
          const customTitle = ($('save-title-input').value || '').trim();
          const data = compactGladeForStorage(GAME.exportGladeData(customTitle || (item && item.title) || `林间小筑 #${i + 1}`));
          const nextSlots = loadAllSlots();
          nextSlots[i] = data;
          saveAllSlots(nextSlots);
          $('save-title-input').value = '';
          renderSaveSlots();
          AUDIO.playArchChime();
          showToast(`✅ 已存入槽位 ${i + 1}：「${data.title}」`);
        } catch (err) {
          showToast('浏览器存储空间已满，建议使用下方「导出 .glade.json」保存文件', 3500);
        }
      });
      btns.appendChild(btnSave);

      const btnLoad = document.createElement('button');
      btnLoad.type = 'button';
      btnLoad.className = 'slot-btn';
      btnLoad.textContent = '读取';
      btnLoad.disabled = !item;
      if (item) {
        btnLoad.addEventListener('click', () => {
          try {
            GAME.importGladeData(item);
            closeAllPopovers();
            showToast(`✅ 已读取槽位 ${i + 1}：「${item.title || '林间存档'}」`);
          } catch (err) {
            showToast('读取失败：' + err.message);
          }
        });
      }
      btns.appendChild(btnLoad);

      if (item) {
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'slot-btn';
        btnDel.title = '清空此槽位';
        btnDel.textContent = '✕';
        btnDel.addEventListener('click', () => {
          const nextSlots = loadAllSlots();
          nextSlots[i] = null;
          saveAllSlots(nextSlots);
          renderSaveSlots();
          AUDIO.playUiClick(false);
        });
        btns.appendChild(btnDel);
      }

      row.appendChild(btns);
      list.appendChild(row);
    }
  }

  // ==========================================================================
  // EVENT BINDINGS
  // ==========================================================================
  function bindUiControls() {
    // Main 10-tool dock
    document.querySelectorAll('#main-toolbar .tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => GAME.setTool(btn.dataset.tool));
    });

    // Top-left Map Scale badge -> opens Map Workshop directly on Lossless Expand (or Create if 136m)!
    $('btn-map-scale').addEventListener('click', () => {
      openMapWorkshop(GAME.canExpandMap() ? 'expand' : 'create');
    });

    // Inspiration prompt toggle / next / close
    $('btn-theme-toggle').addEventListener('click', () => {
      $('theme-banner').classList.toggle('hidden');
      AUDIO.playUiClick(true);
    });
    $('btn-theme-next').addEventListener('click', () => {
      const th = GAME.nextInspirationTheme();
      $('theme-title').textContent = th.title;
      $('theme-desc').textContent = th.desc;
    });
    $('btn-theme-close').addEventListener('click', () => {
      $('theme-banner').classList.add('hidden');
      AUDIO.playUiClick(false);
    });

    // Time & Season controls
    $('slider-time').addEventListener('input', (e) => {
      GAME.setAutoCycle(false);
      $('btn-autocycle').classList.remove('active');
      GAME.setTimeOfDay(parseFloat(e.target.value));
      syncTimeDisplayOnly();
    });

    document.querySelectorAll('.quick-times button').forEach((btn) => {
      btn.addEventListener('click', () => {
        GAME.setAutoCycle(false);
        $('btn-autocycle').classList.remove('active');
        GAME.setTimeOfDay(parseFloat(btn.dataset.time));
        syncTimeDisplayOnly();
        AUDIO.playUiClick(true);
      });
    });

    $('btn-autocycle').addEventListener('click', () => {
      const next = !GAME.isAutoCycle();
      GAME.setAutoCycle(next);
      $('btn-autocycle').classList.toggle('active', next);
      AUDIO.playUiClick(true);
      showToast(next ? '⟳ 已开启昼夜晨昏自然流转' : '已暂停昼夜流转');
    });

    document.querySelectorAll('#season-bar button').forEach((btn) => {
      btn.addEventListener('click', () => {
        GAME.setSeason(btn.dataset.season);
        const s = PALETTES.SEASONS[btn.dataset.season];
        if (s) showToast(`季节已切换至「${s.name}」`);
      });
    });

    // System bar buttons
    $('btn-undo').addEventListener('click', () => GAME.undo());
    $('btn-redo').addEventListener('click', () => GAME.redo());
    $('btn-stroll').addEventListener('click', () => GAME.setStrollMode(true));
    $('btn-exit-stroll').addEventListener('click', () => GAME.setStrollMode(false));
    $('hud-restore-pill').addEventListener('click', () => GAME.setHudHidden(false));
    $('btn-map-workshop').addEventListener('click', () => openMapWorkshop());
    $('btn-save-menu').addEventListener('click', () => togglePopover('modal-save'));
    $('btn-help').addEventListener('click', () => togglePopover('modal-help'));
    $('btn-photo').addEventListener('click', () => GAME.setPhotoMode(true));

    document.querySelectorAll('.pop-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        $(btn.dataset.close).classList.add('hidden');
        AUDIO.playUiClick(false);
      });
    });

    // Map Workshop tabs & controls
    document.querySelectorAll('#modal-map-workshop .ws-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        setWorkshopTab(btn.dataset.wsTab);
        AUDIO.playUiClick(true);
      });
    });

    $('ws-tree-slider').addEventListener('input', (e) => {
      wsDraft.treeDensity = parseFloat(e.target.value);
      $('ws-tree-val').textContent = `${Math.round(wsDraft.treeDensity * 100)}%`;
    });

    $('ws-water-slider').addEventListener('input', (e) => {
      wsDraft.waterAmount = parseFloat(e.target.value);
      $('ws-water-val').textContent = `${Math.round(wsDraft.waterAmount * 100)}%`;
    });

    $('ws-seed-input').addEventListener('input', (e) => {
      const n = parseInt(e.target.value, 10);
      if (!Number.isNaN(n)) wsDraft.seed = n;
    });

    $('btn-ws-rand-seed').addEventListener('click', () => {
      wsDraft.seed = Math.floor(Math.random() * 89999) + 10000;
      $('ws-seed-input').value = wsDraft.seed;
      AUDIO.playUiClick(true);
    });

    $('btn-ws-generate').addEventListener('click', () => {
      const seedVal = parseInt($('ws-seed-input').value, 10) || wsDraft.seed;
      GAME.generateCustomMap({
        worldSize: wsDraft.worldSize,
        archetype: wsDraft.archetype,
        season: wsDraft.season,
        seed: seedVal,
        treeDensity: wsDraft.treeDensity,
        waterAmount: wsDraft.waterAmount
      });
      const ar = PALETTES.MAP_ARCHETYPES.find((a) => a.id === wsDraft.archetype);
      closeAllPopovers();
      showToast(`🌱 已创建 ${wsDraft.worldSize}×${wsDraft.worldSize}m「${ar ? ar.name : '新地图'}」！（种子 ${seedVal}）`, 3200);
    });

    // Audio toggle
    $('btn-audio').innerHTML = SVG_ICONS.audioOn;
    $('btn-audio').addEventListener('click', () => {
      const on = AUDIO.setEnabled(!AUDIO.isEnabled());
      $('btn-audio').innerHTML = on ? SVG_ICONS.audioOn : SVG_ICONS.audioOff;
      showToast(on ? '已开启林间竖琴与自然环境音' : '已静音');
    });

    // Export / Import .glade.json
    $('btn-export-json').addEventListener('click', () => {
      const customTitle = ($('save-title-input').value || '').trim();
      const data = GAME.exportGladeData(customTitle || '林间微缩世界');
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tiny-glade-${data.worldSize}m-${Date.now()}.glade.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast('⬇ 已导出 .glade.json 离线存档文件');
      closeAllPopovers();
    });

    $('input-import-json').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          GAME.importGladeData(JSON.parse(reader.result));
          showToast('✅ 成功导入林间世界存档！');
          closeAllPopovers();
        } catch (err) {
          showToast('导入失败：' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Photo Studio controls
    $('slider-dof').addEventListener('input', (e) => GAME.setDofAmount(parseFloat(e.target.value)));
    $('slider-fov').addEventListener('input', (e) => GAME.setFov(parseFloat(e.target.value)));
    $('slider-azimuth').addEventListener('input', (e) => GAME.setSunAzimuth(parseFloat(e.target.value)));
    $('slider-photo-time').addEventListener('input', (e) => {
      GAME.setTimeOfDay(parseFloat(e.target.value));
      syncTimeDisplayOnly();
    });

    $('btn-snap-png').addEventListener('click', () => {
      const dataUrl = GAME.capturePostcardDataUrl();
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `林间小世界-明信片-${Date.now()}.png`;
      a.click();
      AUDIO.playArchChime();
      showToast('📷 明信片已保存为高清 PNG！');
    });

    $('btn-exit-photo').addEventListener('click', () => GAME.setPhotoMode(false));
  }

  function init() {
    initGizmoLayer();
    renderWorkshopCreateControls();
    initPresetCards();
    bindUiControls();
    syncToolBar();

    const canvas = $('glade-canvas');
    try {
      GAME.start(canvas);
      syncMapBadges();
    } catch (err) {
      console.error(err);
      showToast('初始化渲染引擎失败: ' + err.message, 8000);
    }
  }

  window.addEventListener('DOMContentLoaded', init);

  return {
    showToast,
    syncTimeDisplayOnly,
    syncAtmosphereControls,
    syncToolBar,
    syncPaletteBar,
    syncBrushScaleUI,
    syncPhotoMode,
    syncStrollMode,
    syncHudHidden,
    syncMapBadges,
    onSelectionChanged,
    updateGizmoOverlay,
    updateWorldFeedbackOverlay,
    updateHistoryButtons,
    refreshStats,
    onCanvasPointerDown,
    hasOpenPopover,
    closeAllPopovers,
    openMapWorkshop
  };
})();
