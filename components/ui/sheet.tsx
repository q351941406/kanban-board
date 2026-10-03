'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/**
 * 响应式对话框：桌面端居中模态框，移动端变成底部抽屉（bottom sheet）。
 *
 * 移动端的四个硬伤（都是真机上才暴露的，模拟器看不出来）：
 *
 *  1. 85vh 居中弹窗在手机上又高又窄 → 移动端贴底、只圆上角、顶部留抓手。
 *  2. 输入框字号 < 16px → iOS Safari 聚焦时自动放大页面（≈1.14x），
 *     失焦后不还原，页面停在放大+平移状态，看起来就是「面板跑到屏幕外」。
 *     → 调用方所有表单控件在移动端必须 ≥16px（见 add-card-modal / card-modal）。
 *  3. 软键盘弹起时 iOS 不会移动 position:fixed，而是缩小并平移「可视视口」
 *     (visualViewport)。若按布局视口(inset-0)定位，面板会被顶出屏幕、
 *     甚至横向偏移（offsetLeft 被忽略时面板右侧直接跑出屏幕）。
 *     → 这里显式用 visualViewport 的 left/top/width/height 定位，
 *       并且不再叠加 marginBottom（那会把键盘高度算两遍，面板被压扁）。
 *  4. 底部被 Home Indicator 遮挡 → 调用方在 pb 上叠加 env(safe-area-inset-bottom)，
 *     前提是 layout.tsx 里声明了 viewport-fit=cover，否则该值恒为 0。
 */

interface ViewportInfo {
  left: number;
  top: number;
  width: number;
  height: number;
  /** 被软键盘吃掉的底部高度；Android(resizes-content) 下恒为 0，无需再补偿 */
  keyboard: number;
}

function computeViewport(): ViewportInfo {
  const vv = window.visualViewport;
  if (!vv) {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, keyboard: 0 };
  }
  return {
    left: vv.offsetLeft,
    top: vv.offsetTop,
    width: vv.width,
    height: vv.height,
    // 被软键盘吃掉的底部高度。Android(resizes-content) 下布局视口同步收缩，这里恒为 0；
    // iOS 下布局视口不动，这个值才是真正需要避让的高度。
    keyboard: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
  };
}

// getSnapshot 必须返回稳定引用，否则 useSyncExternalStore 会陷入无限重渲染。
let cachedViewport: ViewportInfo | null = null;
function readViewport(): ViewportInfo {
  const next = computeViewport();
  if (
    cachedViewport &&
    cachedViewport.left === next.left &&
    cachedViewport.top === next.top &&
    cachedViewport.width === next.width &&
    cachedViewport.height === next.height
  ) {
    return cachedViewport;
  }
  cachedViewport = next;
  return next;
}

const SERVER_VIEWPORT: ViewportInfo = { left: 0, top: 0, width: 0, height: 0, keyboard: 0 };

function subscribeViewport(onChange: () => void) {
  const vv = window.visualViewport;
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  vv?.addEventListener('resize', onChange);
  vv?.addEventListener('scroll', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
    vv?.removeEventListener('resize', onChange);
    vv?.removeEventListener('scroll', onChange);
  };
}

/** 跟踪可视视口：键盘弹起、页面缩放平移都会驱动 resize/scroll 事件 */
function useVisualViewport() {
  return useSyncExternalStore(subscribeViewport, readViewport, () => SERVER_VIEWPORT);
}

const noopSubscribe = () => () => {};
/** 是否已在浏览器里。SSR/水合阶段为 false，避免 portal 早于 document 渲染 */
function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** 打开期间锁住页面滚动：iOS 上背景跟着橡皮筋滑动，面板会被带偏 */
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflowY: body.style.overflowY,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    // iOS 只认 overflow:hidden 才会关掉橡皮筋；scroll 会让滚动条消失但仍能挡
    body.style.overflowY = 'scroll';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflowY = prev.overflowY;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
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
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number | null>(null);
  const vp = useVisualViewport();
  const mounted = useMounted();

  useScrollLock(mounted);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // ESC 关闭（桌面）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 键盘把可视区压矮后，把正在编辑的输入框滚到可见区域正中
  const keepFocusVisible = useCallback(() => {
    const panel = panelRef.current;
    const el = document.activeElement as HTMLElement | null;
    if (!panel || !el || !panel.contains(el)) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // 聚焦时键盘还没弹完，等它动画结束再滚，否则滚完又被键盘盖住
    const onFocusIn = () => {
      window.setTimeout(keepFocusVisible, 300);
    };
    panel.addEventListener('focusin', onFocusIn);
    return () => panel.removeEventListener('focusin', onFocusIn);
  }, [keepFocusVisible]);

  // 键盘弹起会连续触发多次 resize，只在最后一轮停下后滚一次。
  // 必须单独监听：输入框早就聚焦时，键盘弹起不会再触发 focusin，
  // 光靠 focusin 的话，正在编辑的框会被键盘盖住一半。
  const keyboardRef = useRef(0);
  const keyboard = vp?.keyboard ?? 0;
  useEffect(() => {
    const grew = keyboard > keyboardRef.current;
    keyboardRef.current = keyboard;
    if (!grew) return;
    const timer = window.setTimeout(keepFocusVisible, 320);
    return () => window.clearTimeout(timer);
  }, [keyboard, keepFocusVisible]);

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

  const sheet = (
    <div
      ref={overlayRef}
      className="fixed z-50 flex items-end sm:items-center justify-center"
      // 按「可视视口」而不是布局视口定位：键盘弹起/页面被缩放平移时
      // 面板依然贴着可见区域的底部，且不会被横向带偏。
      style={
        vp.width > 0
          ? { left: vp.left, top: vp.top, width: vp.width, height: vp.height }
          : { inset: 0 }
      }
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
        ref={panelRef}
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

  // Portal 到 body：祖先里只要有 transform / filter / backdrop-filter，
  // position:fixed 就会以那个祖先为参照，移动端极易跑偏。
  if (!mounted) return null;
  return createPortal(sheet, document.body);
}
