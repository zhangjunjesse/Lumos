'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { MemoryToast } from './memory-toast';
import type { MemoryRecord } from '@/lib/db/memories';

interface ToastData {
  id: string;
  memory: MemoryRecord;
  action: 'created' | 'updated' | 'failed';
  error?: string;
}

interface MemoryToastContextValue {
  showToast: (memory: MemoryRecord, action: 'created' | 'updated' | 'failed', error?: string) => void;
}

const MemoryToastContext = createContext<MemoryToastContextValue | null>(null);

export function useMemoryToast() {
  const context = useContext(MemoryToastContext);
  if (!context) throw new Error('useMemoryToast must be used within MemoryToastProvider');
  return context;
}

export function MemoryToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const showToast = useCallback((memory: MemoryRecord, action: 'created' | 'updated' | 'failed', error?: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, memory, action, error }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <MemoryToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast, index) => (
          <div key={toast.id} style={{ transform: `translateY(-${index * 8}px)` }} className="pointer-events-auto">
            <MemoryToast
              memory={toast.memory}
              action={toast.action}
              error={toast.error}
              onClose={() => removeToast(toast.id)}
            />
          </div>
        ))}
      </div>
    </MemoryToastContext.Provider>
  );
}
