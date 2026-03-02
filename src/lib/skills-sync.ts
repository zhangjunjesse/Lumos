import fs from 'fs';
import path from 'path';
import os from 'os';
import { getEnabledSkills, type SkillRecord } from './db/skills';

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
 * Creates skill-name/SKILL.md structure as expected by SDK.
 * Only copies if file doesn't exist or content has changed.
 */
function copySkillFile(skill: SkillRecord, targetPath: string): void {
  const sourcePath = skill.file_path;

  if (!fs.existsSync(sourcePath)) {
    console.warn(`[skills-sync] Source file not found: ${sourcePath}`);
    return;
  }

  // Create skill directory (e.g., skills/knowledge-search/)
  const skillDir = path.dirname(targetPath);
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  const shouldCopy = !fs.existsSync(targetPath) || hasFileChanged(sourcePath, targetPath);

  if (shouldCopy) {
    try {
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`[skills-sync] Synced skill: ${skill.name}`);
    } catch (error) {
      console.error(`[skills-sync] Failed to copy ${skill.name}:`, error);
    }
  }
}

/**
 * Check if source file has changed compared to target.
 */
function hasFileChanged(sourcePath: string, targetPath: string): boolean {
  try {
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const targetContent = fs.readFileSync(targetPath, 'utf-8');
    return sourceContent !== targetContent;
  } catch {
    return true;
  }
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
