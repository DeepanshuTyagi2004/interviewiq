import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomLink } from "./RoomLink";

let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  request = vi.fn(async () => {});
  document.documentElement.requestFullscreen = request as unknown as typeof document.documentElement.requestFullscreen;
});
afterEach(() => { Reflect.deleteProperty(document.documentElement, "requestFullscreen"); });

describe("RoomLink", () => {
  it("goes full screen on the click that opens the room, so the instruction page is already full screen", async () => {
    const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(<RoomLink href="/interviews/s1/live" onClick={onClick}>Join</RoomLink>);
    await userEvent.click(screen.getByRole("link", { name: "Join" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalled();                       // the caller's own handler still runs
  });

  it("leaves every other link alone", async () => {
    render(<RoomLink href="/loops/l1" onClick={(e) => e.preventDefault()}>Loop</RoomLink>);
    await userEvent.click(screen.getByRole("link", { name: "Loop" }));
    expect(request).not.toHaveBeenCalled();
  });

  it("still opens the room when the browser can't or won't go full screen", async () => {
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(<RoomLink href="/interviews/s1/live" onClick={onClick}>Join</RoomLink>);
    await userEvent.click(screen.getByRole("link", { name: "Join" }));
    expect(onClick).toHaveBeenCalled();
  });
});
