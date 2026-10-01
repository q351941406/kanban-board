'use client';
import { createContext, useContext, useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import { MoonStar, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({ theme: 'light', toggleTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

const emptySubscribe = () => () => {};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 主题初值只能在浏览器里读（localStorage / matchMedia），服务端读不到。
  // 但首帧渲染仍由下面的 mounted 挡掉（SSR 输出不带 .dark），
  // 所以惰性初始化不会造成 hydration mismatch。
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem('theme') as Theme | null;
    return stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });
  // 「是否已 hydration」用 useSyncExternalStore 表达，而不是 useEffect + setState：
  // 后者会被 react-hooks/set-state-in-effect 判为级联渲染。语义一致 ——
  // hydration 期间返回 server snapshot(false)，hydrate 完成后返回 true 并触发一次重渲染。
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const [flash, setFlash] = useState<'light-to-dark' | 'dark-to-light' | null>(null);
  const flashRef = useRef<NodeJS.Timeout | null>(null);


  useEffect(() => {
    // 副作用：把主题同步到 <html>，供全局 dark: 变体使用
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      const flashType = next === 'dark' ? 'light-to-dark' : 'dark-to-light';
      
      // 触发 flash 效果
      setFlash(flashType);
      if (flashRef.current) clearTimeout(flashRef.current);
      flashRef.current = setTimeout(() => setFlash(null), 600);

      localStorage.setItem('theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {/* 主题切换 flash 遮罩 */}
      {flash && (
        <div
          className={`theme-flash ${flash}`}
          style={{ opacity: flash ? 1 : 0 }}
        />
      )}
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [hover, setHover] = useState(false);

  return (
    <button
      onClick={toggleTheme}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-xl
        bg-surface hover:bg-surface-hover
        border border-border-light
        text-text-tertiary hover:text-text-primary
        transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]
        active:scale-90
        focus:outline-none focus:ring-2 focus:ring-brand-500/40
        group"
      aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
    >
      <Sun className={`w-4 h-4 absolute transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
        theme === 'light'
          ? 'opacity-100 rotate-0 scale-100'
          : 'opacity-0 rotate-180 scale-0'
      }`} />
      <MoonStar className={`w-4 h-4 absolute transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
        theme === 'dark'
          ? 'opacity-100 rotate-0 scale-100'
          : 'opacity-0 -rotate-180 scale-0'
      }`} />
      {/* 悬浮光晕 */}
      <span className={`absolute inset-0 rounded-xl bg-brand-500/5 transition-all duration-300 ${
        hover ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
      }`} />
    </button>
  );
}
