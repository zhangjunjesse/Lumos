"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  Binding,
  BridgeHealthBinding,
  BridgeHealthView,
  SyncStats,
  UpdateBindingResponse,
  GetStatsResponse,
} from "@/components/bridge/types";

export function useBinding(sessionId: string) {
  const [binding, setBinding] = useState<Binding | null>(null);
  const [health, setHealth] = useState<BridgeHealthBinding | null>(null);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBinding = useCallback(async (): Promise<Binding | null> => {
    try {
      setLoading(true);
      const res = await fetch(`/api/bridge/bindings?sessionId=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const data: { bindings?: Binding[] } = await res.json();
        const nextBinding = (data.bindings && data.bindings[0]) || null;
        setBinding(nextBinding);
        setError(null);
        return nextBinding;
      } else {
        setBinding(null);
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch binding");
      return null;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/bridge/stats?sessionId=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const data: GetStatsResponse = await res.json();
        setStats(data.stats);
      } else {
        setStats(null);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, [sessionId]);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`/api/bridge/health?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data: BridgeHealthView = await res.json();
        setHealth((data.bindings && data.bindings[0]) || null);
      } else {
        setHealth(null);
      }
    } catch (err) {
      console.error("Failed to fetch bridge health:", err);
    }
  }, [sessionId]);

  const updateBinding = useCallback(async (
    bindingId: number,
    updates: { status?: "active" | "inactive" | "expired" }
  ) => {
    try {
      const res = await fetch(`/api/bridge/bindings/${bindingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data: UpdateBindingResponse = await res.json();
        setBinding(data.binding);
        await fetchHealth();
        await fetchStats();
        return { success: true };
      } else {
        const errorData = await res.json();
        return { success: false, error: errorData.error };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to update binding",
      };
    }
  }, [fetchHealth, fetchStats]);

  const deleteBinding = useCallback(async (bindingId: number) => {
    try {
      const res = await fetch(`/api/bridge/bindings/${bindingId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBinding(null);
        setHealth(null);
        setStats(null);
        return { success: true };
      } else {
        const errorData = await res.json();
        return { success: false, error: errorData.error };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to delete binding",
      };
    }
  }, []);

  const retryLatestFailedInbound = useCallback(async () => {
    const eventId = health?.latestRetryableInboundEventId;
    if (!eventId) {
      return { success: false, error: "没有可重试的异常消息" };
    }

    try {
      const res = await fetch(`/api/bridge/events/${encodeURIComponent(eventId)}/retry`, {
        method: "POST",
      });
      if (!res.ok) {
        const errorData = await res.json();
        return { success: false, error: errorData.error || "重试失败" };
      }

      await fetchHealth();
      await fetchStats();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "重试失败",
      };
    }
  }, [fetchHealth, fetchStats, health?.latestRetryableInboundEventId]);

  const refetch = useCallback(async () => {
    const nextBinding = await fetchBinding();
    await fetchHealth();
    if (nextBinding?.id) {
      await fetchStats();
    } else {
      setStats(null);
    }
  }, [fetchBinding, fetchHealth, fetchStats]);

  useEffect(() => {
    void fetchBinding();
    void fetchHealth();
  }, [fetchBinding, fetchHealth]);

  useEffect(() => {
    if (binding?.id) {
      void fetchStats();
      return;
    }
    setStats(null);
  }, [binding?.id, fetchStats]);

  useEffect(() => {
    if (!binding) return;

    const timer = window.setInterval(() => {
      void fetchHealth();
      void fetchStats();
    }, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, [binding, fetchHealth, fetchStats]);

  return {
    binding,
    health,
    stats,
    loading,
    error,
    refetch,
    updateBinding,
    deleteBinding,
    retryLatestFailedInbound,
  };
}
