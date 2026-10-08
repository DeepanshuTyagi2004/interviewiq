import { describe, expect, it, vi } from "vitest";
import { createPgPool } from "../../src/db/pg/client.js";

const settings = { url: "postgres://user:pass@127.0.0.1:1/none", ssl: "disable" as const, poolMax: 1 };

describe("createPgPool", () => {
  it("survives an idle connection failing: the error is reported, not thrown", async () => {
    const onIdleError = vi.fn();
    const pool = createPgPool(settings, onIdleError);
    const dropped = new Error("read EADDRNOTAVAIL");
    // Without a listener, emitting "error" throws (and in the API, crashed the process).
    expect(() => pool.emit("error", dropped)).not.toThrow();
    expect(onIdleError).toHaveBeenCalledWith(dropped);
    await pool.end();
  });

  it("has a default listener for scripts that pass none", async () => {
    const pool = createPgPool(settings);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
    await pool.end();
  });
});
