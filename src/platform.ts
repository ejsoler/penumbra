export const isMac = navigator.userAgent.includes('Mac');
export const isElectron = navigator.userAgent.includes('Electron');

/** Shortcut label for the platform: shortcut('L') → "⌘L" on macOS, "Ctrl+L" elsewhere. */
export const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`);
