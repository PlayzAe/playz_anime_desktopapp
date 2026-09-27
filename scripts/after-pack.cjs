// electron-builder afterPack hook: removes Chromium files PlayzAnime never loads, before the
// installer and portable exe are compressed. PlayzAnime draws with the GPU through Direct3D
// (d3dcompiler_47.dll stays) and uses no WebGPU or WebGL, so these are dead weight:
//   dxcompiler.dll, dxil.dll       WebGPU's shader compiler (Dawn on Direct3D 12)
//   vk_swiftshader*, vulkan-1.dll  the software Vulkan renderer, a WebGL fallback
const fs = require('node:fs');
const path = require('node:path');

const UNUSED = ['dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll'];

exports.default = async function afterPack({ appOutDir }) {
  let saved = 0;
  for (const name of UNUSED) {
    const file = path.join(appOutDir, name);
    if (!fs.existsSync(file)) continue;
    saved += fs.statSync(file).size;
    fs.rmSync(file);
  }
  console.log(`  • removed unused Chromium files (${(saved / 1048576).toFixed(1)} MB)`);
};
