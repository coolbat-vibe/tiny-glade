#!/usr/bin/env node
// ============================================================================
// build.js — Zero-Dependency Single-File Offline Bundler for 《林间小世界 · Tiny Glade》
// Compiles src/* -> 100% standalone offline-playable index.html
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

const JS_MODULES = [
  'math.js',
  'palettes.js',
  'audio.js',
  'geo.js',
  'terrain.js',
  'procgen.js',
  'nature.js',
  'shaders.js',
  'renderer.js',
  'game.js',
  'ui.js'
];

const template = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');

const jsChunks = JS_MODULES.map((file) => {
  const fullPath = path.join(SRC, file);
  const code = fs.readFileSync(fullPath, 'utf8');
  return `\n// ================= MODULE: ${file} =================\n${code}`;
});

const bundledJs = `(function () {\n'use strict';\n${jsChunks.join('\n')}\nwindow.__TINY_GLADE__ = { M, PALETTES, AUDIO, GEO, TERRAIN, PROCGEN, NATURE, RENDERER, GAME, UI };\n})();`;

// 1. Validate JS syntax via Node VM
new vm.Script(bundledJs, { filename: 'tiny-glade.bundle.js' });

// 2. Inline CSS + JS into single-file HTML
const finalHtml = template
  .replace('/*__INLINE_CSS__*/', () => css)
  .replace('/*__INLINE_JS__*/', () => bundledJs);

// 3. Strict 100% offline purity check (zero external http/https dependencies!)
const extUrls = finalHtml.match(/https?:\/\/[^\s"'<>)]+/g) || [];
if (extUrls.length > 0) {
  throw new Error(`Offline purity check failed! Found external URLs: ${extUrls.join(', ')}`);
}

const outPath = path.join(ROOT, 'index.html');
fs.writeFileSync(outPath, finalHtml, 'utf8');

const sizeKb = (Buffer.byteLength(finalHtml, 'utf8') / 1024).toFixed(1);
console.log(`✅ Built standalone offline single-file game: ${outPath} (${sizeKb} KB)`);
console.log(`✅ VM syntax verified & 100% zero-external-URL offline verified!`);
