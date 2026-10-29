// An agent's avatar: an uploaded image, an emoji, or (with neither) its initials on a color picked from
// its id. Images are cropped to a square and shrunk to 128px when chosen, so agents stay small in storage.
import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../agents/agents';
import { Upload, X } from './icons';

const COLORS = ['#7c6cf0', '#e0688f', '#3fa7d6', '#3ecf8e', '#f0a04b', '#c06bd6', '#5f9e8f', '#d6604d'];
const SIZE = 128;

const isImage = (a?: string) => !!a && a.startsWith('data:image/');

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function AgentAvatar({ agent, size = 20, className = '' }: { agent: Pick<Agent, 'id' | 'name' | 'avatar'>; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * (agent.avatar && !isImage(agent.avatar) ? 0.62 : 0.42)) };
  if (isImage(agent.avatar)) return <img className={`agent-avatar ${className}`} style={style} src={agent.avatar} alt="" draggable={false} />;
  if (agent.avatar) return <span className={`agent-avatar emoji ${className}`} style={style} aria-hidden="true">{agent.avatar}</span>;
  return <span className={`agent-avatar ${className}`} style={{ ...style, background: colorFor(agent.id) }} aria-hidden="true">{initials(agent.name)}</span>;
}

/** Crops an image file to a centered square and returns a small data URL. */
async function shrink(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPEG, WebP, or GIF).');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is over 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't read that image."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    const webp = canvas.toDataURL('image/webp', 0.86);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const EMOJIS = ['🤖', '🧠', '🦉', '🧪', '📚', '✍️', '💻', '📊', '🎨', '🧭', '🦜', '👩‍🏫', '🧑‍🍳', '🩺', '🚀', '🌱', '🐙', '🦊', '⚡', '🎧'];

/** The big avatar on the agent page and in the New agent wizard; click it to change. */
export function AvatarPicker({ agent, onChange, size = 56 }: { agent: Pick<Agent, 'id' | 'name' | 'avatar'>; onChange: (avatar: string | undefined) => void; size?: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close, true);
    };
  }, [open]);

  const pick = async (f?: File) => {
    if (!f) return;
    setError('');
    try {
      onChange(await shrink(f));
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="avatar-picker" ref={box}>
      <button
        type="button"
        className="avatar-btn"
        title="Change avatar"
        onClick={() => setOpen(!open)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files[0]);
        }}
      >
        <AgentAvatar agent={agent} size={size} />
        <span className="avatar-edit">Edit</span>
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {open && (
        <div className="avatar-pop" role="dialog" aria-label="Avatar">
          <div className="avatar-pop-row">
            <button type="button" className="btn sm" onClick={() => file.current?.click()}><Upload size={13} /> Upload image…</button>
            {agent.avatar && <button type="button" className="btn ghost sm" onClick={() => { onChange(undefined); setOpen(false); }}><X size={13} /> Use initials</button>}
          </div>
          <div className="avatar-emojis">
            {EMOJIS.map((e) => (
              <button key={e} type="button" className={agent.avatar === e ? 'on' : ''} onClick={() => { onChange(e); setOpen(false); }}>{e}</button>
            ))}
          </div>
          <p className="muted small">{error ? <span className="red">{error}</span> : 'Or drop an image on the avatar. It’s cropped to a square.'}</p>
        </div>
      )}
    </div>
  );
}
