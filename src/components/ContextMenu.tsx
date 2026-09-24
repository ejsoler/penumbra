import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

export type MenuItem =
  | { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | 'separator';

type OpenMenu = (e: MouseEvent, items: (MenuItem | false | null | undefined | '')[]) => void;

const Ctx = createContext<OpenMenu>(() => {});

/** Returns a function to open a context menu at the mouse position: onContextMenu={(e) => menu(e, items)} */
export const useContextMenu = () => useContext(Ctx);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const open = useCallback<OpenMenu>((e, items) => {
    // Let text fields keep the native cut/copy/paste menu.
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    // Drop leading/trailing/double separators left behind by conditional items.
    const tidy: MenuItem[] = [];
    for (const it of items) {
      if (!it) continue;
      if (it === 'separator' && (!tidy.length || tidy[tidy.length - 1] === 'separator')) continue;
      tidy.push(it);
    }
    if (tidy[tidy.length - 1] === 'separator') tidy.pop();
    if (tidy.length) setMenu({ x: e.clientX, y: e.clientY, items: tidy });
  }, []);

  return (
    <Ctx.Provider value={open}>
      {children}
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
    </Ctx.Provider>
  );
}

function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y,
    });
  }, [x, y]);

  useLayoutEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctx-menu" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            {it.icon ? <it.icon size={14} /> : <span className="ctx-icon-spacer" />}
            <span className="flex">{it.label}</span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Small helpers shared by menus. */
export const copyText = (text: string) => navigator.clipboard.writeText(text);

export function downloadFile(filename: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
