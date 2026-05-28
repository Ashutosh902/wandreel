import { chromium } from "playwright";
import path from "node:path";

const outDir = path.resolve("artifacts/figma-handoff/screens");
const url = "http://localhost:5173";

const shots = [
  { name: "01-discover-home.png", action: async () => {} },
  {
    name: "02-category-taste.png",
    action: async (page) => {
      await page.getByRole("button", { name: /open taste category/i }).click();
    },
  },
  {
    name: "03-category-activity.png",
    action: async (page) => {
      await page.getByRole("button", { name: /back to discover/i }).click();
      await page.getByRole("button", { name: /open activity category/i }).click();
    },
  },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
await page.goto(url, { waitUntil: "networkidle" });

for (const shot of shots) {
  await shot.action(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, shot.name), fullPage: true });
}

await browser.close();
console.log("Saved handoff screens to", outDir);
