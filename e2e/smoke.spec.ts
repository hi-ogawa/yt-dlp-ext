import { expect } from "@playwright/test";
import { test } from "./helper.ts";

test("extension page renders with search form", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator("text=yt-dlp-ext")).toBeVisible();
  await expect(page.getByText("Video ID")).toBeVisible();
  await expect(page.getByPlaceholder("ID or URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
});

test("invalid video ID shows error toast", async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByPlaceholder("ID or URL").fill("invalid");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Invalid video ID or URL")).toBeVisible();
});
