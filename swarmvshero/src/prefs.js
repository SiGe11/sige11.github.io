// Remembered between visits: the mute switch and a small run record.
//
// Storage can be missing or throw (private windows, blocked site data), so
// every access is guarded and the game never depends on it. Losing it only
// forgets a convenience.

const KEY = 'swarmvshero';

export function loadPrefs() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY));
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Nothing to do: the next visit simply starts from defaults.
  }
}
