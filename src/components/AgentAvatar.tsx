// An agent's avatar: an uploaded or generated image, an emoji, or (with neither) its initials on a color
// picked from its id. Images are cropped to a square and shrunk to 256px, so agents stay small in storage
// and still look sharp as trading-card art.
import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../agents/agents';
import * as api from '../api';
import { Loader2, Sparkles, Upload, X } from './icons';

const COLORS = ['#7c6cf0', '#e0688f', '#3fa7d6', '#3ecf8e', '#f0a04b', '#c06bd6', '#5f9e8f', '#d6604d'];
const SIZE = 256;

export const isImageAvatar = (a?: string) => !!a && a.startsWith('data:image/');

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

export function AgentAvatar({ agent, size = 20, className = '' }: { agent: Pick<Agent, 'id' | 'name' | 'avatar'>; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * (agent.avatar && !isImageAvatar(agent.avatar) ? 0.62 : 0.42)) };
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

/** A starting prompt for a generated avatar, from who the agent is. */
export const avatarPrompt = (a: Pick<Agent, 'name' | 'description' | 'persona'>) => {
  const clean = (t?: string) => (t ?? '').trim().replace(/[.!\s]+$/, '');
  const job = clean(a.description);
  return [
    `Trading card character portrait of ${clean(a.name) || 'a helpful assistant'}${job ? `, who ${job.charAt(0).toLowerCase()}${job.slice(1)}` : ''}`,
    a.persona?.trim() && `Personality: ${clean(a.persona)}`,
    'Head and shoulders, centered, expressive, vibrant colors, painterly digital art, simple glowing background, no text, no letters, no frame.',
  ]
    .filter(Boolean)
    .join('. ');
};

const EMOJIS = ['🤖', '🧠', '🦉', '🧪', '📚', '✍️', '💻', '📊', '🎨', '🧭', '🦜', '👩‍🏫', '🧑‍🍳', '🩺', '🚀', '🌱', '🐙', '🦊', '⚡', '🎧'];

type AvatarAgent = Pick<Agent, 'id' | 'name' | 'avatar' | 'description' | 'persona'>;

/** The big avatar on the agent page and in the New agent wizard; click it to change. */
export function AvatarPicker({ agent, onChange, size = 56, imageModels = [] }: {
  agent: AvatarAgent;
  onChange: (avatar: string | undefined) => void;
  size?: number;
  /** Installed models that can generate images. */
  imageModels?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [gen, setGen] = useState<{ model: string; prompt: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const busy = !!abort.current && !!progress;

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

  const generate = async () => {
    if (!gen) return;
    setError('');
    const ac = new AbortController();
    abort.current = ac;
    setProgress({ done: 0, total: 0 });
    try {
      const image = await api.generateImage({ model: gen.model, prompt: gen.prompt }, (done, total) => setProgress({ done, total }), ac.signal);
      onChange(await shrink(image));
      setGen(null);
      setOpen(false);
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally {
      abort.current = null;
      setProgress(null);
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
        <span className="avatar-edit">{progress ? <Loader2 size={18} className="spin" /> : 'Edit'}</span>
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {open && (
        <div className="avatar-pop" role="dialog" aria-label="Avatar">
          {gen ? (
            <div className="avatar-gen">
              <b className="small"><Sparkles size={13} className="accent" /> Generate an avatar</b>
              {imageModels.length > 1 && (
                <select className="wide-select" value={gen.model} disabled={busy} onChange={(e) => setGen({ ...gen, model: e.target.value })}>
                  {imageModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              <textarea className="instructions" rows={5} value={gen.prompt} disabled={busy} onChange={(e) => setGen({ ...gen, prompt: e.target.value })} />
              {progress && (
                <div className="update-progress">
                  <div className="progress"><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 4}%` }} /></div>
                  <span className="muted small">{progress.total ? `Step ${progress.done} of ${progress.total}` : `Loading ${gen.model}…`}</span>
                </div>
              )}
              <div className="avatar-pop-row">
                <button type="button" className="btn ghost sm" onClick={() => (busy ? abort.current?.abort() : setGen(null))}>{busy ? 'Stop' : 'Back'}</button>
                <span className="flex" />
                <button type="button" className="btn primary sm" disabled={busy || !gen.prompt.trim()} onClick={generate}>
                  {busy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} Generate
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="avatar-pop-row">
                <button type="button" className="btn sm" onClick={() => file.current?.click()}><Upload size={13} /> Upload image…</button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!imageModels.length}
                  title={imageModels.length ? `Make one with ${imageModels[0]}` : 'Install an image generation model first'}
                  onClick={() => setGen({ model: imageModels[0], prompt: avatarPrompt(agent) })}
                >
                  <Sparkles size={13} /> Generate…
                </button>
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
              : imageModels.length ? 'Or drop an image on the avatar. It’s cropped to a square.'
              : 'To generate avatars, install an image model such as x/z-image-turbo (macOS) from Discover. Or drop an image on the avatar.'}
          </p>
        </div>
      )}
    </div>
  );
}
