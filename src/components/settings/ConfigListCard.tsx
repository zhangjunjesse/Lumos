'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Plus,
  Check,
  Trash2,
  Edit2,
  Loader2,
  Eye,
  EyeOff,
  ChevronRight,
} from 'lucide-react';

interface ApiConfig {
  id: number;
  name: string;
  base_url: string;
  api_key: string;
  model_name?: string;
  is_active: number;
  is_builtin?: number;
  user_modified?: number;
  created_at: string;
  updated_at: string;
}

export function ConfigListCard() {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<number | null>(null);

  // Add/Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ApiConfig | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    base_url: '',
    api_key: '',
    model_name: '',
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<ApiConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const providers = data.providers || [];
      setConfigs(providers);
    } catch (error) {
      console.error('Failed to load configs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();

    // Listen for config changes
    const handleConfigChange = () => fetchConfigs();
    window.addEventListener('provider-changed', handleConfigChange);
    return () => window.removeEventListener('provider-changed', handleConfigChange);
  }, [fetchConfigs]);

  const handleSwitch = async (configId: number) => {
    setSwitching(configId);
    try {
      const res = await fetch(`/api/providers/${configId}/activate`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to switch');
      await fetchConfigs();
      window.dispatchEvent(new Event('provider-changed'));
    } catch (error) {
      console.error('Failed to switch config:', error);
    } finally {
      setSwitching(null);
    }
  };

  const handleOpenAddDialog = () => {
    setEditingConfig(null);
    setFormData({ name: '', base_url: '', api_key: '', model_name: '' });
    setShowApiKey(false);
    setTestMessage(null);
    setDialogOpen(true);
  };

  const handleOpenEditDialog = (config: ApiConfig) => {
    setEditingConfig(config);
    setFormData({
      name: config.name,
      base_url: config.base_url,
      api_key: config.api_key,
      model_name: config.model_name || '',
    });
    setShowApiKey(false);
    setTestMessage(null);
    setDialogOpen(true);
  };

  const handleTest = async () => {
    if (!formData.api_key) {
      setTestMessage({ type: 'error', text: 'API Key 不能为空' });
      return;
    }

    setTesting(true);
    setTestMessage(null);

    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: formData.api_key,
          baseUrl: formData.base_url || 'https://api.anthropic.com',
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setTestMessage({ type: 'success', text: '连接测试成功' });
      } else {
        setTestMessage({ type: 'error', text: data.error || '连接测试失败' });
      }
    } catch (error) {
      setTestMessage({ type: 'error', text: '连接测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.api_key) {
      return;
    }

    setSaving(true);
    try {
      const url = editingConfig
        ? `/api/providers/${editingConfig.id}`
        : '/api/providers';
      const method = editingConfig ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error('Failed to save');
      await fetchConfigs();
      setDialogOpen(false);
      window.dispatchEvent(new Event('provider-changed'));
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/providers/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      await fetchConfigs();
      setDeleteTarget(null);
      window.dispatchEvent(new Event('provider-changed'));
    } catch (error) {
      console.error('Failed to delete config:', error);
    } finally {
      setDeleting(false);
    }
  };

  const maskApiKey = (key: string) => {
    if (!key || key.length < 8) return '••••••••';
    return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium">
                API 配置管理
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                管理和切换不同的 API 配置
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenAddDialog}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              添加配置
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {configs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-3">
                还没有配置
              </p>
            </div>
          ) : (
            configs.map((config) => {
              const isActive = config.is_active === 1;
              const isBuiltin = config.is_builtin === 1;
              const isSwitching = switching === config.id;

              return (
                <div
                  key={config.id}
                  className={`
                    group relative flex items-center gap-3 p-3 rounded-lg border
                    transition-colors cursor-pointer
                    ${isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-border/80 hover:bg-muted/50'
                    }
                  `}
                  onClick={() => !isActive && !isSwitching && handleSwitch(config.id)}
                >
                  {/* Left: Icon & Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">
                        {config.name}
                      </span>
                      {isBuiltin && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          内置
                        </Badge>
                      )}
                      {isActive && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                          <Check className="h-3 w-3 mr-0.5" />
                          当前
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div className="truncate">{config.base_url || 'https://api.anthropic.com'}</div>
                      <div className="truncate">API Key: {maskApiKey(config.api_key)}</div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1">
                    {isSwitching ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : isActive ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditDialog(config);
                          }}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        {!isBuiltin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(config);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                    {!isActive && !isSwitching && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingConfig ? '编辑配置' : '添加新配置'}
            </DialogTitle>
            <DialogDescription>
              {editingConfig ? '修改 API 配置信息' : '添加一个新的 API 配置'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">配置名称</Label>
              <Input
                id="name"
                placeholder="例如：Claude Official"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base_url">Base URL（可选）</Label>
              <Input
                id="base_url"
                placeholder="https://api.anthropic.com"
                value={formData.base_url}
                onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api_key">API Key</Label>
              <div className="relative">
                <Input
                  id="api_key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="sk-ant-..."
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="model_name">模型名称（可选）</Label>
              <Input
                id="model_name"
                placeholder="claude-sonnet-4.5"
                value={formData.model_name}
                onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
              />
            </div>
            {testMessage && (
              <Alert variant={testMessage.type === 'error' ? 'destructive' : 'default'}>
                <AlertDescription>{testMessage.text}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || saving || !formData.api_key}
            >
              {testing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  测试中...
                </>
              ) : (
                '测试连接'
              )}
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving || testing || !formData.name || !formData.api_key}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                '保存'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除配置 <strong>{deleteTarget?.name}</strong> 吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  删除中...
                </>
              ) : (
                '删除'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
