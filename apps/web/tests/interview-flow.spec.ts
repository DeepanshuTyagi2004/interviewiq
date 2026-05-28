import { test, expect } from "@playwright/test";

test.skip("interview live route renders", async ({ page }) => {
  await page.goto("/interviews/demo/live");
  await expect(page.getByText(/live/i)).toBeVisible();
});
