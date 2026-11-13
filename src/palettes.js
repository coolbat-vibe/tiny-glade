// ============================================================================
// palettes.js — Cozy Gouache Color Palettes, Materials, Seasons, Map Configs & Presets
// ============================================================================

const PALETTES = (() => {
  const MAT = {
    TERRAIN: 0,
    PLASTER: 1,
    STONE: 2,
    ROOF_TILE: 3,
    WOOD: 4,
    FOLIAGE: 5,
    WINDOW_GLOW: 6,
    LANTERN_GLOW: 7,
    FABRIC: 8,
    WOOL: 9
  };

  const MAP_SIZES = [
    {
      id: 'small',
      worldSize: 60,
      gridN: 145,
      name: '微缩庭院',
      badge: '60×60m',
      desc: '精致紧凑的林间庭院，适合单栋农舍与温馨小花园'
    },
    {
      id: 'medium',
      worldSize: 96,
      gridN: 193,
      name: '广阔林谷',
      badge: '96×96m',
      desc: '2.5倍开阔河谷，可自由铺展村落街巷、石桥与护城河'
    },
    {
      id: 'large',
      worldSize: 136,
      gridN: 225,
      name: '宏伟领地',
      badge: '136×136m',
      desc: '5倍史诗级疆域，可营建恢弘湖心古堡群与连绵山城'
    }
  ];

  const MAP_ARCHETYPES = [
    {
      id: 'clearing',
      name: '牧羊林间空地',
      tag: '经典平缓',
      desc: '阳光洒满的微起伏草甸，四周环绕温润林丘，最适合自由构思。'
    },
    {
      id: 'river_valley',
      name: '蜿蜒溪流河谷',
      tag: '桥梁水景',
      desc: '清澈溪流呈 S 形穿林而过，两岸芳草茵茵，天然适合架设木桥与水坊。'
    },
    {
      id: 'lake_islands',
      name: '镜湖星罗群岛',
      tag: '湖心古堡',
      desc: '中央澄澈大湖倒映流云，湖心隆起大小岛屿与半岛，适合建造水上城堡。'
    },
    {
      id: 'highland_terraces',
      name: '层叠山崖台地',
      tag: '错落山城',
      desc: '错落有致的天然岩层台地与山脊坡道，适合依山叠建高塔与石阶聚落。'
    },
    {
      id: 'twin_brooks',
      name: '双溪交汇芳洲',
      tag: '三岸聚落',
      desc: '两条林间清溪在中央三角洲汇流，将领地自然划分为三片诗意组团。'
    },
    {
      id: 'ancient_ruins',
      name: '古堡遗迹秘境',
      tag: '残垣重建',
      desc: '散布着长满青苔的古老残垣、断塔基座与旧石径，等待你唤醒昔日荣光。'
    }
  ];

  const ROOF_SWATCHES = [
    { id: 'terracotta', name: '暖陶红', hex: '#c85d44', altHex: '#b24b35', ridgeHex: '#9c402d', rough: 0.78 },
    { id: 'slate',      name: '雾霭蓝', hex: '#4f657d', altHex: '#3f5369', ridgeHex: '#354659', rough: 0.65 },
    { id: 'moss',       name: '青苔绿', hex: '#5f7d53', altHex: '#4e6b43', ridgeHex: '#435c39', rough: 0.82 },
    { id: 'ochre',      name: '麦穗黄', hex: '#c89646', altHex: '#b38236', ridgeHex: '#966b2a', rough: 0.88 },
    { id: 'plum',       name: '暮紫红', hex: '#7d4b5d', altHex: '#693c4d', ridgeHex: '#56303e', rough: 0.74 },
    { id: 'rose',       name: '蔷薇粉', hex: '#c77c79', altHex: '#b36865', ridgeHex: '#995552', rough: 0.76 },
    { id: 'charcoal',   name: '深岩灰', hex: '#4a4c52', altHex: '#3c3e44', ridgeHex: '#2f3136', rough: 0.70 },
    { id: 'teal',       name: '铜绿釉', hex: '#497d76', altHex: '#3a6963', ridgeHex: '#2e5752', rough: 0.62 }
  ];

  const WALL_STYLES = [
    {
      id: 'cream_timber',
      name: '暖白木筋',
      wallHex: '#ebe0cc',
      stoneHex: '#a39887',
      timberHex: '#6b4c35',
      hasTimber: true,
      isStone: false
    },
    {
      id: 'warm_stone',
      name: '暖砂石墙',
      wallHex: '#c9b699',
      stoneHex: '#b39e80',
      timberHex: '#694b34',
      hasTimber: false,
      isStone: true
    },
    {
      id: 'castle_grey',
      name: '古堡灰岩',
      wallHex: '#9ca0a3',
      stoneHex: '#83888c',
      timberHex: '#594232',
      hasTimber: false,
      isStone: true
    },
    {
      id: 'rose_plaster',
      name: '浅粉灰泥',
      wallHex: '#e6cbc1',
      stoneHex: '#a8958d',
      timberHex: '#6e4c38',
      hasTimber: true,
      isStone: false
    },
    {
      id: 'red_brick',
      name: '复古红砖',
      wallHex: '#b56754',
      stoneHex: '#9e8f80',
      timberHex: '#573c2a',
      hasTimber: false,
      isStone: true
    },
    {
      id: 'moss_ruin',
      name: '青苔古石',
      wallHex: '#8d9982',
      stoneHex: '#76826d',
      timberHex: '#52402f',
      hasTimber: false,
      isStone: true
    }
  ];

  const SEASONS = {
    summer: {
      id: 'summer',
      name: '初夏晴林',
      shortName: '初夏',
      grassBase: [0.27, 0.49, 0.20],
      grassTip: [0.54, 0.73, 0.28],
      soilColor: [0.46, 0.36, 0.25],
      pathColor: [0.68, 0.58, 0.44],
      cliffColor: [0.44, 0.45, 0.46],
      treeColors: ['#4d7c38', '#5e8c3e', '#3c6b32', '#6e9944'],
      flowerColors: ['#ffffff', '#f25c48', '#f5cb42', '#9d8df2'],
      waterShallow: [0.24, 0.62, 0.58],
      waterDeep: [0.07, 0.24, 0.32],
      snowAmount: 0.0,
      fogTint: [0.78, 0.87, 0.94],
      particleMode: 'butterflies'
    },
    autumn: {
      id: 'autumn',
      name: '金秋枫谷',
      shortName: '金秋',
      grassBase: [0.44, 0.45, 0.18],
      grassTip: [0.76, 0.65, 0.26],
      soilColor: [0.45, 0.33, 0.22],
      pathColor: [0.64, 0.53, 0.40],
      cliffColor: [0.46, 0.43, 0.41],
      treeColors: ['#d4652f', '#e09638', '#b83f2b', '#8c7d32', '#c9522b'],
      flowerColors: ['#f5b942', '#e06938', '#fff0d4', '#a864ba'],
      waterShallow: [0.23, 0.54, 0.52],
      waterDeep: [0.08, 0.21, 0.29],
      snowAmount: 0.0,
      fogTint: [0.88, 0.81, 0.73],
      particleMode: 'leaves'
    },
    winter: {
      id: 'winter',
      name: '初雪童话',
      shortName: '初雪',
      grassBase: [0.68, 0.75, 0.80],
      grassTip: [0.88, 0.92, 0.96],
      soilColor: [0.46, 0.44, 0.43],
      pathColor: [0.60, 0.58, 0.56],
      cliffColor: [0.42, 0.45, 0.50],
      treeColors: ['#365947', '#456b58', '#688277', '#2d4a3c'],
      flowerColors: ['#dce8f2', '#e88b84', '#ffffff', '#b8d0e6'],
      waterShallow: [0.30, 0.58, 0.68],
      waterDeep: [0.09, 0.22, 0.36],
      snowAmount: 0.86,
      fogTint: [0.82, 0.88, 0.95],
      particleMode: 'snow'
    },
    spring: {
      id: 'spring',
      name: '春樱花海',
      shortName: '春樱',
      grassBase: [0.30, 0.54, 0.24],
      grassTip: [0.60, 0.80, 0.36],
      soilColor: [0.47, 0.37, 0.27],
      pathColor: [0.71, 0.62, 0.50],
      cliffColor: [0.46, 0.47, 0.49],
      treeColors: ['#eb9ab3', '#f2b6c8', '#689c49', '#df83a2', '#7ab054'],
      flowerColors: ['#ffd6e4', '#ffffff', '#ffe066', '#b89cf5'],
      waterShallow: [0.28, 0.66, 0.63],
      waterDeep: [0.09, 0.27, 0.36],
      snowAmount: 0.0,
      fogTint: [0.86, 0.88, 0.95],
      particleMode: 'petals'
    },
    enchanted: {
      id: 'enchanted',
      name: '萤火幽林',
      shortName: '幽林',
      grassBase: [0.16, 0.38, 0.24],
      grassTip: [0.34, 0.64, 0.42],
      soilColor: [0.32, 0.28, 0.24],
      pathColor: [0.52, 0.49, 0.45],
      cliffColor: [0.35, 0.39, 0.42],
      treeColors: ['#2d5e48', '#3c7559', '#254d3e', '#4d8768'],
      flowerColors: ['#7ef5d8', '#ffd966', '#b39cff', '#ff94b8'],
      waterShallow: [0.18, 0.58, 0.56],
      waterDeep: [0.05, 0.17, 0.26],
      snowAmount: 0.0,
      fogTint: [0.58, 0.74, 0.78],
      particleMode: 'fireflies'
    }
  };

  const DAILY_THEMES = [
    { title: '林间牧羊小筑', desc: '建造一座带石拱门院墙、烟囱与花圃的温暖农舍，让小羊在门前吃草。' },
    { title: '石桥守桥人旅店', desc: '挖掘一条蜿蜒溪流，用小径跨越水面搭起木桥，并在桥头竖立灯笼圆塔。' },
    { title: '魔法师的歪顶高塔', desc: '将几座圆塔层层叠高，拉出尖尖的巫师帽屋顶，点缀常春藤与飘扬旗帜。' },
    { title: '湖心童话古堡', desc: '用池塘环绕高地，压低屋顶化作女墙垛口，用高架拱廊连接主堡与门楼。' },
    { title: '雪夜点灯村落', desc: '切换至「初雪童话」与黄昏/夜晚，为每座小屋添上暖光窗户与铁艺壁灯。' },
    { title: '漫步远山溪谷', desc: '在「地图工坊」创建 136×136m 蜿蜒河谷，建成后按 G 键以村民视角漫步桥头！' }
  ];

  function getRoofSwatch(id) {
    return ROOF_SWATCHES.find((s) => s.id === id) || ROOF_SWATCHES[0];
  }

  function getWallStyle(id) {
    return WALL_STYLES.find((w) => w.id === id) || WALL_STYLES[0];
  }

  function getMapSizeConfig(sizeOrId) {
    if (typeof sizeOrId === 'number') {
      return MAP_SIZES.find((m) => m.worldSize === sizeOrId) ||
        (sizeOrId >= 120 ? MAP_SIZES[2] : sizeOrId >= 80 ? MAP_SIZES[1] : MAP_SIZES[0]);
    }
    return MAP_SIZES.find((m) => m.id === sizeOrId) || MAP_SIZES[1];
  }

  // Preset glade definitions (consumed by Game.loadPreset)
  const PRESET_GLADES = [
    {
      id: 'shepherd_haven',
      name: '牧羊湖畔小筑',
      desc: '带石拱院门、交叉斜顶农舍与湖畔水榭的温暖田园',
      worldSize: 96,
      season: 'summer',
      timeOfDay: 16.3,
      sunAzimuth: 0.72,
      hills: [
        { x: -7.5, z: -5.5, r: 12.0, h: 1.45 },
        { x: 11.0, z: -9.0, r: 13.0, h: 2.1 },
        { x: -15.0, z: 11.0, r: 13.0, h: 1.35 },
        { x: 24.0, z: -20.0, r: 18.0, h: 2.6 }
      ],
      ponds: [
        { x: 6.2, z: 5.5, r: 5.2, depth: 1.45 },
        { x: 10.0, z: 3.4, r: 3.8, depth: 1.2 },
        { x: 3.0, z: 7.8, r: 3.3, depth: 1.05 }
      ],
      paths: [
        [
          { x: -16.5, z: 13.5 }, { x: -8.0, z: 6.8 }, { x: -4.2, z: 2.8 },
          { x: -2.4, z: -0.9 }
        ],
        [
          { x: -4.2, z: 2.8 }, { x: 0.8, z: 4.6 }, { x: 5.6, z: 5.6 },
          { x: 10.6, z: 6.6 }, { x: 16.5, z: 9.5 }
        ],
        [
          { x: -4.2, z: 2.8 }, { x: -0.6, z: -2.2 }, { x: 2.2, z: -3.6 }
        ]
      ],
      buildings: [
        {
          type: 'rect', x: -3.2, z: -3.2, w: 6.2, d: 4.6, yaw: 0.18,
          wallH: 3.1, roofH: 2.9, baseLift: 0,
          roofId: 'terracotta', wallId: 'cream_timber'
        },
        {
          type: 'rect', x: -0.8, z: -1.6, w: 3.6, d: 4.2, yaw: 1.75,
          wallH: 2.65, roofH: 2.35, baseLift: 0,
          roofId: 'terracotta', wallId: 'cream_timber'
        },
        {
          type: 'tower', x: -6.2, z: -4.5, r: 2.05, yaw: 0.4,
          wallH: 5.4, roofH: 3.8, baseLift: 0,
          roofId: 'slate', wallId: 'warm_stone'
        },
        {
          type: 'rect', x: 9.2, z: -0.8, w: 3.8, d: 3.2, yaw: -0.38,
          wallH: 2.3, roofH: 2.0, baseLift: 0.85,
          roofId: 'moss', wallId: 'warm_stone'
        }
      ],
      walls: [
        {
          kind: 'stone', height: 1.45,
          pts: [
            { x: -10.2, z: -0.5 }, { x: -8.6, z: 3.4 }, { x: -5.4, z: 4.9 },
            { x: -1.6, z: 4.5 }, { x: 1.4, z: 2.0 }, { x: 2.4, z: -1.2 }
          ]
        },
        {
          kind: 'fence', height: 0.95,
          pts: [
            { x: -14.5, z: 3.2 }, { x: -12.5, z: 7.4 }, { x: -8.8, z: 10.8 }
          ]
        }
      ],
      stamps: [
        { kind: 'chimney', x: -4.4, y: 6.1, z: -3.8, yaw: 0.18 },
        { kind: 'flag', x: -6.2, y: 10.65, z: -4.5, yaw: 0.0, color: '#d95b43' },
        { kind: 'well', x: -6.8, y: 0, z: 1.5, yaw: 0.5 },
        { kind: 'bench', x: 1.6, y: 0, z: 5.8, yaw: -0.4 },
        { kind: 'cart', x: -9.5, y: 0, z: 5.2, yaw: 0.8 },
        { kind: 'lantern_post', x: -4.6, y: 0, z: 6.0, yaw: 0 },
        { kind: 'lantern_post', x: 2.2, y: 0, z: 4.8, yaw: 0 }
      ]
    },
    {
      id: 'lakeside_castle',
      name: '双塔石桥湖心堡',
      desc: '护城河环绕的垛口主堡、双子门楼与长桥倒影',
      worldSize: 96,
      season: 'summer',
      timeOfDay: 17.4,
      sunAzimuth: 2.35,
      hills: [
        { x: 0, z: -2.0, r: 9.2, h: 2.6 },
        { x: -18.0, z: -14.0, r: 15.0, h: 2.8 }
      ],
      ponds: [
        { x: -7.5, z: -2.0, r: 5.5, depth: 1.6 },
        { x: 7.5, z: -2.0, r: 5.5, depth: 1.6 },
        { x: 0.0, z: 5.5, r: 5.6, depth: 1.6 },
        { x: -5.5, z: 4.5, r: 5.0, depth: 1.5 },
        { x: 5.5, z: 4.5, r: 5.0, depth: 1.5 },
        { x: 0.0, z: -8.8, r: 5.2, depth: 1.4 }
      ],
      paths: [
        [
          { x: 0.0, z: 18.5 }, { x: 0.0, z: 9.0 }, { x: 0.0, z: 4.0 }, { x: 0.0, z: 0.2 }
        ]
      ],
      buildings: [
        {
          type: 'rect', x: 0, z: -2.2, w: 7.4, d: 6.2, yaw: 0.0,
          wallH: 3.8, roofH: 0.05, baseLift: 0,
          roofId: 'slate', wallId: 'castle_grey'
        },
        {
          type: 'rect', x: 0, z: -2.6, w: 5.0, d: 4.2, yaw: 0.0,
          wallH: 3.4, roofH: 3.1, baseLift: 3.6,
          roofId: 'slate', wallId: 'cream_timber'
        },
        {
          type: 'tower', x: -2.8, z: -4.2, r: 2.0, yaw: 0.2,
          wallH: 7.6, roofH: 4.4, baseLift: 0,
          roofId: 'slate', wallId: 'castle_grey'
        },
        {
          type: 'tower', x: 3.1, z: -0.4, r: 1.85, yaw: 0.0,
          wallH: 5.2, roofH: 0.05, baseLift: 0,
          roofId: 'slate', wallId: 'castle_grey'
        },
        {
          type: 'tower', x: -2.3, z: 9.8, r: 1.55, yaw: 0,
          wallH: 4.0, roofH: 2.8, baseLift: 0,
          roofId: 'terracotta', wallId: 'castle_grey'
        },
        {
          type: 'tower', x: 2.3, z: 9.8, r: 1.55, yaw: 0,
          wallH: 4.0, roofH: 2.8, baseLift: 0,
          roofId: 'terracotta', wallId: 'castle_grey'
        },
        {
          type: 'rect', x: 0, z: 9.8, w: 4.2, d: 2.2, yaw: 0,
          wallH: 1.8, roofH: 1.7, baseLift: 2.3,
          roofId: 'terracotta', wallId: 'cream_timber'
        }
      ],
      walls: [
        {
          kind: 'stone', height: 2.5,
          pts: [
            { x: -11.5, z: 9.8 }, { x: -5.5, z: 9.8 }, { x: -2.4, z: 9.8 }
          ]
        },
        {
          kind: 'stone', height: 2.5,
          pts: [
            { x: 2.4, z: 9.8 }, { x: 5.5, z: 9.8 }, { x: 11.5, z: 9.8 }
          ]
        }
      ],
      stamps: [
        { kind: 'flag', x: -2.8, y: 14.6, z: -4.2, yaw: 0, color: '#4f657d' },
        { kind: 'flag', x: -2.3, y: 6.8, z: 9.8, yaw: 0, color: '#c85d44' },
        { kind: 'flag', x: 2.3, y: 6.8, z: 9.8, yaw: 0, color: '#c85d44' },
        { kind: 'chimney', x: 1.4, y: 11.5, z: -2.8, yaw: 0 },
        { kind: 'lantern_post', x: -1.6, y: 0, z: 12.0, yaw: 0 },
        { kind: 'lantern_post', x: 1.6, y: 0, z: 12.0, yaw: 0 }
      ]
    },
    {
      id: 'autumn_mill',
      name: '金秋溪谷花坊',
      desc: '红叶漫山、溪水潺潺与南瓜推车点缀的秋日山谷',
      worldSize: 96,
      season: 'autumn',
      timeOfDay: 17.8,
      sunAzimuth: 1.15,
      hills: [
        { x: -8.0, z: -7.0, r: 12.0, h: 2.8 },
        { x: 8.5, z: 6.5, r: 11.0, h: 1.4 }
      ],
      ponds: [
        { x: -2.0, z: 6.5, r: 3.4, depth: 1.1 },
        { x: 1.0, z: 2.8, r: 3.2, depth: 1.15 },
        { x: 3.8, z: -1.0, r: 3.5, depth: 1.2 },
        { x: 7.2, z: -4.2, r: 4.4, depth: 1.35 }
      ],
      paths: [
        [
          { x: -12.0, z: 11.0 }, { x: -5.5, z: 5.2 }, { x: 0.8, z: 2.8 },
          { x: 5.8, z: 2.0 }, { x: 12.0, z: 4.5 }
        ],
        [
          { x: -5.5, z: 5.2 }, { x: -6.8, z: 0.4 }, { x: -6.6, z: -3.2 }
        ]
      ],
      buildings: [
        {
          type: 'rect', x: -6.8, z: -5.4, w: 5.6, d: 4.4, yaw: 0.25,
          wallH: 3.0, roofH: 3.2, baseLift: 0,
          roofId: 'ochre', wallId: 'rose_plaster'
        },
        {
          type: 'tower', x: -3.8, z: -4.8, r: 1.75, yaw: 0,
          wallH: 4.5, roofH: 3.4, baseLift: 0,
          roofId: 'plum', wallId: 'warm_stone'
        },
        {
          type: 'rect', x: 7.2, z: 4.8, w: 4.8, d: 3.8, yaw: -0.45,
          wallH: 2.7, roofH: 2.5, baseLift: 0,
          roofId: 'terracotta', wallId: 'warm_stone'
        }
      ],
      walls: [
        {
          kind: 'stone', height: 1.3,
          pts: [
            { x: -11.5, z: -1.5 }, { x: -8.5, z: 2.2 }, { x: -4.0, z: 2.5 }, { x: -1.5, z: -0.5 }
          ]
        },
        {
          kind: 'fence', height: 0.95,
          pts: [
            { x: 3.8, z: 5.8 }, { x: 6.5, z: 8.5 }, { x: 10.5, z: 7.6 }
          ]
        }
      ],
      stamps: [
        { kind: 'chimney', x: -7.8, y: 8.2, z: -5.6, yaw: 0.25 },
        { kind: 'chimney', x: 7.8, y: 6.1, z: 5.0, yaw: -0.45 },
        { kind: 'well', x: 4.5, y: 0, z: 4.0, yaw: 0.2 },
        { kind: 'cart', x: -8.6, y: 0, z: 4.8, yaw: -0.5 },
        { kind: 'lantern_post', x: -1.8, y: 0, z: 3.6, yaw: 0 },
        { kind: 'lantern_post', x: 3.4, y: 0, z: 2.2, yaw: 0 }
      ]
    },
    {
      id: 'blank_glade',
      name: '静谧林间空地',
      desc: '无建筑的纯净广阔溪畔草甸，任你从零挥洒创意',
      worldSize: 96,
      season: 'summer',
      timeOfDay: 15.2,
      sunAzimuth: 0.65,
      hills: [
        { x: -14.0, z: -12.0, r: 16.0, h: 1.5 },
        { x: 15.0, z: 11.0, r: 15.0, h: 1.3 }
      ],
      ponds: [
        { x: 8.5, z: 6.5, r: 5.2, depth: 1.25 }
      ],
      paths: [
        [
          { x: -11.0, z: 9.5 }, { x: -3.0, z: 4.0 }, { x: 3.0, z: 2.0 }
        ]
      ],
      buildings: [],
      walls: [],
      stamps: []
    }
  ];

  return {
    MAT,
    MAP_SIZES,
    MAP_ARCHETYPES,
    ROOF_SWATCHES,
    WALL_STYLES,
    SEASONS,
    DAILY_THEMES,
    PRESET_GLADES,
    getRoofSwatch,
    getWallStyle,
    getMapSizeConfig
  };
})();
