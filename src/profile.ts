// You: a name and an avatar shown on your messages. Stored locally; never sent to a model.
import { useSyncExternalStore } from 'react';

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

export function setProfile(patch: Partial<Profile>) {
  profile = { ...profile, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

/** The profile in the shape the avatar components take. */
export const asAvatar = (p: Profile) => ({ id: 'me', name: p.name.trim() || 'You', avatar: p.avatar });
