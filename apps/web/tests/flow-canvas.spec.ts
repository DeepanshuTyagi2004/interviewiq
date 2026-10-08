import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { ProcessGraph } from "../features/loops/types";

let server: ViteDevServer;
let origin: string;

test.beforeAll(async () => {
  const root = path.resolve(__dirname, "..");
  server = await createServer({
    root, configFile: false, plugins: [react()],
    resolve: { alias: { "@": root } },
    server: { port: 0, host: "127.0.0.1" },
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!;
});
test.afterAll(async () => { await server?.close(); });

test("editor drag follows the pointer, preserves labels/edges/inspector values and doesn't refit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}tests/fixtures/flow-canvas.html`);
  const alpha = page.locator('.react-flow__node[data-id="a"]');
  await expect(alpha).toBeVisible();
  await expect(alpha).toContainText("Round 01");
  await expect(page.locator('.react-flow__node[data-id="b"]')).toContainText("Round 02");
  await page.getByLabel("Inspector name").fill("Inspector edit");
  const viewport = page.locator(".react-flow__viewport");
  await expect(viewport).toHaveCSS("transform", /matrix/);
  const transform = await viewport.evaluate((el) => getComputedStyle(el).transform);
  const scale = await viewport.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  const box = (await alpha.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + 30 };
  // Cross the other round's x coordinate, which previously renumbered both cards.
  const dx = 340, dy = 55;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // The installed XYDrag takes its grab offset when the >1px threshold is
  // crossed, not on mousedown. Cross it first using a realistic small movement.
  await page.mouse.move(start.x + 2, start.y);
  await page.mouse.move(start.x + 2 + dx, start.y + dy, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => {
    const graph = JSON.parse(await page.getByTestId("graph").innerText()) as ProcessGraph;
    return graph.nodes.find((n) => n.id === "a")!.position.x;
  }).toBeCloseTo(dx / scale, 0);
  const graph = JSON.parse(await page.getByTestId("graph").innerText()) as ProcessGraph;
  expect(graph.nodes.find((n) => n.id === "a")!.position.y).toBeCloseTo(dy / scale, 0);
  expect(graph.nodes.find((n) => n.id === "a")!.name).toBe("Inspector edit");
  expect(graph.edges).toEqual([{ source: "a", target: "b" }]);
  await expect(alpha).toContainText("Round 01");
  await expect(page.locator('.react-flow__node[data-id="b"]')).toContainText("Round 02");
  await expect(viewport).toHaveCSS("transform", transform);
  expect(errors).toEqual([]);
});

test("typing Delete in inspector controls keeps the selected node", async ({ page }) => {
  await page.goto(`${origin}tests/fixtures/flow-canvas.html`);
  const alpha = page.locator('.react-flow__node[data-id="a"]');
  await alpha.click();
  for (const name of ["Inspector name", "Inspector difficulty", "Inspector instructions", "Inspector contenteditable"]) {
    await page.getByLabel(name).focus();
    await page.keyboard.press("Delete");
    await expect(alpha).toBeVisible();
  }
  await alpha.click();
  await page.keyboard.press("Delete");
  await expect(alpha).toHaveCount(0);
});

test("HUD view canvas has a real viewport, correct booking hit target and native palette drop coordinates", async ({ page }) => {
  await page.goto(`${origin}tests/fixtures/flow-canvas.html?mode=view`);
  const flow = page.locator(".react-flow");
  await expect(flow).toBeVisible();
  expect((await flow.boundingBox())!.height).toBeGreaterThan(280);
  expect(await page.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--hud-zoom").trim())).toBe("0.9");
  await page.getByRole("button", { name: "Book this round" }).click();
  await expect(page.getByTestId("booked")).toHaveText("a");

  await page.goto(`${origin}tests/fixtures/flow-canvas.html`);
  await expect(page.locator('.react-flow__node[data-id="a"]')).toBeVisible();
  expect(await page.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--hud-zoom").trim())).toBe("1");
  const pane = page.locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  const target = { x: box.width * 0.7, y: box.height * 0.75 };
  const transform = await page.locator(".react-flow__viewport").evaluate((el) => {
    const matrix = new DOMMatrix(getComputedStyle(el).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
  await page.getByRole("button", { name: "Palette round" }).dragTo(pane, { targetPosition: target });
  await expect.poll(async () => JSON.parse(await page.getByTestId("drop").innerText())).toMatchObject({ payload: "round:dsa" });
  const drop = JSON.parse(await page.getByTestId("drop").innerText()) as { position: { x: number; y: number } };
  // Native DragEvent client coordinates are integer pixels, whereas bounding
  // boxes and transforms can be fractional CSS pixels.
  expect(Math.abs(drop.position.x - (target.x - transform.x) / transform.zoom)).toBeLessThan(1.5);
  expect(Math.abs(drop.position.y - (target.y - transform.y) / transform.zoom)).toBeLessThan(1.5);
});

test("a compact canvas without a parent height still measures a nonzero viewport", async ({ page }) => {
  const sizingWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("parent container needs a width and a height")) sizingWarnings.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}tests/fixtures/flow-canvas.html?layout=intrinsic`);
  await expect(page.locator('.react-flow__node[data-id="a"]')).toBeVisible();
  const box = (await page.locator(".react-flow").boundingBox())!;
  const dimensions = await page.locator(".react-flow").evaluate((el) => {
    const result = [];
    for (let current: Element | null = el; current && result.length < 4; current = current.parentElement) {
      const css = getComputedStyle(current);
      result.push({ class: current.className, height: css.height, minHeight: css.minHeight, display: css.display, position: css.position, inline: current.getAttribute("style") });
    }
    return result;
  });
  expect(box.height, JSON.stringify(dimensions)).toBeGreaterThan(270);
  expect(box.width).toBeGreaterThan(300);
  expect(sizingWarnings).toEqual([]);
});
