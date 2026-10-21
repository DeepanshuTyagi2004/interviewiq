/**
 * The announcement strip above the top bar. A static constant, not the API: set it to show a
 * strip, to `null` for none. Change the `id` for every new announcement so people who dismissed
 * the last one see the new one.
 */
export interface Announcement {
  id: string;
  text: string;
  href?: string;
  linkText?: string;
}

export const ANNOUNCEMENT: Announcement | null = null;

export const ANNOUNCEMENT_KEY = "iq.announcement.dismissed";
export const INVITE_KEY = "iq.invite.dismissed";

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** True only when `key` holds exactly `value`. Anything else, or any throw, is "not dismissed". */
export function isDismissed(key: string, value: string, storage?: Pick<Storage, "getItem">): boolean {
  try {
    const s = storage ?? defaultStorage();
    return s ? s.getItem(key) === value : false;
  } catch {
    return false;
  }
}

/** Remembers `value` under `key`. Failing to store (private mode, quota) is silent. */
export function markDismissed(key: string, value: string, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? defaultStorage())?.setItem(key, value);
  } catch {
    /* the strip simply comes back next visit */
  }
}

export function isAnnouncementDismissed(id: string, storage?: Pick<Storage, "getItem">): boolean {
  return isDismissed(ANNOUNCEMENT_KEY, id, storage);
}

export function dismissAnnouncement(id: string, storage?: Pick<Storage, "setItem">): void {
  markDismissed(ANNOUNCEMENT_KEY, id, storage);
}
