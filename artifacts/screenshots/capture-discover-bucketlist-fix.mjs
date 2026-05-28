import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";

const workspaceRoot = process.cwd();
const screenshotDir = path.join(workspaceRoot, "artifacts", "screenshots");
let previewUrl = "http://127.0.0.1:4173";

const previewProcess = process.platform === "win32"
  ? spawn("powershell.exe", ["-Command", "npm run preview -- --host 127.0.0.1 --port 4173"], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    })
  : spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

function waitForPreviewReady(timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let log = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for preview server.\n${log}`));
    }, timeoutMs);

    const onData = (chunk) => {
      const text = chunk.toString();
      log += text;
      const urlMatch = text.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (urlMatch) {
        previewUrl = urlMatch[0].replace(/\/$/, "");
      }
      if (text.includes("Local")) {
        clearTimeout(timeout);
        cleanup();
        resolve();
      }
    };

    const onExit = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Preview server exited before ready.\n${log}`));
    };

    const cleanup = () => {
      previewProcess.stdout.off("data", onData);
      previewProcess.stderr.off("data", onData);
      previewProcess.off("exit", onExit);
    };

    previewProcess.stdout.on("data", onData);
    previewProcess.stderr.on("data", onData);
    previewProcess.on("exit", onExit);
  });
}

async function main() {
  try {
    await waitForPreviewReady();

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
    await page.goto(previewUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".wr-bucket-item-tile", { timeout: 20000 });

    await page.screenshot({
      path: path.join(screenshotDir, "discover-bucketlist-all-tiles.png"),
      fullPage: true,
    });

    const tiles = page.locator(".wr-bucket-item-tile");
    const labels = ["taste", "activity", "stay", "explore"];
    for (let i = 0; i < labels.length; i += 1) {
      const box = await tiles.nth(i).boundingBox();
      if (!box) continue;
      await page.screenshot({
        path: path.join(screenshotDir, `discover-bucketlist-${labels[i]}-tile-close.png`),
        clip: {
          x: Math.max(0, Math.floor(box.x)),
          y: Math.max(0, Math.floor(box.y)),
          width: Math.ceil(box.width),
          height: Math.ceil(box.height),
        },
      });
    }

    await browser.close();
  } finally {
    if (!previewProcess.killed) {
      previewProcess.kill();
    }
  }
}

await main();
