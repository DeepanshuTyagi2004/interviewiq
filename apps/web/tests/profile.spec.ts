import { test, expect } from "@playwright/test";

test.skip("profile page requires auth", async ({ page }) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login/);
});
