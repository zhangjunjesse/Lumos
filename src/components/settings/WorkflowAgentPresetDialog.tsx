"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import type { WorkflowAgentPreset } from "@/lib/db/workflow-agent-presets";

type RoleValue = "worker" | "researcher" | "coder" | "integration" | "";

interface FormState {
  name: string;
  description: string;
  expertise: string;
  role: RoleValue;
  systemPrompt: string;
}

function emptyForm(): FormState {
  return { name: "", description: "", expertise: "", role: "", systemPrompt: "" };
}

function presetToForm(preset: WorkflowAgentPreset): FormState {
  return {
    name: preset.name,
    description: preset.description ?? "",
    expertise: preset.config.expertise,
    role: (preset.config.role ?? "") as RoleValue,
    systemPrompt: preset.config.systemPrompt ?? "",
  };
}

interface Props {
  open: boolean;
  preset?: WorkflowAgentPreset | null;
  onClose: () => void;
  onSaved: () => void;
}

export function WorkflowAgentPresetDialog({ open, preset, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(preset ? presetToForm(preset) : emptyForm());
      setError(null);
    }
  }, [open, preset]);

  const isEdit = Boolean(preset);

  async function handleSave() {
    if (!form.name.trim() || !form.expertise.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        expertise: form.expertise.trim(),
        role: form.role || undefined,
        systemPrompt: form.systemPrompt.trim() || undefined,
      };
      const url = isEdit
        ? `/api/workflow/workflow-agent-presets/${preset!.id}`
        : "/api/workflow/workflow-agent-presets";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || t("wapSettings.errorSave"));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wapSettings.errorSave"));
    } finally {
      setSaving(false);
    }
  }

  const roleOptions: { value: RoleValue; label: string }[] = [
    { value: "worker", label: t("wapSettings.roleWorker") },
    { value: "researcher", label: t("wapSettings.roleResearcher") },
    { value: "coder", label: t("wapSettings.roleCoder") },
    { value: "integration", label: t("wapSettings.roleIntegration") },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("wapSettings.editPreset") : t("wapSettings.addPreset")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wap-name">{t("wapSettings.fieldName")}</Label>
            <Input
              id="wap-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. 深度研究员"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wap-expertise">{t("wapSettings.fieldExpertise")}</Label>
            <Input
              id="wap-expertise"
              value={form.expertise}
              onChange={(e) => setForm((f) => ({ ...f, expertise: e.target.value }))}
              placeholder="e.g. 从网页证据中提炼事实，适合分析型任务"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wap-role">{t("wapSettings.fieldRole")}</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v as RoleValue }))}
            >
              <SelectTrigger id="wap-role">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wap-description">{t("wapSettings.fieldDescription")}</Label>
            <Input
              id="wap-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="optional"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wap-system-prompt">{t("wapSettings.fieldSystemPrompt")}</Label>
            <Textarea
              id="wap-system-prompt"
              rows={5}
              value={form.systemPrompt}
              onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
              placeholder="optional — overrides the default system prompt for this role"
              className="resize-none font-mono text-xs"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("wapSettings.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.expertise.trim()}
          >
            {t("wapSettings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
