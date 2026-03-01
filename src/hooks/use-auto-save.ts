"use client";

import { useRef, useCallback, useState, useEffect } from "react";

type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  onSave: (content: string) => Promise<void>;
  debounceMs?: number;
  backupKey?: string;
}

export function useAutoSave({
  onSave,
  debounceMs = 2000,
  backupKey,
}: UseAutoSaveOptions) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef("");
  const savingRef = useRef(false);

  const doSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      await onSave(contentRef.current);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch {
      setStatus("error");
    } finally {
      savingRef.current = false;
    }
  }, [onSave]);

  const scheduleDebounce = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(doSave, debounceMs);
  }, [doSave, debounceMs]);

  const markChanged = useCallback(
    (content: string) => {
      contentRef.current = content;
      setStatus("unsaved");
      scheduleDebounce();
    },
    [scheduleDebounce]
  );

  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    doSave();
  }, [doSave]);

  // localStorage backup every 30s
  useEffect(() => {
    if (!backupKey) return;
    const interval = setInterval(() => {
      if (contentRef.current) {
        localStorage.setItem(backupKey, contentRef.current);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [backupKey]);

  // Cmd+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveNow]);

  // beforeunload
  useEffect(() => {
    const handler = () => {
      if (status === "unsaved" && contentRef.current) {
        onSave(contentRef.current);
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status, onSave]);

  return { status, markChanged, saveNow };
}
