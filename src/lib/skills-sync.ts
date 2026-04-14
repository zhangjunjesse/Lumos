import fs from 'fs';
import path from 'path';
import os from 'os';
import { getEnabledSkills, type SkillRecord } from './db/skills';
import { dataDir } from './db/connection';
import { getVenvPythonPath } from './python-venv';
import { resolvePythonBinary } from './python-runtime';

const SKILLS_PLUGIN_DIR = path.join(os.homedir(), '.lumos', 'skills-plugin');
const SKILLS_DIR = path.join(SKILLS_PLUGIN_DIR, 'skills');

/**
 * Sync enabled skills from database to custom plugin directory.
 * Creates a plugin structure that SDK can load via plugins option.
 *
 * @returns Path to the plugin directory
 */
export function syncSkillsToPlugin(): string {
  const enabledSkills = getEnabledSkills();

  ensurePluginStructure();

  const existingDirs = getExistingSkillDirs();
  const currentDirs = new Set<string>();

  for (const skill of enabledSkills) {
    // Create skill-name/SKILL.md structure
    const skillDirName = skill.name;
    const targetPath = path.join(SKILLS_DIR, skillDirName, 'SKILL.md');
    currentDirs.add(skillDirName);

    copySkillFile(skill, targetPath);
  }

  cleanupDisabledSkills(existingDirs, currentDirs);

  return SKILLS_PLUGIN_DIR;
}

/**
 * Ensure plugin directory structure exists.
 * Creates ~/.lumos/skills-plugin/skills/ directory.
 */
function ensurePluginStructure(): void {
  if (!fs.existsSync(SKILLS_PLUGIN_DIR)) {
    fs.mkdirSync(SKILLS_PLUGIN_DIR, { recursive: true });
  }

  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

/**
 * Get list of existing skill directories in plugin directory.
 */
function getExistingSkillDirs(): Set<string> {
  const dirs = new Set<string>();

  if (fs.existsSync(SKILLS_DIR)) {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.add(entry.name);
      }
    }
  }

  return dirs;
}

/**
 * Copy skill file from source to target directory.
 * - Single-file skill (file_path ends in foo.md not named SKILL.md under a skill dir):
 *   copy file → target SKILL.md.
 * - Folder skill (file_path = .../skill-name/SKILL.md): recursively mirror the
 *   whole folder so bundled scripts/presets/assets are available at runtime.
 */
function copySkillFile(skill: SkillRecord, targetPath: string): void {
  const sourcePath = skill.file_path;

  if (!fs.existsSync(sourcePath)) {
    console.warn(`[skills-sync] Source file not found: ${sourcePath}`);
    return;
  }

  const skillDir = path.dirname(targetPath);
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  const isFolderSkill = path.basename(sourcePath) === 'SKILL.md';

  try {
    if (isFolderSkill) {
      const sourceDir = path.dirname(sourcePath);
      mirrorDirectory(sourceDir, skillDir);
      console.log(`[skills-sync] Synced folder skill: ${skill.name}`);
    } else {
      // Single-file skill: treat the .md as text and do placeholder substitution
      writeTextFileIfChanged(sourcePath, targetPath);
      console.log(`[skills-sync] Synced skill: ${skill.name}`);
    }
  } catch (error) {
    console.error(`[skills-sync] Failed to copy ${skill.name}:`, error);
  }
}

/**
 * Mirror source folder into target folder: copy changed files, delete stale ones.
 * Keeps the target in sync without bumping unchanged file mtimes.
 * Markdown files have runtime placeholders substituted; other files copy byte-for-byte.
 */
function mirrorDirectory(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const sourceEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map(e => e.name));

  for (const entry of sourceEntries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      mirrorDirectory(src, dst);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.md')) {
        writeTextFileIfChanged(src, dst);
      } else if (!fs.existsSync(dst) || hasFileChanged(src, dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  // Remove target entries that no longer exist in source.
  if (fs.existsSync(targetDir)) {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!sourceNames.has(entry.name)) {
        fs.rmSync(path.join(targetDir, entry.name), { recursive: true, force: true });
      }
    }
  }
}

/**
 * Check if source file has changed compared to target (byte-level).
 * Used for binary/script files where no substitution happens.
 */
function hasFileChanged(sourcePath: string, targetPath: string): boolean {
  try {
    const sStat = fs.statSync(sourcePath);
    const tStat = fs.statSync(targetPath);
    if (sStat.size !== tStat.size) return true;
    const sourceBuf = fs.readFileSync(sourcePath);
    const targetBuf = fs.readFileSync(targetPath);
    return !sourceBuf.equals(targetBuf);
  } catch {
    return true;
  }
}

/**
 * Read source text file, apply placeholder substitution, write only if
 * the resolved content differs from the target — avoids bumping mtimes.
 */
function writeTextFileIfChanged(sourcePath: string, targetPath: string): void {
  const raw = fs.readFileSync(sourcePath, 'utf-8');
  const resolved = substitutePlaceholders(raw);
  if (fs.existsSync(targetPath)) {
    try {
      const existing = fs.readFileSync(targetPath, 'utf-8');
      if (existing === resolved) return;
    } catch {
      // fall through to write
    }
  }
  fs.writeFileSync(targetPath, resolved, 'utf-8');
}

/**
 * Replace runtime placeholders in skill text with their resolved paths.
 * Mirrors the set handled by mcp-resolver so skill docs and MCP configs stay consistent.
 */
function substitutePlaceholders(text: string): string {
  const pythonPath = resolvePythonBinary() || getVenvPythonPath();
  const runtimePath = resolveRuntimePath();
  // Use function replacer so literal `$` in paths isn't interpreted as $&/$1.
  return text
    .replace(/\[PYTHON_PATH\]/g, () => pythonPath)
    .replace(/\[DATA_DIR\]/g, () => dataDir)
    .replace(/\[RUNTIME_PATH\]/g, () => runtimePath);
}

function resolveRuntimePath(): string {
  if (process.env.NODE_ENV === 'production' && typeof process.resourcesPath === 'string') {
    return process.resourcesPath;
  }
  return path.join(process.cwd(), 'resources');
}

/**
 * Remove skill directories that are no longer enabled.
 */
function cleanupDisabledSkills(existingDirs: Set<string>, currentDirs: Set<string>): void {
  for (const dirName of existingDirs) {
    if (!currentDirs.has(dirName)) {
      const dirPath = path.join(SKILLS_DIR, dirName);
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`[skills-sync] Removed disabled skill: ${dirName}`);
      } catch (error) {
        console.error(`[skills-sync] Failed to remove ${dirName}:`, error);
      }
    }
  }
}
