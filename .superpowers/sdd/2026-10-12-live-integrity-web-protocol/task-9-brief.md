### Task 9: Clear the clipboard at Join, and say the rules

**Files:**
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/ChecksView.tsx`, `PrejoinView.tsx`
- Test: `ChecksView.test.tsx`, `PrejoinView.test.tsx` (create), same folder

**Interfaces:**
- Consumes: `clearSystemClipboard`, `wasCleared`, `resetClipboard` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add to the imports of `ChecksView.test.tsx`:

```tsx
import { resetClipboard, wasCleared } from "@/features/interview-live/proctor/localClipboard";
```

Append inside `describe("ChecksView", …)`:

```tsx
  it("Enter interview clears the clipboard once, with the click, while the clipboard rules are active", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      const user = await renderAtChecks(new MockLiveSession());
      mockEntireScreen();
      await user.click(screen.getByRole("button", { name: "Share entire screen" }));
      const enterButton = await screen.findByRole("button", { name: /enter interview/i });
      await waitFor(() => expect(enterButton).toBeEnabled());
      await user.click(enterButton);
      await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("live"));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("IQ-ROOM-CLIPBOARD");
      expect(wasCleared()).toBe(true);
    } finally {
      resetClipboard();
      Reflect.deleteProperty(navigator, "clipboard");
      vi.unstubAllEnvs();
    }
  });

  it("Enter interview still goes live when the clipboard cannot be cleared", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    try {
      const user = await renderAtChecks(new MockLiveSession());
      mockEntireScreen();
      await user.click(screen.getByRole("button", { name: "Share entire screen" }));
      const enterButton = await screen.findByRole("button", { name: /enter interview/i });
      await waitFor(() => expect(enterButton).toBeEnabled());
      await user.click(enterButton);
      await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("live"));
      expect(wasCleared()).toBe(false);
    } finally {
      resetClipboard();
      Reflect.deleteProperty(navigator, "clipboard");
      vi.unstubAllEnvs();
    }
  });

  it("tells the candidate the clipboard is cleared on entering", async () => {
    await renderAtChecks(new MockLiveSession());
    expect(screen.getByText(/clears your clipboard/i)).toBeInTheDocument();
  });
```

Create `PrejoinView.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveSessionProvider } from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { PrejoinView } from "./PrejoinView";

describe("PrejoinView rules", () => {
  it("states the return time, paste and typing rules before the candidate agrees", () => {
    render(
      <LiveSessionProvider sessionId="s1" session={new MockLiveSession()}>
        <PrejoinView />
      </LiveSessionProvider>,
    );
    expect(screen.getByText(/come back within 15 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/after 60 seconds the interview ends/)).toBeInTheDocument();
    expect(screen.getByText(/pasting outside text ends the interview/)).toBeInTheDocument();
    expect(screen.getByText(/automated typing ends the interview/)).toBeInTheDocument();
    expect(screen.getByLabelText(/pasting text from outside the room or typing by script ends the interview/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run "app/(app)/interviews/[sessionId]/live/_components/ChecksView.test.tsx" "app/(app)/interviews/[sessionId]/live/_components/PrejoinView.test.tsx"`
Expected: FAIL (no clipboard write; the copy is not there).

- [ ] **Step 3: Clear the clipboard in `ChecksView.tsx`**

Add the import next to the other `@/features/interview-live/proctor/…` imports:

```tsx
import { clearSystemClipboard } from "@/features/interview-live/proctor/localClipboard";
```

Replace the start of `handleEnter`:

```tsx
  async function handleEnter() {
    setEntering(true);
    // Clearing the clipboard needs this click's user gesture, so it starts before anything is awaited. It never rejects: a
    // refusal is recorded, and the worker then treats a foreign paste as a violation rather than an ending.
    const clearing = clearSystemClipboard();
    try {
      await enterFullscreen();
    } catch {
      setEntering(false);
      return;
    }
    await clearing;
```

(the rest of `handleEnter` is unchanged). Change the intro paragraph to: "We run a quick check before entering the interview. Entering switches to full screen and clears your clipboard. Switching tabs, windows or screens is counted, and the interviewer will mention it."

- [ ] **Step 4: Say the rules in `PrejoinView.tsx`**

Replace `DONTS` with:

```tsx
const DONTS = [
  "Don't switch tabs, windows or screens. Every switch is counted, and repeated switches end the round.",
  "If you do leave this screen or full screen, come back within 15 seconds (30 for full screen or screen share). After that it counts as another violation, and after 60 seconds the interview ends.",
  "Don't paste text from anywhere else. Copy and paste work only inside this room, your clipboard is cleared when you join, and pasting outside text ends the interview.",
  "Don't use automated typing or scripts. Your code must be typed by you, and automated typing ends the interview.",
  "Don't use a phone, second monitor, or another person for help.",
  "Don't refresh or close this tab once the interview has started.",
];
```

In the notice paragraph, replace the sentence ending "…only short summaries of them." with: "…only short summaries of them. The interviewer also notices how you type, such as how steadily and whether text appears without typing, but never which keys you press."

Replace the agreement label text with:

```tsx
              I understand the interview runs in full screen with my entire
              screen shared, that the interviewer sees my cursor, typing and
              drawing, that switching tabs or screens is counted and can end
              the round, that pasting text from outside the room or typing by
              script ends the interview, that my clipboard is cleared when I
              join, and I agree to the rules above.
```

- [ ] **Step 5: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run "app/(app)/interviews/[sessionId]/live"`
Expected: PASS (the existing checks, prejoin gating and live tests too).

- [ ] **Step 6: Leave the files in the working tree** (no commit): `ChecksView.tsx`, `PrejoinView.tsx`, `ChecksView.test.tsx`, `PrejoinView.test.tsx`.

---

