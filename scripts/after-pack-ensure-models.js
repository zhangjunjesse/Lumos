/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const MODEL_RELATIVE_DIR = path.join('Xenova', 'bge-small-zh-v1.5');
const REQUIRED_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.txt',
  path.join('onnx', 'model_quantized.onnx'),
];

function resolvePackagedResourcesDir(appOutDir) {
  const candidates = [
    path.join(appOutDir, 'resources'),
    path.join(appOutDir, 'Lumos.app', 'Contents', 'Resources'),
    path.join(appOutDir, 'Contents', 'Resources'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`[afterPack:models] Packaged resources directory not found under ${appOutDir}`);
}

function hasCompleteModel(modelRoot) {
  const baseDir = path.join(modelRoot, MODEL_RELATIVE_DIR);
  return REQUIRED_MODEL_FILES.every((relativePath) => fs.existsSync(path.join(baseDir, relativePath)));
}

function listMissingFiles(modelRoot) {
  const baseDir = path.join(modelRoot, MODEL_RELATIVE_DIR);
  return REQUIRED_MODEL_FILES.filter((relativePath) => !fs.existsSync(path.join(baseDir, relativePath)));
}

module.exports = async function afterPackEnsureModels(context) {
  const projectDir = process.cwd();
  const sourceModelsRoot = path.join(projectDir, 'resources', 'models');
  const packagedResourcesDir = resolvePackagedResourcesDir(context.appOutDir);
  const packagedModelsRoot = path.join(packagedResourcesDir, 'models');

  if (!hasCompleteModel(sourceModelsRoot)) {
    throw new Error(
      `[afterPack:models] Source embedding model is incomplete: ${listMissingFiles(sourceModelsRoot).join(', ')}`,
    );
  }

  if (!hasCompleteModel(packagedModelsRoot)) {
    console.warn('[afterPack:models] Packaged embedding model missing files; copying bundled model directory');
    fs.mkdirSync(packagedModelsRoot, { recursive: true });
    fs.cpSync(sourceModelsRoot, packagedModelsRoot, { recursive: true, force: true });
  }

  if (!hasCompleteModel(packagedModelsRoot)) {
    throw new Error(
      `[afterPack:models] Packaged embedding model is still incomplete after copy: ${listMissingFiles(packagedModelsRoot).join(', ')}`,
    );
  }

  console.log(
    `[afterPack:models] Verified embedding model at ${path.join(packagedModelsRoot, MODEL_RELATIVE_DIR)}`,
  );
};
