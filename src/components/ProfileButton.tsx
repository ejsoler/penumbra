// The sidebar's "you" button: your avatar, and a card to set your name and avatar, switch between profiles,
// create one, and manage this profile's password.
import { useEffect, useRef, useState } from 'react';
import { asAvatar, setProfile, useProfile } from '../profile';
import { host, type ProfileInfo } from '../host';
import { AgentAvatar, AvatarPicker } from './AgentAvatar';
import { Lock, Plus, Trash2, X } from './icons';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

type Form = null | { kind: 'new' } | { kind: 'password' } | { kind: 'delete'; target: ProfileInfo };

export function ProfileButton() {
  const profile = useProfile();
  const me = asAvatar(profile);
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [form, setForm] = useState<Form>(null);
  const card = useRef<HTMLDivElement>(null);
  const current = profiles.find((p) => p.current);
  const load = () => host()?.profiles.list().then(setProfiles).catch(() => {});

  useEffect(() => {
    if (!open) return;
    load();
    const close = (e: MouseEvent | KeyboardEvent) => {
      // The avatar menu handles its own Escape and clicks first.
      if (document.querySelector('.profile-card .avatar-pop')) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !card.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.rail-profile')) {
        setOpen(false);
        setForm(null);
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <>
      <button className={`rail-btn rail-profile ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} title={profile.name ? `${profile.name} (your profile)` : 'Your profile'}>
        <AgentAvatar agent={me} size={28} />
      </button>
      {open && (
        <div className="profile-card" ref={card} role="dialog" aria-label="Your profile">
          <div className="update-head">
            <b>Your profile</b>
            <button className="icon-btn sm" onClick={() => setOpen(false)} title="Close"><X size={14} /></button>
          </div>
          <div className="profile-row">
            <AvatarPicker agent={me} onChange={(avatar) => setProfile({ avatar })} size={64} />
            <label className="wizard-field profile-name">
              <span>Your name</span>
              <input className="text plain" value={profile.name} placeholder="You" maxLength={40} onChange={(e) => setProfile({ name: e.target.value })} />
            </label>
          </div>
          <p className="muted small">Shown on your messages. It stays on this computer and isn’t sent to the models.</p>

          {host() && (
            <>
              <div className="profile-section">
                <div className="row gap profile-section-head">
                  <b className="small flex">Profiles</b>
                  <button className="btn ghost sm" onClick={() => setForm(form?.kind === 'new' ? null : { kind: 'new' })}><Plus size={13} /> New</button>
                </div>
                {profiles.map((p) => (
                  <div key={p.id} className={`profile-item ${p.current ? 'current' : ''}`}>
                    <button className="profile-switch" disabled={p.current} title={p.current ? 'This profile' : `Switch to ${p.name}`} onClick={() => host()!.profiles.switchTo(p.id)}>
                      <AgentAvatar agent={{ id: p.id, name: p.name, avatar: p.avatar }} size={26} />
                      <span className="flex">{p.name}</span>
                      {p.hasPassword && <Lock size={12} className="muted" />}
                      {p.current && <span className="badge">this one</span>}
                    </button>
                    {!p.current && p.id !== 'default' && (
                      <button className="icon-btn sm" title={`Delete ${p.name}`} onClick={() => setForm({ kind: 'delete', target: p })}><Trash2 size={12} /></button>
                    )}
                  </div>
                ))}
                {form?.kind === 'new' && <NewProfile onDone={(id) => { setForm(null); load(); if (id) host()!.profiles.switchTo(id); }} onCancel={() => setForm(null)} />}
                {form?.kind === 'delete' && <DeleteProfile target={form.target} onDone={() => { setForm(null); load(); }} onCancel={() => setForm(null)} />}
                <p className="muted small">Each profile has its own chats, agents, skills, settings, scheduled tasks, and images. Downloaded models are shared.</p>
              </div>

              <div className="profile-section">
                <div className="row gap profile-section-head">
                  <b className="small flex">Password</b>
                  {current?.hasPassword && <button className="btn ghost sm" onClick={() => host()!.profiles.lock()}><Lock size={13} /> Lock now</button>}
                  <button className="btn ghost sm" onClick={() => setForm(form?.kind === 'password' ? null : { kind: 'password' })}>{current?.hasPassword ? 'Change…' : 'Set…'}</button>
                </div>
                {form?.kind === 'password' ? (
                  <PasswordForm hasPassword={!!current?.hasPassword} onDone={() => { setForm(null); load(); }} onCancel={() => setForm(null)} />
                ) : (
                  <p className="muted small">
                    {current?.hasPassword ? 'Penumbra asks for it before opening this profile.' : 'No password: this profile opens right away.'} It locks the profile in Penumbra; it doesn’t encrypt files on disk (FileVault does).
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function NewProfile({ onDone, onCancel }: { onDone: (switchTo?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const create = async (andSwitch: boolean) => {
    try {
      const id = await host()!.profiles.create({ name, ...(password ? { password } : {}) });
      onDone(andSwitch ? id : undefined);
    } catch (e) {
      setError(clean(e));
    }
  };
  return (
    <form className="profile-form" onSubmit={(e) => { e.preventDefault(); create(true); }}>
      <input className="text plain" autoFocus value={name} placeholder="Profile name (e.g. Work)" maxLength={40} onChange={(e) => { setName(e.target.value); setError(''); }} />
      <input className="text plain" type="password" value={password} placeholder="Password (optional)" autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
      {error && <span className="lock-error small">{error}</span>}
      <div className="row gap">
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <span className="flex" />
        <button type="button" className="btn sm" disabled={!name.trim()} onClick={() => create(false)}>Create</button>
        <button className="btn primary sm" disabled={!name.trim()}>Create and open</button>
      </div>
    </form>
  );
}

function PasswordForm({ hasPassword, onDone, onCancel }: { hasPassword: boolean; onDone: () => void; onCancel: () => void }) {
  const [currentPw, setCurrentPw] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const save = async (remove = false) => {
    if (!remove && next !== again) return setError("The new passwords don't match");
    try {
      await host()!.profiles.setPassword({ current: currentPw, next: remove ? '' : next });
      onDone();
    } catch (e) {
      setError(clean(e));
    }
  };
  return (
    <form className="profile-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {hasPassword && <input className="text plain" type="password" autoFocus value={currentPw} placeholder="Current password" autoComplete="current-password" onChange={(e) => { setCurrentPw(e.target.value); setError(''); }} />}
      <input className="text plain" type="password" autoFocus={!hasPassword} value={next} placeholder="New password" autoComplete="new-password" onChange={(e) => { setNext(e.target.value); setError(''); }} />
      <input className="text plain" type="password" value={again} placeholder="New password again" autoComplete="new-password" onChange={(e) => { setAgain(e.target.value); setError(''); }} />
      {error && <span className="lock-error small">{error}</span>}
      <div className="row gap">
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <span className="flex" />
        {hasPassword && <button type="button" className="btn danger sm" disabled={!currentPw} onClick={() => save(true)}>Remove password</button>}
        <button className="btn primary sm" disabled={!next || (hasPassword && !currentPw)}>Save</button>
      </div>
    </form>
  );
}

function DeleteProfile({ target, onDone, onCancel }: { target: ProfileInfo; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const remove = async () => {
    try {
      await host()!.profiles.remove({ id: target.id, ...(target.hasPassword ? { password } : {}) });
      onDone();
    } catch (e) {
      setError(clean(e));
    }
  };
  return (
    <form className="profile-form danger" onSubmit={(e) => { e.preventDefault(); remove(); }}>
      <span className="small">Delete <b>{target.name}</b> and all its chats, agents, skills, and settings? This can’t be undone. Images it saved in folders stay.</span>
      {target.hasPassword && <input className="text plain" type="password" autoFocus value={password} placeholder={`${target.name}'s password`} onChange={(e) => { setPassword(e.target.value); setError(''); }} />}
      {error && <span className="lock-error small">{error}</span>}
      <div className="row gap">
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <span className="flex" />
        <button className="btn danger sm" disabled={target.hasPassword && !password}>Delete profile</button>
      </div>
    </form>
  );
}
