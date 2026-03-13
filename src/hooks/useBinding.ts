"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  Binding,
  SyncStats,
  UpdateBindingResponse,
  GetStatsResponse,
} from "@/components/bridge/types";

export function useBinding(sessionId: string) {
  const [binding, setBinding] = useState<Binding | null>(null);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBinding = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/bridge/bindings?sessionId=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const data: { bindings?: Binding[] } = await res.json();
        setBinding((data.bindings && data.bindings[0]) || null);
      } else {
        setBinding(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch binding");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const fetchStats = useCallback(async (_bindingId: number) => {
    try {
      const res = await fetch(`/api/bridge/stats?sessionId=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const data: GetStatsResponse = await res.json();
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
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
  }, []);

  const deleteBinding = useCallback(async (bindingId: number) => {
    try {
      const res = await fetch(`/api/bridge/bindings/${bindingId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBinding(null);
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

  useEffect(() => {
    fetchBinding();
  }, [fetchBinding]);

  useEffect(() => {
    if (binding?.id) {
      fetchStats(binding.id);
    }
  }, [binding?.id, fetchStats]);

  return {
    binding,
    stats,
    loading,
    error,
    refetch: fetchBinding,
    updateBinding,
    deleteBinding,
  };
}
