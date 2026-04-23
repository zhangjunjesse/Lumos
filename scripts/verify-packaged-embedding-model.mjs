import fs from 'node:fs';
import path from 'node:path';

const PACKAGED_MODEL_LOCATIONS = [
  { label: 'primary', relativeDir: path.join('models', 'Xenova', 'bge-small-zh-v1.5') },
  { label: 'standalone-backup', relativeDir: path.join('standalone', 'resources', 'models', 'Xenova', 'bge-small-zh-v1.5') },
];
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

function listMissingFiles(resourcesDir, relativeDir) {
  const modelDir = path.join(resourcesDir, relativeDir);
  return REQUIRED_MODEL_FILES.filter((relativePath) => !fs.existsSync(path.join(modelDir, relativePath)));
}

function verifyTarget(inputPath) {
  const checkedPaths = [];
  const failures = [];

  for (const candidate of resolveCandidatePaths(inputPath)) {
    checkedPaths.push(candidate);
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const missingByLocation = PACKAGED_MODEL_LOCATIONS
      .map((location) => ({
        label: location.label,
        relativeDir: location.relativeDir,
        missingFiles: listMissingFiles(candidate, location.relativeDir),
      }))
      .filter((entry) => entry.missingFiles.length > 0);

    if (missingByLocation.length === 0) {
      for (const location of PACKAGED_MODEL_LOCATIONS) {
        console.log(`[verify-packaged-embedding-model] OK (${location.label}): ${path.join(candidate, location.relativeDir)}`);
      }
      return;
    }

    failures.push(
      `${candidate}: ${missingByLocation.map((entry) => `${entry.label}[${entry.missingFiles.join(', ')}]`).join(' ; ')}`,
    );
  }

  throw new Error(
    `[verify-packaged-embedding-model] Missing packaged embedding model under ${inputPath}; checked: ${checkedPaths.join(', ')}; failures: ${failures.join(' | ')}`,
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
