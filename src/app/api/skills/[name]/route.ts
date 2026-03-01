import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import crypto from 'crypto';
import matter from 'gray-matter';
import { getSkillByNameAndScope, deleteSkill, updateSkill } from '@/lib/db';

interface ErrorResponse {
  error: string;
}

interface SuccessResponse {
  success: boolean;
}

interface SkillResponse {
  id: string;
  name: string;
  description: string;
  scope: 'builtin' | 'user';
  is_enabled: boolean;
  content: string;
}

function calculateFileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ==========================================
// GET - Get skill content by name
// ==========================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse<{ skill: SkillResponse } | ErrorResponse>> {
  try {
    const { name } = await params;
    const scope = request.nextUrl.searchParams.get('scope') as 'builtin' | 'user' | null;

    // Try to find skill (prefer user scope if not specified)
    let skill = scope ? getSkillByNameAndScope(name, scope) : null;
    if (!skill) {
      skill = getSkillByNameAndScope(name, 'user') || getSkillByNameAndScope(name, 'builtin');
    }

    if (!skill) {
      return NextResponse.json(
        { error: `Skill "${name}" not found` },
        { status: 404 }
      );
    }

    // Read file content
    let content = '';
    if (fs.existsSync(skill.file_path)) {
      content = fs.readFileSync(skill.file_path, 'utf-8');
    }

    return NextResponse.json({
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        is_enabled: skill.is_enabled === 1,
        content,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read skill' },
      { status: 500 }
    );
  }
}

// ==========================================
// PUT - Update skill content
// ==========================================

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const { name } = await params;
    const body = await request.json();
    const { content, description } = body;

    // Only allow updating user-scope skills
    const skill = getSkillByNameAndScope(name, 'user');
    if (!skill) {
      return NextResponse.json(
        { error: `Skill "${name}" not found or is not editable` },
        { status: 404 }
      );
    }

    // Update file if content provided
    if (content !== undefined) {
      fs.writeFileSync(skill.file_path, content, 'utf-8');
    }

    // Parse description from content if not provided
    let skillDescription = description;
    if (!skillDescription && content) {
      const { data } = matter(content);
      skillDescription = data.description;
    }

    // Update database record
    const contentHash = content !== undefined ? calculateFileHash(content) : skill.content_hash;
    updateSkill(skill.id, {
      description: skillDescription,
      content_hash: contentHash,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update skill' },
      { status: 500 }
    );
  }
}

// ==========================================
// DELETE - Delete user skill
// ==========================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const { name } = await params;

    // Only allow deleting user-scope skills
    const skill = getSkillByNameAndScope(name, 'user');
    if (!skill) {
      return NextResponse.json(
        { error: `Skill "${name}" not found or is not deletable` },
        { status: 404 }
      );
    }

    // Delete file
    if (fs.existsSync(skill.file_path)) {
      fs.unlinkSync(skill.file_path);
    }

    // Delete database record
    const deleted = deleteSkill(skill.id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete skill from database' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete skill' },
      { status: 500 }
    );
  }
}

