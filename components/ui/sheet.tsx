'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 响应式对话框：桌面端保持居中模态框，移动端变成底部抽屉（bottom sheet）。
 *
 * 解决三个移动端硬伤：
 *  1. 85vh 居中弹窗在手机上又高又窄 → 移动端贴底、只圆上角、顶部留出抓手。
 *  2. 软键盘弹起会盖住底部的输入框 → 用 visualViewport 实时测出键盘高度，
 *     把容器高度压到「可视区」并用 padding-bottom 顶起面板。
 *     iOS Safari 下 position:fixed 不会跟随键盘移动，必须手动补偿。
 *  3. 底部被 Home Indicator 遮挡 → 调用方在 pb 上叠加 env(safe-area-inset-bottom)。
 */

/** 返回可视视口高度，以及被软键盘吃掉的底部高度。 */
function useVisualViewport() {
  const [vp, setVp] = useState<{ height: number; keyboard: number } | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // 键盘高度 = 布局视口高度 - (可视视口高度 + 可视视口在布局中的偏移)
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setVp({ height: vv.height, keyboard });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return vp;
}

interface SheetProps {
  onClose: () => void;
  children: React.ReactNode;
  /** 桌面端最大宽度，默认 max-w-lg */
  maxWidth?: string;
  /** aria-label，遮罩点击与 ESC 都走 onClose */
  label: string;
}

export default function Sheet({ onClose, children, maxWidth = 'max-w-lg', label }: SheetProps) {
  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number | null>(null);
  const vp = useVisualViewport();

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // ESC 关闭（桌面）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  // ── 抓手下拉关闭 ──
  const onHandlePointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (dragStartRef.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStartRef.current));
  };
  const onHandlePointerUp = () => {
    if (dragStartRef.current === null) return;
    // 下拉超过 96px 即关闭；面板用 spring 曲线回弹
    if (dragY > 96) handleClose();
    else setDragY(0);
    dragStartRef.current = null;
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{
        // 用可视视口高度而非 100vh，键盘弹起时面板才不会被顶出屏幕
        height: vp?.height ?? undefined,
      }}
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* 面板 */}
      <div
        className={`
          relative w-full ${maxWidth}
          bg-surface dark:bg-surface-elevated shadow-modal
          border border-border-light/50
          /* 移动端：贴底、只圆上角、顶部留抓手；桌面：居中、四角圆角 */
          rounded-t-3xl sm:rounded-2xl
          max-h-full overflow-y-auto overscroll-contain
          transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]
          sm:transition-all
          ${visible ? 'opacity-100 translate-y-0 sm:scale-100' : 'opacity-0 translate-y-8 sm:translate-y-4 sm:scale-95'}
        `}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transitionDuration: dragY ? '0ms' : undefined,
          // 键盘弹起时把底部让出来
          marginBottom: vp?.keyboard ? `${vp.keyboard}px` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 抓手：仅移动端可见，pointer-coarse 才显示，避免桌面出现无功能装饰 */}
        <div
          className="pointer-coarse:flex hidden sticky top-0 z-10 justify-center pt-2.5 pb-1 -mt-px bg-inherit rounded-t-3xl cursor-grab touch-none"
          style={{ touchAction: 'none' }}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          aria-hidden="true"
        >
          <div className="h-1 w-10 rounded-full bg-border-default/70" />
        </div>

        {children}
      </div>
    </div>
  );
}
