"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, Logout02Icon, Login01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { useFeishu } from "@/hooks/useFeishu";
import { useTranslation } from "@/hooks/useTranslation";

export function FeishuAuth() {
  const { auth, login, logout, refreshAuth } = useFeishu();
  const { t } = useTranslation();
  const [actionLoading, setActionLoading] = useState(false);

  async function handleLogin() {
    setActionLoading(true);
    try {
      await login();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleLogout() {
    setActionLoading(true);
    try {
      await logout();
      await refreshAuth();
    } finally {
      setActionLoading(false);
    }
  }

  if (auth.loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />
        <span className="ml-2 text-sm">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{t('feishu.authTitle')}</CardTitle>
            <CardDescription className="mt-1">{t('feishu.authDesc')}</CardDescription>
          </div>
          <Badge variant={auth.authenticated ? "default" : "secondary"}>
            {auth.authenticated ? t('feishu.connected') : t('feishu.notConnected')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {auth.authenticated && auth.user ? (
          <AuthenticatedView
            user={auth.user}
            onLogout={handleLogout}
            loading={actionLoading}
          />
        ) : (
          <UnauthenticatedView
            onLogin={handleLogin}
            loading={actionLoading}
          />
        )}
      </CardContent>
    </Card>
  );
}

// 已登录视图
function AuthenticatedView({
  user,
  onLogout,
  loading,
}: {
  user: { name: string; avatarUrl?: string };
  onLogout: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-sm font-medium">{user.name}</p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3 w-3 text-green-500" />
            {t('feishu.authorized')}
          </div>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onLogout}
        disabled={loading}
        className="gap-1.5"
      >
        {loading ? (
          <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <HugeiconsIcon icon={Logout02Icon} className="h-3.5 w-3.5" />
        )}
        {t('feishu.logout')}
      </Button>
    </div>
  );
}

// 未登录视图
function UnauthenticatedView({
  onLogin,
  loading,
}: {
  onLogin: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <p className="text-sm text-muted-foreground text-center">
        {t('feishu.loginHint')}
      </p>
      <Button onClick={onLogin} disabled={loading} className="gap-1.5">
        {loading ? (
          <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <HugeiconsIcon icon={Login01Icon} className="h-3.5 w-3.5" />
        )}
        {t('feishu.login')}
      </Button>
    </div>
  );
}
