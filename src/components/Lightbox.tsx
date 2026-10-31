// A full-window image viewer. Any image in the app opens it with openLightbox(); it zooms with the wheel
// or a trackpad pinch (toward the pointer), pans by dragging, and steps through a set with the arrow keys.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, FolderOpen, Maximize2, X, ZoomIn, ZoomOut } from './icons';
import { host } from '../host';

export interface LightboxImage {
  src: string;
  alt?: string;
  /** Shown under the image (a prompt, for example). */
  caption?: string;
  /** A file on disk, for "Show in folder". */
  file?: string;
}

let state: { images: LightboxImage[]; index: number } | null = null;
const listeners = new Set<() => void>();
const set = (next: typeof state) => {
  state = next;
  listeners.forEach((l) => l());
};

/** Opens the viewer on `index` of `images` (arrow keys move through the rest). */
export const openLightbox = (images: LightboxImage[], index = 0) => images.length && set({ images, index: Math.max(0, Math.min(images.length - 1, index)) });
const close = () => set(null);

const MIN = 1;
const MAX = 10;

/** Mounted once in App; renders nothing until an image is opened. */
export function LightboxHost() {
  const s = useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => state);
  if (!s) return null;
  return <Viewer key={s.index} images={s.images} index={s.index} />;
}

function Viewer({ images, index }: { images: LightboxImage[]; index: number }) {
  const img = images[index];
  // The image is centered and fit to the window; scale and offset are on top of that.
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  /** Zooms to `next`, keeping the point under (cx, cy) in place. Coordinates are relative to the stage center. */
  const zoomAt = (next: number, cx = 0, cy = 0) =>
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, next));
      if (scale === MIN) return { scale, x: 0, y: 0 };
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  const fromCenter = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2] as const;
  };
  const go = (d: number) => {
    const i = index + d;
    if (i >= 0 && i < images.length) set({ images, index: i });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === '+' || e.key === '=') zoomAt(view.scale * 1.4);
      else if (e.key === '-') zoomAt(view.scale / 1.4);
      else if (e.key === '0') setView({ scale: 1, x: 0, y: 0 });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Wheel and pinch (a pinch arrives as a wheel event with ctrlKey). Not passive, so the page doesn't scroll.
  useEffect(() => {
    const el = stage.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [cx, cy] = fromCenter(e);
      setView((v) => {
        const scale = Math.min(MAX, Math.max(MIN, v.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))));
        if (scale === MIN) return { scale, x: 0, y: 0 };
        const k = scale / v.scale;
        return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="lightbox" role="dialog" aria-label={img.alt || 'Image'}>
      <div
        ref={stage}
        className={`lightbox-stage ${view.scale > 1 ? 'zoomed' : ''}`}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (view.scale > 1) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          // A plain click on the dark area (not the image) closes, like most viewers.
          if (d && !d.moved && e.target === stage.current && view.scale === 1) close();
        }}
        onDoubleClick={(e) => {
          const [cx, cy] = fromCenter(e);
          if (view.scale > 1) setView({ scale: 1, x: 0, y: 0 });
          else zoomAt(2.5, cx, cy);
        }}
      >
        <img
          src={img.src}
          alt={img.alt ?? ''}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>

      <div className="lightbox-bar" onPointerDown={(e) => e.stopPropagation()}>
        {images.length > 1 && <span className="lightbox-count">{index + 1} / {images.length}</span>}
        <button className="icon-btn" title="Zoom out (−)" onClick={() => zoomAt(view.scale / 1.4)} disabled={view.scale <= MIN}><ZoomOut size={16} /></button>
        <span className="lightbox-zoom mono">{Math.round(view.scale * 100)}%</span>
        <button className="icon-btn" title="Zoom in (+)" onClick={() => zoomAt(view.scale * 1.4)} disabled={view.scale >= MAX}><ZoomIn size={16} /></button>
        <button className="icon-btn" title="Fit (0)" onClick={() => setView({ scale: 1, x: 0, y: 0 })} disabled={view.scale === 1}><Maximize2 size={15} /></button>
        {img.file && host() && <button className="icon-btn" title="Show in folder" onClick={() => host()!.images.reveal(img.file)}><FolderOpen size={15} /></button>}
        <button className="icon-btn" title="Close (Esc)" onClick={close}><X size={17} /></button>
      </div>

      {index > 0 && <button className="lightbox-nav prev" title="Previous (←)" onClick={() => go(-1)}><ChevronLeft size={26} /></button>}
      {index < images.length - 1 && <button className="lightbox-nav next" title="Next (→)" onClick={() => go(1)}><ChevronRight size={26} /></button>}
      {(img.caption || img.alt) && <Caption text={(img.caption || img.alt)!} />}
    </div>
  );
}

/** The prompt under the image: scrolls when long, with a button to copy it. */
function Caption({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="lightbox-caption" onPointerDown={(e) => e.stopPropagation()}>
      <div className="lightbox-caption-text">{text}</div>
      <button className="icon-btn sm" title={copied ? 'Copied' : 'Copy prompt'} onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
    </div>
  );
}
