import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationSettings } from "./NotificationSettings";

const mutate = vi.hoisted(() => vi.fn());
const channel = { interviewReminders: true, debriefReady: true, retakeAvailable: true, targetOpenings: true, weeklyDigest: true, productUpdates: false };

vi.mock("@/features/account", () => ({
  usePreferences: () => ({
    data: {
      locale: { appLanguage: "en", timezone: null, dateFormat: "DD/MM/YYYY", timeFormat: "12h", weekStart: "monday" },
      interview: { language: "en", voice: "neutral", pace: "normal", captions: true, showTimer: true, deviceCheck: true, reminderLead: "1h" },
      notifications: { emailPaused: false, email: channel, inApp: { ...channel, weeklyDigest: false } },
      privacy: { leaderboardVisibility: "anonymous", shareWithCollege: false, partnerDiscovery: false, improveWithMyData: false },
      updatedAt: null,
    },
    isError: false,
  }),
  useUpdatePreferences: () => ({ mutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("NotificationSettings", () => {
  it("shows every topic by channel and saves one leaf when a switch is flipped", () => {
    render(<NotificationSettings />);
    expect(screen.getByRole("switch", { name: "Weekly digest by email" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Weekly digest in the app" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("switch", { name: "Product updates by email" }));
    expect(mutate).toHaveBeenCalledWith({ notifications: { email: { productUpdates: true } } }, expect.anything());
    fireEvent.click(screen.getByRole("switch", { name: "Pause all email" }));
    expect(mutate).toHaveBeenCalledWith({ notifications: { emailPaused: true } }, expect.anything());
  });
});
