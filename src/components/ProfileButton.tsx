// The sidebar's "you" button: your avatar, and a small card to set your name and avatar.
import { useEffect, useRef, useState } from 'react';
import { asAvatar, setProfile, useProfile } from '../profile';
import { AgentAvatar, AvatarPicker } from './AgentAvatar';
import { X } from './icons';

export function ProfileButton() {
  const profile = useProfile();
  const me = asAvatar(profile);
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      // The avatar menu handles its own Escape and clicks first.
      if (document.querySelector('.profile-card .avatar-pop')) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !card.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.rail-profile')) setOpen(false);
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
        </div>
      )}
    </>
  );
}
