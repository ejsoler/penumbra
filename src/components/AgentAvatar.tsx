// An agent's avatar: an uploaded or generated image, an emoji, or (with neither) its initials on a color
// picked from its id. Images are cropped to a square and shrunk to 512px, so agents stay small in storage
// and still look sharp as trading-card art, even zoomed in with Adjust image (AvatarFrame).
import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../agents/agents';
import { Loader2, Move, Sparkles, Upload, X } from './icons';
import { cleanError, generateImage, modelLabel, readyModels, useImages } from '../images';
import { host } from '../host';

const COLORS = ['#7c6cf0', '#e0688f', '#3fa7d6', '#3ecf8e', '#f0a04b', '#c06bd6', '#5f9e8f', '#d6604d'];
const SIZE = 512;

export const isImageAvatar = (a?: string) => !!a && a.startsWith('data:image/');

/** The part of an image avatar that shows: a point (percent across and down) kept in place, and a zoom of 1 or more. */
export interface AvatarFrame {
  x: number;
  y: number;
  zoom: number;
}
export const DEFAULT_FRAME: AvatarFrame = { x: 50, y: 50, zoom: 1 };

/** Styles for an <img> filling its box (object-fit: cover) so it shows `frame`. */
export const frameStyle = (f?: AvatarFrame): React.CSSProperties =>
  f ? { objectPosition: `${f.x}% ${f.y}%`, transformOrigin: `${f.x}% ${f.y}%`, transform: f.zoom > 1 ? `scale(${f.zoom})` : undefined } : {};

export const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

/** The agent's own color, the same every time. */
export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function AgentAvatar({ agent, size = 20, className = '' }: { agent: Pick<Agent, 'id' | 'name' | 'avatar'> & { avatarFrame?: AvatarFrame }; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * (agent.avatar && !isImageAvatar(agent.avatar) ? 0.62 : 0.42)) };
  if (isImageAvatar(agent.avatar) && agent.avatarFrame) {
    return <span className={`agent-avatar framed ${className}`} style={style}><img src={agent.avatar} alt="" draggable={false} style={frameStyle(agent.avatarFrame)} /></span>;
  }
  if (isImageAvatar(agent.avatar)) return <img className={`agent-avatar ${className}`} style={style} src={agent.avatar} alt="" draggable={false} />;
  if (agent.avatar) return <span className={`agent-avatar emoji ${className}`} style={style} aria-hidden="true">{agent.avatar}</span>;
  return <span className={`agent-avatar ${className}`} style={{ ...style, background: colorFor(agent.id) }} aria-hidden="true">{initials(agent.name)}</span>;
}

/** Crops an image (a file or a data URL) to a centered square and returns a small data URL. */
async function shrink(source: File | string): Promise<string> {
  if (source instanceof File) {
    if (!source.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPEG, WebP, or GIF).');
    if (source.size > 15 * 1024 * 1024) throw new Error('That image is over 15 MB.');
  }
  const url = source instanceof File ? URL.createObjectURL(source) : source;
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
    if (source instanceof File) URL.revokeObjectURL(url);
  }
}

/** A starting prompt for a generated avatar, from who the agent (or you) is. */
export const avatarPrompt = (a: { name: string; description?: string; persona?: string }) => {
  const clean = (t?: string) => (t ?? '').trim().replace(/[.!\s]+$/, '');
  const job = clean(a.description);
  return [
    `Character portrait of ${clean(a.name) || 'a friendly assistant'}${job ? `, who ${job.charAt(0).toLowerCase()}${job.slice(1)}` : ''}`,
    a.persona?.trim() && `Personality: ${clean(a.persona)}`,
    'Head and shoulders, centered, expressive, vibrant colors, painterly digital art, simple glowing background, no text, no letters, no frame.',
  ]
    .filter(Boolean)
    .join('. ');
};

const EMOJIS = ['🤖', '🧠', '🦉', '🧪', '📚', '✍️', '💻', '📊', '🎨', '🧭', '🦜', '👩‍🏫', '🧑‍🍳', '🩺', '🚀', '🌱', '🐙', '🦊', '⚡', '🎧'];

/** The big avatar on the agent page and in the New agent wizard; click it to change. */
export function AvatarPicker({ agent, onChange, onAdjust, size = 56 }: {
  agent: Pick<Agent, 'id' | 'name' | 'avatar'> & { description?: string; persona?: string; avatarFrame?: AvatarFrame };
  onChange: (avatar: string | undefined) => void;
  /** Opens Adjust image (for image avatars). */
  onAdjust?: () => void;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  // Generating with a local image model (the Images tab).
  const { status, generating } = useImages();
  const models = readyModels(status);
  const [gen, setGen] = useState<{ model: string; prompt: string } | null>(null);
  const [mine, setMine] = useState(false); // this picker started the running generation
  const busy = mine && !!generating;
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (busy) return;
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
  }, [open, busy]);

  const generate = async () => {
    if (!gen) return;
    setError('');
    setMine(true);
    try {
      const r = await generateImage({ id: gen.model, prompt: gen.prompt, width: 768, height: 768 });
      onChange(await shrink(r.image));
      setGen(null);
      setOpen(false);
    } catch (e) {
      const msg = cleanError(e);
      if (msg !== 'Stopped') setError(msg);
    } finally {
      setMine(false);
    }
  };
  const pct = generating?.phase === 'sampling' && generating.steps ? (generating.step / generating.steps) * 100 : generating?.phase === 'decoding' ? 100 : 3;

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
        <span className="avatar-edit">{busy ? <Loader2 size={18} className="spin" /> : 'Edit'}</span>
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {open && (
        <div className="avatar-pop" role="dialog" aria-label="Avatar">
          {gen ? (
            <div className="avatar-gen">
              <b className="small"><Sparkles size={13} className="accent" /> Generate an avatar</b>
              {models.length > 1 && (
                <select className="wide-select" value={gen.model} disabled={busy} onChange={(e) => setGen({ ...gen, model: e.target.value })}>
                  {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}{m.nsfw ? ' · 18+' : ''}</option>)}
                </select>
              )}
              <textarea className="instructions" rows={5} value={gen.prompt} disabled={busy} onChange={(e) => setGen({ ...gen, prompt: e.target.value })} />
              {busy && generating && (
                <div className="update-progress">
                  <div className="progress"><div style={{ width: `${pct}%` }} /></div>
                  <span className="muted small">{generating.phase === 'loading' ? `Loading the model${generating.steps ? ` ${Math.round((generating.step / generating.steps) * 100)}%` : '…'}` : generating.phase === 'decoding' ? 'Finishing…' : `Step ${generating.step} of ${generating.steps}`}</span>
                </div>
              )}
              <div className="avatar-pop-row">
                <button type="button" className="btn ghost sm" onClick={() => (busy ? host()?.images.stop() : setGen(null))}>{busy ? 'Stop' : 'Back'}</button>
                <span className="flex" />
                <button type="button" className="btn primary sm" disabled={busy || !!generating || !gen.prompt.trim()} title={generating && !busy ? 'Another image is being made' : ''} onClick={generate}>
                  {busy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} Generate
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="avatar-pop-row">
                <button type="button" className="btn sm" onClick={() => file.current?.click()}><Upload size={13} /> Upload image…</button>
                {host() && (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={!models.length}
                    title={models.length ? `Make one with ${modelLabel(models[0])}` : 'Download an image model in the Images tab first'}
                    onClick={() => setGen({ model: models[0].id, prompt: avatarPrompt(agent) })}
                  >
                    <Sparkles size={13} /> Generate…
                  </button>
                )}
                {onAdjust && isImageAvatar(agent.avatar) && <button type="button" className="btn sm" onClick={() => { setOpen(false); onAdjust(); }}><Move size={13} /> Adjust…</button>}
                {agent.avatar && <button type="button" className="btn ghost sm" title="Use initials" onClick={() => { onChange(undefined); setOpen(false); }}><X size={13} /></button>}
              </div>
              <div className="avatar-emojis">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" className={agent.avatar === e ? 'on' : ''} onClick={() => { onChange(e); setOpen(false); }}>{e}</button>
                ))}
              </div>
            </>
          )}
          <p className="muted small">
            {error ? <span className="red">{error}</span>
              : gen ? 'Runs on this computer with your image model. You can edit the prompt.'
              : models.length || !host() ? 'Or drop an image on the avatar. It’s cropped to a square.'
              : 'To generate avatars, download an image model in the Images tab. Or drop an image on the avatar.'}
          </p>
        </div>
      )}
    </div>
  );
}
