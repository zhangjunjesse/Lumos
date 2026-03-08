"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add, Search, Zap, Loading, Delete, Pencil, Copy } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";

interface Skill {
  id: string;
  name: string;
  description: string;
  scope: 'builtin' | 'user';
  is_enabled: boolean;
}

interface SkillsManagerProps {
  refreshKey?: number;
}

export function SkillsManager({ refreshKey = 0 }: SkillsManagerProps) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills || []);
      }
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills, refreshKey]);

  const handleToggle = useCallback(async (skill: Skill, enabled: boolean) => {
    try {
      await fetch('/api/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: skill.name, scope: skill.scope, is_enabled: enabled }),
      });
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, is_enabled: enabled } : s));
    } catch (error) {
      console.error('Failed to toggle skill:', error);
    }
  }, []);

  const handleDelete = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSkills(prev => prev.filter(s => s.name !== name));
      }
    } catch (error) {
      console.error('Failed to delete skill:', error);
    }
  }, []);

  const handleCopyToUser = useCallback(async (skill: Skill) => {
    try {
      // Fetch skill content first
      const getRes = await fetch(`/api/skills/${encodeURIComponent(skill.name)}?scope=builtin`);
      if (!getRes.ok) return;

      const { skill: fullSkill } = await getRes.json();

      // Create a copy with user scope
      const newName = `${skill.name}-copy`;
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          content: fullSkill.content,
          description: skill.description,
        }),
      });

      if (res.ok) {
        fetchSkills();
      }
    } catch (error) {
      console.error('Failed to copy skill:', error);
    }
  }, [fetchSkills]);

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  );

  const builtinSkills = filtered.filter((s) => s.scope === 'builtin');
  const userSkills = filtered.filter((s) => s.scope === 'user');

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <HugeiconsIcon icon={Loading} className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          {t('skills.loadingSkills')}
        </span>
      </div>
    );
  }

  const renderSkillCard = (skill: Skill) => {
    const isBuiltin = skill.scope === 'builtin';

    return (
      <Card key={skill.id} className={!skill.is_enabled ? 'opacity-60' : ''}>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div className="flex-1 min-w-0 mr-3">
            <div className="flex items-center gap-2 mb-1">
              <HugeiconsIcon icon={Zap} className="h-4 w-4 shrink-0 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">/{skill.name}</CardTitle>
              {isBuiltin && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  Built-in
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs mt-1">
              {skill.description}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={skill.is_enabled}
              onCheckedChange={(checked) => handleToggle(skill, checked)}
            />
            {isBuiltin ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => handleCopyToUser(skill)}
                title="Copy to User"
              >
                <HugeiconsIcon icon={Copy} className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {/* TODO: Edit */}}
                >
                  <HugeiconsIcon icon={Pencil} className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(skill.name)}
                >
                  <HugeiconsIcon icon={Delete} className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </CardHeader>
      </Card>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-lg font-semibold flex-1">{t('extensions.skills')}</h3>
        <div className="relative flex-1 max-w-sm">
          <HugeiconsIcon icon={Search} className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('skills.searchSkills')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-8 text-sm"
          />
        </div>
        <Button size="sm" onClick={() => {/* TODO: Create */}} className="gap-1">
          <HugeiconsIcon icon={Add} className="h-3.5 w-3.5" />
          {t('skills.newSkill')}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-6">
        {/* Built-in Skills */}
        {builtinSkills.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3 text-muted-foreground">Built-in Skills</h4>
            <div className="space-y-2">
              {builtinSkills.map(renderSkillCard)}
            </div>
          </div>
        )}

        {/* User Skills */}
        {userSkills.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3 text-muted-foreground">User Skills</h4>
            <div className="space-y-2">
              {userSkills.map(renderSkillCard)}
            </div>
          </div>
        )}

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <HugeiconsIcon icon={Zap} className="h-10 w-10 opacity-40" />
            <p className="text-sm">
              {search ? t('skills.noSkillsFound') : t('skills.noSkillsFound')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
