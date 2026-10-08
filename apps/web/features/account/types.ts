import type { components } from "@/lib/api-client/generated/schema";

type S = components["schemas"];

/** Account-level settings, every value resolved (GET /users/me/preferences). */
export type Preferences = S["Preferences"];
export type NotificationChannel = S["NotificationChannel"];
export type NotificationTopic = keyof NotificationChannel;
export type DeleteAccountRequest = S["DeleteAccountRequest"];
export type AccountExport = S["AccountExport"];

/** A PATCH body: any subset of leaves, in the same shape. */
export type PreferencesPatch = {
  locale?: Partial<Preferences["locale"]>;
  interview?: Partial<Preferences["interview"]>;
  notifications?: { emailPaused?: boolean; email?: Partial<NotificationChannel>; inApp?: Partial<NotificationChannel> };
  privacy?: Partial<Preferences["privacy"]>;
};
