'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

const ACCENT = {
  success: 'text-success',
  error: 'text-error',
  info: 'text-brand-500',
} as const;

/**
 * 极简全局提示。不引第三方库：一个数组 + 自动消失。
 * 用于把「操作到底成功没有」明确告诉用户——乐观更新只改本地 UI，
 * 没有提示的话用户只能刷新页面才能确认数据真的落库了。
 */
export default function Toast({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[100] bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2
                 sm:left-auto sm:right-6 sm:translate-x-0
                 flex flex-col items-center sm:items-end gap-2 pointer-events-none"
      aria-live="polite"
      data-testid="app-toast"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2.5 pl-3.5 pr-2.5 py-2.5
                       bg-surface-elevated dark:bg-surface-elevated
                       border border-border-light rounded-xl shadow-elevated
                       animate-slide-up max-w-[min(92vw,26rem)]"
          >
            <Icon className={`w-4 h-4 shrink-0 ${ACCENT[t.kind]}`} />
            <span className="text-sm text-text-primary leading-snug">{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="关闭提示"
              className="shrink-0 w-7 h-7 -mr-1 rounded-lg flex items-center justify-center
                         text-text-tertiary hover:text-text-primary hover:bg-surface-hover
                         transition-colors duration-200 pointer-coarse:w-9 pointer-coarse:h-9"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** 在组件里维护 toast 队列的小 hook */
export function useToasts(timeout = 2600) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const push = (kind: ToastKind, message: string) => {
    // 同一条消息连续触发时只保留最新的一条，避免刷屏
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.filter((t) => t.message !== message), { id, kind, message }]);
    setTimeout(() => dismiss(id), timeout);
  };

  return { toasts, push, dismiss };
}
