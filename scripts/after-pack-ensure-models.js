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
  const packagedTargets = [
    {
      label: 'primary',
      root: path.join(packagedResourcesDir, 'models'),
    },
    {
      label: 'standalone-backup',
      root: path.join(packagedResourcesDir, 'standalone', 'resources', 'models'),
    },
  ];

  if (!hasCompleteModel(sourceModelsRoot)) {
    throw new Error(
      `[afterPack:models] Source embedding model is incomplete: ${listMissingFiles(sourceModelsRoot).join(', ')}`,
    );
  }

  for (const target of packagedTargets) {
    if (!hasCompleteModel(target.root)) {
      console.warn(
        `[afterPack:models] Packaged embedding model missing files in ${target.label}; copying bundled model directory`,
      );
      fs.mkdirSync(target.root, { recursive: true });
      fs.cpSync(sourceModelsRoot, target.root, { recursive: true, force: true });
    }

    if (!hasCompleteModel(target.root)) {
      throw new Error(
        `[afterPack:models] Packaged embedding model is still incomplete after copy (${target.label}): ${listMissingFiles(target.root).join(', ')}`,
      );
    }

    console.log(
      `[afterPack:models] Verified embedding model (${target.label}) at ${path.join(target.root, MODEL_RELATIVE_DIR)}`,
    );
  }
};
