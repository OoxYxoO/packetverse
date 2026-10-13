/**
 * Viewing preferences for interactive videos: which teacher, how fast. Stored only in this browser, under a key
 * that isn't tied to the ARP lesson, so a later lesson video can start with the same choices.
 *
 * A preference only: never read by progress, XP, streaks or completion.
 */

const KEY = "packetverse.videoPrefs.v1";

export interface VideoPrefs {
  teacher?: string;
  speed?: number;
}

export function loadPrefs(): VideoPrefs {
  try {
    const p = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as VideoPrefs;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

export function savePrefs(patch: VideoPrefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* private mode or blocked storage: the choice just isn't remembered */
  }
}
