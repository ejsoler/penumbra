// Internet access for widgets. Widgets are offline-safe by default: they may reach a short list of
// approved sites (CDNs, map tiles, keyless public data), and any other site needs the user's OK for
// that widget. "Whole internet" mode lifts the site list. In every mode the Electron main process
// also enforces GET-only requests, no cookies, no local network, and a URL length cap.
import { useSyncExternalStore } from 'react';
import { getHost } from '../api';

/** Sites any widget may use without asking. None of them let a widget's author read what's sent. */
export const APPROVED_SITES: { group: string; hosts: string[] }[] = [
  { group: 'Script and style CDNs', hosts: ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'esm.sh'] },
  { group: 'Fonts', hosts: ['fonts.googleapis.com', 'fonts.gstatic.com'] },
  {
    group: 'Map tiles',
    hosts: ['tile.openstreetmap.org', '*.tile.openstreetmap.org', '*.tile.opentopomap.org', 'server.arcgisonline.com'],
  },
  {
    group: 'Public data (no account)',
    hosts: [
      'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'air-quality-api.open-meteo.com', 'nominatim.openstreetmap.org',
      '*.wikipedia.org', 'upload.wikimedia.org', 'restcountries.com', 'api.frankfurter.app', 'api.frankfurter.dev', 'earthquake.usgs.gov',
    ],
  },
];
export const APPROVED_HOSTS = APPROVED_SITES.flatMap((s) => s.hosts);

export type NetMode = 'ask' | 'all';

interface NetSettings {
  mode: NetMode;
  /** Sites the user chose to always allow, on top of the approved list. */
  alwaysAllow: string[];
  /** Per-widget choices, keyed by a hash of the widget's code. */
  decisions: Record<string, { allow: string[]; offline?: boolean }>;
}

const KEY = 'ollama-gui.widgetNet';
const DEFAULTS: NetSettings = { mode: 'ask', alwaysAllow: [], decisions: {} };

function load(): NetSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return DEFAULTS;
  }
}

let settings = load();
const listeners = new Set<() => void>();

function save(next: NetSettings) {
  settings = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
  syncHost();
}

export const getNetSettings = () => settings;

export const useNetSettings = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );

export const setNetMode = (mode: NetMode) => save({ ...settings, mode });
export const alwaysAllow = (hosts: string[]) => save({ ...settings, alwaysAllow: [...new Set([...settings.alwaysAllow, ...hosts])] });
export const removeAlwaysAllowed = (host: string) => save({ ...settings, alwaysAllow: settings.alwaysAllow.filter((h) => h !== host) });
export const decide = (id: string, d: { allow: string[]; offline?: boolean }) => save({ ...settings, decisions: { ...settings.decisions, [id]: d } });

/** Short stable id for a widget's code (FNV-1a), so a choice sticks to that exact widget. */
export function widgetId(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + code.length.toString(36);
}

const HOST_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Does `host` match a pattern like "example.com" or "*.example.com"? */
export const hostMatches = (host: string, pattern: string) =>
  pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1 : host === pattern;

const isApproved = (host: string, extra: string[]) => [...APPROVED_HOSTS, ...extra].some((p) => hostMatches(host, p));

/** Sites a widget says it needs: its `<!-- network: a.com, b.org -->` comment plus URLs in its code. */
export function requestedHosts(code: string): string[] {
  const hosts = new Set<string>();
  const declared = /<!--\s*network:\s*([^>]*?)\s*-->/i.exec(code)?.[1] ?? '';
  for (const h of declared.split(/[\s,]+/)) hosts.add(h.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  // Template subdomains like {s}.tile.openstreetmap.org or ${sub}.example.com mean "any subdomain".
  for (const m of code.matchAll(/https?:\/\/((?:\$?\{[^}]*\}\.)?[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    hosts.add(m[1].toLowerCase().replace(/^\$?\{[^}]*\}\./, '*.'));
  }
  return [...hosts].filter((h) => HOST_RE.test(h) && !isLocalHost(h));
}

/** What the widget may reach right now, and which of its sites still need the user's answer. */
export function widgetAccess(code: string, s: NetSettings = settings): { hosts: string[] | 'all'; pending: string[]; offline: boolean } {
  if (s.mode === 'all') return { hosts: 'all', pending: [], offline: false };
  const decision = s.decisions[widgetId(code)];
  if (decision?.offline) return { hosts: [], pending: [], offline: true };
  const allowed = [...APPROVED_HOSTS, ...s.alwaysAllow, ...(decision?.allow ?? [])];
  const pending = decision ? [] : requestedHosts(code).filter((h) => !isApproved(h, [...s.alwaysAllow]));
  return { hosts: allowed, pending, offline: false };
}

/** Hosts that are this computer or the local network. Widgets may never reach these. */
export function isLocalHost(host: string): boolean {
  return /^(localhost|.*\.(localhost|local|internal|lan|home\.arpa))$/i.test(host) || /^[\d.]+$/.test(host) || host.includes(':');
}

// The Electron main process enforces this too, as a backstop to each widget's CSP (see syncHost).
export interface WidgetRequest {
  frame: string;
  method: string;
  url: string;
  status?: number;
  /** Stopped by Penumbra's rules (the reason). */
  blocked?: string;
  /** Network error, like an unreachable site. */
  failed?: string;
  cancelled?: boolean;
}

function syncHost() {
  const allow = new Set([...APPROVED_HOSTS, ...settings.alwaysAllow, ...Object.values(settings.decisions).flatMap((d) => d.allow)]);
  let ollama = '';
  try {
    ollama = new URL(getHost()).hostname;
  } catch {
    /* invalid server URL */
  }
  window.penumbraHost?.setWidgetNetwork({ mode: settings.mode, hosts: [...allow], block: ollama ? [ollama] : [] });
}
syncHost();

/** Forgets a widget's choice so it asks again. */
export const forgetDecision = (id: string) => {
  const { [id]: _gone, ...rest } = settings.decisions;
  save({ ...settings, decisions: rest });
};
