import { describe, expect, it } from "vitest";
import { ARM_REACH, applyPose, idlePose, natural, pawFromWorld, SHOULDER, stroll, toWorld, tumbling, TUMBLE } from "./pose";
import { SCENES } from "./scenes";
import type { Stage } from "./stage";

/** A stage that records every write instead of touching the DOM. */
function recorder() {
  const writes: { part: string; attr: string; value: string }[] = [];
  const stage: Stage = {
    set: (part, attr, value) => writes.push({ part, attr, value: String(value) }),
    text: (part, value) => writes.push({ part, attr: "#text", value }),
  };
  return { stage, writes };
}

const times = (duration: number) => Array.from({ length: Math.round(duration / 0.05) + 1 }, (_, i) => i * 0.05);

describe("prep animation scenes", () => {
  it("has five chapters with unique ids and a still inside each", () => {
    expect(SCENES.map((s) => s.id)).toEqual(["reader", "card-sorter", "note-taker", "architect", "warm-up"]);
    for (const scene of SCENES) {
      expect(scene.duration).toBeGreaterThan(5);
      expect(scene.still).toBeGreaterThanOrEqual(0);
      expect(scene.still).toBeLessThanOrEqual(scene.duration);
    }
  });

  it("plays every frame of every chapter without broken values, moving the whole cat", () => {
    for (const scene of SCENES) {
      const { stage, writes } = recorder();
      for (const t of times(scene.duration)) scene.frame(t, stage);
      const bad = writes.filter((w) => /NaN|undefined|Infinity/.test(w.value));
      expect(bad, `${scene.id}: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);
      for (const part of ["cat", "armRig", "pawRig", "head", "paw", "arm"]) {
        expect(writes.some((w) => w.part === part), `${scene.id} writes ${part}`).toBe(true);
      }
      // The cat moves about: its rig takes more than one position in every chapter.
      expect(new Set(writes.filter((w) => w.part === "cat").map((w) => w.value)).size, scene.id).toBeGreaterThan(10);
    }
  });

  it("never stretches the arm past its natural reach", () => {
    for (const scene of SCENES) {
      const { stage, writes } = recorder();
      for (const t of times(scene.duration)) scene.frame(t, stage);
      for (const w of writes.filter((w) => w.part === "paw" && w.attr === "transform")) {
        const [x, y] = w.value.match(/-?[\d.]+/g)!.map(Number);
        expect(Math.hypot(x! - SHOULDER.x, y! - SHOULDER.y), `${scene.id} ${w.value}`).toBeLessThanOrEqual(ARM_REACH + 0.05);
      }
    }
  });

  it("shows each kind of face somewhere: laughing, a toothy grin, dizzy eyes, a wink", () => {
    const shown = new Set<string>();
    for (const scene of SCENES) {
      const { stage, writes } = recorder();
      for (const t of times(scene.duration)) scene.frame(t, stage);
      for (const w of writes) if (w.attr === "opacity" && w.value === "1") shown.add(w.part);
    }
    for (const part of ["laugh", "mouthLaugh", "mouthGrin", "dizzy", "winkR", "happy", "closed", "mouthO", "tongue"]) {
      expect(shown, part).toContain(part);
    }
  });

  it("never names topics, problems or difficulty in its status lines", () => {
    for (const scene of SCENES) {
      for (const t of times(scene.duration)) {
        const line = scene.status(t);
        expect(line.length).toBeGreaterThan(2);
        expect(line).not.toMatch(/easy|medium|hard|graph|array|dynamic|topic|leetcode|system design/i);
      }
    }
  });
});

describe("cat rig", () => {
  it("maps between the cat's own coordinates and the scene both ways, flipped and fallen over", () => {
    const pose = { ...idlePose(1), x: 40, y: -6, rot: 63, flip: -1 as const, squash: 0.3 };
    const local = { x: 130, y: 150 };
    const back = pawFromWorld(pose, toWorld(pose, local));
    expect(back.x).toBeCloseTo(local.x, 6);
    expect(back.y).toBeCloseTo(local.y, 6);
  });

  it("keeps facing the way it last walked", () => {
    const keys: [number, number][] = [
      [0, 0],
      [1, 80],
      [2, 80],
      [3, 20],
      [4, 20],
    ];
    const at = (t: number) => {
      const pose = idlePose(t);
      stroll(pose, t, keys);
      return pose;
    };
    expect(at(0.5).flip).toBe(1);
    expect(at(1.5).flip).toBe(1);
    expect(at(2.5).flip).toBe(-1);
    expect(at(3.5)).toMatchObject({ flip: -1, x: 20 });
    expect(at(0.5).stepAmp).toBeGreaterThan(0);
    expect(at(3.5).stepAmp).toBe(0);
  });

  it("falls over, gets up, and keeps the bandage afterwards", () => {
    const at = (t: number) => {
      const pose = idlePose(t);
      const playing = tumbling(pose, t, 1, 1);
      return { pose, playing };
    };
    expect(at(0.5)).toMatchObject({ playing: false, pose: { rot: 0, bandage: 0 } });
    expect(at(2.0).pose.rot).toBeGreaterThan(80);
    expect(at(2.0).pose.eyes).toBe("dizzy");
    expect(at(1 + TUMBLE - 0.2).pose).toMatchObject({ eyes: "happy", mouth: "grin" });
    expect(at(1 + TUMBLE + 1)).toMatchObject({ playing: false, pose: { rot: 0, bandage: 1 } });
  });

  it("pulls an out-of-reach paw back to the arm's length", () => {
    const far = natural({ x: SHOULDER.x + 200, y: SHOULDER.y });
    expect(far).toEqual({ x: SHOULDER.x + ARM_REACH, y: SHOULDER.y });
    const near = { x: SHOULDER.x + 10, y: SHOULDER.y + 10 };
    expect(natural(near)).toBe(near);
  });

  it("shows exactly one set of eyes and one mouth at a time", () => {
    const { stage, writes } = recorder();
    applyPose(stage, { ...idlePose(0), eyes: "wink", mouth: "blep" });
    const shown = writes.filter((w) => w.attr === "opacity" && w.value === "1").map((w) => w.part);
    expect(shown).toEqual(expect.arrayContaining(["eyeL", "winkR", "mouthW", "tongue"]));
    expect(shown).not.toContain("eyeR");
    expect(shown).not.toContain("mouthLaugh");
  });
});
