#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Reusable browser worker for the local Marketplace workstation.
 *
 * Reads approved listings from the FastAPI project API, opens Facebook with a
 * persistent local profile, fills Marketplace item drafts, and stops before the
 * final Publish button unless both the project setting and CLI flag allow it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_API = "http://127.0.0.1:8766";
const ROOT = path.resolve(__dirname, "..");
const RESULT_DIR = path.join(ROOT, "projects", "default", "posting-runs");

function parseArgs(argv) {
  const args = { api: DEFAULT_API, publishApproved: false, limit: 0 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api") args.api = argv[++i];
    else if (arg === "--publish-approved") args.publishApproved = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/facebook_marketplace_worker.js [--api http://127.0.0.1:8766] [--publish-approved] [--limit 5]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function apiGet(base, route) {
  const response = await fetch(`${base}${route}`);
  if (!response.ok) throw new Error(`${route} failed: ${response.status}`);
  return response.json();
}

async function apiPatch(base, route, data) {
  const response = await fetch(`${base}${route}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!response.ok) throw new Error(`${route} failed: ${response.status}`);
  return response.json();
}

async function apiPostLog(base, listing, data) {
  await apiPatch(base, `/api/listings/${encodeURIComponent(listing.id)}`, data).catch((error) => {
    console.warn(`Could not update listing ${listing.id}: ${error.message}`);
  });
}

async function downloadUrl(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed ${response.status}: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

async function materializePhotos(item) {
  const local = (item.photo_paths || []).filter((photoPath) => fs.existsSync(photoPath));
  const urls = item.photo_urls || [];
  if (!urls.length) return local;
  const tmpDir = path.join(os.tmpdir(), "marketplace-bulk-photos", item.id);
  const downloaded = [];
  for (let index = 0; index < urls.length; index += 1) {
    const ext = path.extname(new URL(urls[index]).pathname).slice(0, 6) || ".jpg";
    const out = path.join(tmpDir, `${String(index + 1).padStart(2, "0")}${ext}`);
    if (fs.existsSync(out) || (await downloadUrl(urls[index], out))) downloaded.push(out);
  }
  return [...local, ...downloaded];
}

async function firstVisible(locators) {
  for (const locator of locators) {
    if ((await locator.count().catch(() => 0)) === 0) continue;
    const first = locator.first();
    if (await first.isVisible().catch(() => false)) return first;
  }
  return null;
}

async function fillFirst(page, labels, value) {
  for (const label of labels) {
    const target = await firstVisible([page.getByLabel(label), page.getByPlaceholder(label), page.getByRole("textbox", { name: label })]);
    if (target) {
      await target.fill(String(value || ""));
      return true;
    }
  }
  return false;
}

async function clickText(page, patterns) {
  for (const pattern of patterns) {
    const target = await firstVisible([page.getByRole("button", { name: pattern }), page.getByText(pattern)]);
    if (target) {
      await target.click();
      return true;
    }
  }
  return false;
}

function leaf(value) {
  return String(value || "").split("//").map((part) => part.trim()).filter(Boolean).at(-1) || String(value || "");
}

async function chooseDropdownValue(page, triggerPatterns, valuePatterns) {
  await clickText(page, triggerPatterns);
  await page.waitForTimeout(600);
  return clickText(page, valuePatterns);
}

async function uploadPhotos(page, paths) {
  if (!paths.length) throw new Error("No usable photo files are available.");
  const input = page.locator('input[type="file"]').first();
  if ((await input.count()) > 0) {
    await input.setInputFiles(paths);
    return paths.length;
  }
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  const clicked = await clickText(page, [/add photo/i, /photos/i]);
  const chooser = clicked ? await chooserPromise : null;
  if (!chooser) throw new Error("Could not find a Facebook photo upload control.");
  await chooser.setFiles(paths);
  return paths.length;
}

async function fillListing(page, item) {
  await page.goto("https://www.facebook.com/marketplace/create/item", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const photos = await materializePhotos(item);
  const uploaded = await uploadPhotos(page, photos);
  await page.waitForTimeout(1200);
  const result = {
    uploaded,
    title: await fillFirst(page, [/title/i], item.title),
    price: await fillFirst(page, [/price/i], item.price),
    description: await fillFirst(page, [/description/i], item.description),
    category: await chooseDropdownValue(page, [/category/i], [new RegExp(leaf(item.category), "i")]),
    condition: await chooseDropdownValue(page, [/condition/i], [new RegExp(leaf(item.condition).replace(/^Used - /, ""), "i")]),
    location: await fillFirst(page, [/location/i], item.location),
  };
  if (item.pickup_enabled) await clickText(page, [/local pickup/i, /pickup/i]).catch(() => false);
  if (item.shipping_enabled) await clickText(page, [/shipping/i, /set up shipping/i]).catch(() => false);
  return result;
}

async function screenshot(page, item, suffix) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const out = path.join(RESULT_DIR, `${item.id}-${suffix}-${Date.now()}.png`);
  await page.screenshot({ path: out, fullPage: true }).catch(() => null);
  return out;
}

async function maybePublish(page) {
  const publish = await firstVisible([page.getByRole("button", { name: /^publish$/i }), page.getByRole("button", { name: /^next$/i })]);
  if (!publish) return false;
  await publish.click();
  return true;
}

async function main() {
  const args = parseArgs(process.argv);
  const settings = await apiGet(args.api, "/api/settings");
  let queue = await apiGet(args.api, "/api/posting-queue");
  if (args.limit > 0) queue = queue.slice(0, args.limit);
  if (!queue.length) {
    console.log("No approved, valid listings are available in the posting queue.");
    return;
  }

  const context = await chromium.launchPersistentContext(settings.facebook_profile_path, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  try {
    for (const item of queue) {
      console.log(`Filling ${item.id}: ${item.title}`);
      try {
        const result = await fillListing(page, item);
        const shot = await screenshot(page, item, "draft");
        const autoPublish = Boolean(args.publishApproved && settings.auto_publish && item.auto_publish_allowed);
        if (autoPublish) {
          const published = await maybePublish(page);
          await apiPostLog(args.api, item, { status: published ? "published" : "drafted", posting_status: published ? "publish_clicked" : "publish_button_not_found" });
        } else {
          await apiPostLog(args.api, item, { status: "drafted", posting_status: `draft_filled screenshot=${shot}` });
        }
        console.log(`Filled ${item.id}: ${JSON.stringify(result)}`);
      } catch (error) {
        const shot = await screenshot(page, item, "failed");
        await apiPostLog(args.api, item, { status: "failed", posting_status: `${error.message} screenshot=${shot}` });
        console.error(`Failed ${item.id}: ${error.message}`);
      }
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
