// Shown instead of the app while a profile with a password is locked. Nothing else starts until it opens.
import { useEffect, useRef, useState } from 'react';
import { host, type ProfileInfo } from '../host';
import { AgentAvatar } from './AgentAvatar';
import { Logo } from './Logo';
import { Loader2 } from './icons';

export function LockScreen({ profile, onUnlocked }: { profile: ProfileInfo; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState<ProfileInfo[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    host()!.profiles.list().then((l) => setOthers(l.filter((p) => !p.current))).catch(() => {});
    input.current?.focus();
  }, []);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      if (await host()!.profiles.unlock(password)) onUnlocked();
      else {
        setError('Wrong password');
        setPassword('');
        input.current?.focus();
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-drag" />
      <div className="lock-card">
        <Logo size={22} />
        <AgentAvatar agent={{ id: profile.id, name: profile.name, avatar: profile.avatar }} size={84} />
        <h2>{profile.name}</h2>
        <p className="muted small">This profile is locked.</p>
        <form className="lock-form" onSubmit={(e) => { e.preventDefault(); unlock(); }}>
          <input ref={input} className="text plain" type="password" value={password} placeholder="Password" autoComplete="current-password" aria-label="Password" onChange={(e) => { setPassword(e.target.value); setError(''); }} />
          <button className="btn primary" disabled={!password || busy}>{busy ? <Loader2 size={14} className="spin" /> : 'Unlock'}</button>
        </form>
        <p className="lock-error small">{error}</p>
        {others.length > 0 && (
          <div className="lock-others">
            <span className="muted small">Other profiles</span>
            <div>
              {others.map((p) => (
                <button key={p.id} className="lock-other" title={p.hasPassword ? `${p.name} (locked)` : p.name} onClick={() => host()!.profiles.switchTo(p.id)}>
                  <AgentAvatar agent={{ id: p.id, name: p.name, avatar: p.avatar }} size={36} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
