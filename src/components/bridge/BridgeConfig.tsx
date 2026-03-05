"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BridgeConfigProps {
  appId?: string;
  appSecret?: string;
  onSave?: (config: { appId: string; appSecret: string }) => void;
}

export function BridgeConfig({ appId = "", appSecret = "", onSave }: BridgeConfigProps) {
  const [id, setId] = useState(appId);
  const [secret, setSecret] = useState(appSecret);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave?.({ appId: id, appSecret: secret });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="appId">App ID</Label>
        <Input id="appId" value={id} onChange={(e) => setId(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="appSecret">App Secret</Label>
        <Input id="appSecret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
      </div>
      <Button onClick={handleSave} disabled={saving}>
        {saving ? "保存中..." : "保存"}
      </Button>
    </div>
  );
}
