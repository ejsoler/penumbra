// You: a name and an avatar shown on your messages. Stored locally; never sent to a model. The profile list
// (electron/profiles.cjs) gets a copy, so the profile switcher and lock screen can show them.
import { useSyncExternalStore } from 'react';
import { host } from './host';

export interface Profile {
  name: string;
  /** An emoji, or a small image as a data URL. */
  avatar?: string;
}

const KEY = 'ollama-gui.profile';
let profile: Profile = (() => {
  try {
    return { name: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { name: '' };
  }
})();
const listeners = new Set<() => void>();

export const useProfile = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => profile,
  );

/** This window's profile id, so "you" has the same avatar color as in the profile list. */
let profileId = 'me';
let syncTimer: ReturnType<typeof setTimeout> | undefined;
export function setProfile(patch: Partial<Profile>) {
  profile = { ...profile, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => host()?.profiles.update({ name: profile.name, avatar: profile.avatar ?? null }).catch(() => {}), 400);
}

/** At start: a new profile takes its name from the list; an existing one copies its name and avatar there. */
export async function syncProfile() {
  const h = host();
  if (!h) return;
  const cur = await h.profiles.current().catch(() => null);
  if (!cur) return;
  profileId = cur.id;
  const listed = cur.name === 'Default' || cur.name === 'Profile' ? '' : cur.name;
  if (!profile.name && !profile.avatar && (listed || cur.avatar)) setProfile({ name: listed, avatar: cur.avatar });
  else if (profile.name !== listed || profile.avatar !== cur.avatar) setProfile({});
}

/** The profile in the shape the avatar components take. */
export const asAvatar = (p: Profile) => ({ id: profileId, name: p.name.trim() || 'You', avatar: p.avatar });
