import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2300);

await page.getByRole("button", { name: "Login" }).click();
await page.waitForTimeout(220);
await page.screenshot({ path: "artifacts/screenshots/1-login-immediate.png", fullPage: true });

await page.getByRole("button", { name: "Close login sheet" }).click();
await page.waitForTimeout(220);
await page.screenshot({ path: "artifacts/screenshots/2-profile-after-close.png", fullPage: true });

await page.getByRole("button", { name: "Log in or sign up" }).click();
await page.getByRole("button", { name: "Continue with phone" }).click();
await page.waitForTimeout(180);
await page.screenshot({ path: "artifacts/screenshots/3-phone-otp-step.png", fullPage: true });

await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Continue with email" }).click();
await page.waitForTimeout(180);
await page.screenshot({ path: "artifacts/screenshots/4-email-options-step.png", fullPage: true });

await page.getByRole("button", { name: "Use email OTP" }).click();
await page.waitForTimeout(180);
await page.screenshot({ path: "artifacts/screenshots/5-email-otp-step.png", fullPage: true });

await page.getByLabel("Email address").fill("ashutosh@gmail.com");
await page.getByLabel("Email OTP").fill("123456");
await page.getByRole("button", { name: "Send OTP" }).click();
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Edit name" }).click();
await page.waitForTimeout(150);
await page.screenshot({ path: "artifacts/screenshots/6-loggedin-edit-logout.png", fullPage: true });

await browser.close();
