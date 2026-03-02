#!/usr/bin/env tsx

/**
 * Import Anthropic official skills as builtin skills
 * Usage: tsx scripts/import-anthropic-skills.ts
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { createSkill, getSkillByNameAndScope } from '../src/lib/db/skills';

const ANTHROPIC_SKILLS_DIR = '/tmp/anthropic-skills/skills';
const LUMOS_BUILTIN_DIR = path.join(os.homedir(), '.lumos', 'skills', 'builtin');

interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
}

/**
 * Parse YAML frontmatter from SKILL.md
 */
function parseFrontmatter(content: string): SkillFrontmatter | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter: any = {};
  const lines = frontmatterMatch[1].split('\n');

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      frontmatter[key] = value.trim();
    }
  }

  return frontmatter as SkillFrontmatter;
}

/**
 * Import a single skill
 */
async function importSkill(skillName: string): Promise<boolean> {
  const skillDir = path.join(ANTHROPIC_SKILLS_DIR, skillName);
  const skillFile = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    console.warn(`⚠️  Skipping ${skillName}: SKILL.md not found`);
    return false;
  }

  // Read and parse SKILL.md
  const content = fs.readFileSync(skillFile, 'utf-8');
  const frontmatter = parseFrontmatter(content);

  if (!frontmatter || !frontmatter.name) {
    console.warn(`⚠️  Skipping ${skillName}: Invalid frontmatter`);
    return false;
  }

  // Check if skill already exists
  const existing = getSkillByNameAndScope(frontmatter.name, 'builtin');
  if (existing) {
    console.log(`⏭️  Skipping ${frontmatter.name}: Already exists as builtin`);
    return false;
  }

  // Create target directory
  const targetDir = path.join(LUMOS_BUILTIN_DIR, skillName);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Copy SKILL.md
  const targetFile = path.join(targetDir, 'SKILL.md');
  fs.copyFileSync(skillFile, targetFile);

  // Copy LICENSE.txt if exists
  const licenseFile = path.join(skillDir, 'LICENSE.txt');
  if (fs.existsSync(licenseFile)) {
    fs.copyFileSync(licenseFile, path.join(targetDir, 'LICENSE.txt'));
  }

  // Calculate content hash
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');

  // Create database record
  try {
    createSkill({
      name: frontmatter.name,
      scope: 'builtin',
      description: frontmatter.description || `Anthropic official skill: ${frontmatter.name}`,
      file_path: targetFile,
      content_hash: contentHash,
      is_enabled: true,
    });

    console.log(`✅ Imported: ${frontmatter.name}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to import ${frontmatter.name}:`, error);
    return false;
  }
}

/**
 * Main import function
 */
async function main() {
  console.log('🚀 Starting Anthropic skills import...\n');

  // Ensure builtin directory exists
  if (!fs.existsSync(LUMOS_BUILTIN_DIR)) {
    fs.mkdirSync(LUMOS_BUILTIN_DIR, { recursive: true });
  }

  // Get all skill directories
  const skillDirs = fs.readdirSync(ANTHROPIC_SKILLS_DIR).filter((name) => {
    const fullPath = path.join(ANTHROPIC_SKILLS_DIR, name);
    return fs.statSync(fullPath).isDirectory();
  });

  console.log(`Found ${skillDirs.length} skills to import\n`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const skillName of skillDirs) {
    const result = await importSkill(skillName);
    if (result) {
      imported++;
    } else {
      skipped++;
    }
  }

  console.log(`\n📊 Import Summary:`);
  console.log(`   ✅ Imported: ${imported}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`\n✨ Done!`);
}

main().catch(console.error);
