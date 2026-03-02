import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
import {
  getAllSkills,
  createSkill,
  updateSkill,
  getSkillByNameAndScope,
  toggleSkillEnabled,
} from '@/lib/db';
import { dataDir } from '@/lib/db/connection';

// ==========================================
// Types
// ==========================================

interface SkillResponse {
  id: string;
  name: string;
  description: string;
  scope: 'builtin' | 'user';
  is_enabled: boolean;
  content?: string;
}

interface ErrorResponse {
  error: string;
}

interface SuccessResponse {
  success: boolean;
  skill?: SkillResponse;
}

// ==========================================
// Helper Functions
// ==========================================

function calculateFileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getUserSkillsDir(): string {
  return path.join(dataDir, 'skills', 'user');
}

function readSkillContent(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}

// ==========================================
// GET - List all skills
// ==========================================

export async function GET(): Promise<NextResponse<{ skills: SkillResponse[] } | ErrorResponse>> {
  try {
    // Load all skills from database
    const skillRecords = getAllSkills();

    // Convert to response format
    const skills: SkillResponse[] = skillRecords.map(record => ({
      id: record.id,
      name: record.name,
      description: record.description,
      scope: record.scope,
      is_enabled: record.is_enabled === 1,
    }));

    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load skills' },
      { status: 500 }
    );
  }
}

// ==========================================
// POST - Create new user skill
// ==========================================

export async function POST(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const { name, content, description } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    // Check if skill already exists
    const existing = getSkillByNameAndScope(name, 'user');
    if (existing) {
      return NextResponse.json(
        { error: `Skill "${name}" already exists` },
        { status: 409 }
      );
    }

    // Ensure user skills directory exists
    const userSkillsDir = getUserSkillsDir();
    if (!fs.existsSync(userSkillsDir)) {
      fs.mkdirSync(userSkillsDir, { recursive: true });
    }

    // Write skill file
    const fileName = `${name}.md`;
    const filePath = path.join(userSkillsDir, fileName);
    const skillContent = content || '';
    fs.writeFileSync(filePath, skillContent, 'utf-8');

    // Parse description from content if not provided
    let skillDescription = description;
    if (!skillDescription && skillContent) {
      const { data } = matter(skillContent);
      skillDescription = data.description || `Skill: ${name}`;
    }

    // Create database record
    const contentHash = calculateFileHash(skillContent);
    const record = createSkill({
      name,
      scope: 'user',
      description: skillDescription || `Skill: ${name}`,
      file_path: filePath,
      content_hash: contentHash,
      is_enabled: true,
    });

    return NextResponse.json({
      success: true,
      skill: {
        id: record.id,
        name: record.name,
        description: record.description,
        scope: record.scope,
        is_enabled: record.is_enabled === 1,
      },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create skill' },
      { status: 500 }
    );
  }
}

// ==========================================
// PATCH - Toggle skill enabled/disabled
// ==========================================

export async function PATCH(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const { name, scope, is_enabled } = body;

    if (!name || typeof is_enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required fields: name, is_enabled' },
        { status: 400 }
      );
    }

    const skill = getSkillByNameAndScope(name, scope || 'user') ||
      getSkillByNameAndScope(name, scope === 'user' ? 'builtin' : 'user');

    if (!skill) {
      return NextResponse.json(
        { error: `Skill "${name}" not found` },
        { status: 404 }
      );
    }

    toggleSkillEnabled(skill.id, is_enabled);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle skill' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const { name, content, description } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    // Only allow updating user-scope skills
    const existing = getSkillByNameAndScope(name, 'user');
    if (!existing) {
      return NextResponse.json(
        { error: `Skill "${name}" not found or is not editable` },
        { status: 404 }
      );
    }

    // Update file if content provided
    if (content !== undefined) {
      fs.writeFileSync(existing.file_path, content, 'utf-8');
    }

    // Parse description from content if not provided
    let skillDescription = description;
    if (!skillDescription && content) {
      const { data } = matter(content);
      skillDescription = data.description;
    }

    // Update database record
    const contentHash = content !== undefined ? calculateFileHash(content) : existing.content_hash;
    const updated = updateSkill(existing.id, {
      description: skillDescription,
      content_hash: contentHash,
    });

    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update skill' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      skill: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        scope: updated.scope,
        is_enabled: updated.is_enabled === 1,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update skill' },
      { status: 500 }
    );
  }
}

