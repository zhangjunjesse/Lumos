import fs from 'node:fs';
import path from 'node:path';

const MODEL_RELATIVE_DIR = path.join('models', 'Xenova', 'bge-small-zh-v1.5');
const REQUIRED_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.txt',
  path.join('onnx', 'model_quantized.onnx'),
];

function resolveCandidatePaths(inputPath) {
  const absoluteInputPath = path.resolve(inputPath);
  return [
    absoluteInputPath,
    path.join(absoluteInputPath, 'resources'),
    path.join(absoluteInputPath, 'Lumos.app', 'Contents', 'Resources'),
    path.join(absoluteInputPath, 'Contents', 'Resources'),
  ];
}

function listMissingFiles(resourcesDir) {
  const modelDir = path.join(resourcesDir, MODEL_RELATIVE_DIR);
  return REQUIRED_MODEL_FILES.filter((relativePath) => !fs.existsSync(path.join(modelDir, relativePath)));
}

function verifyTarget(inputPath) {
  const checkedPaths = [];

  for (const candidate of resolveCandidatePaths(inputPath)) {
    checkedPaths.push(candidate);
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const missingFiles = listMissingFiles(candidate);
    if (missingFiles.length === 0) {
      console.log(`[verify-packaged-embedding-model] OK: ${path.join(candidate, MODEL_RELATIVE_DIR)}`);
      return;
    }
  }

  throw new Error(
    `[verify-packaged-embedding-model] Missing packaged embedding model under ${inputPath}; checked: ${checkedPaths.join(', ')}`,
  );
}

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error('Usage: node scripts/verify-packaged-embedding-model.mjs <path> [more-paths...]');
  process.exit(1);
}

for (const target of targets) {
  verifyTarget(target);
}
