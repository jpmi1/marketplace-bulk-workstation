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
const LOGIN_WAIT_MS = 15 * 60 * 1000;
const LOGIN_POLL_MS = 2500;

function parseArgs(argv) {
  const args = { api: DEFAULT_API, publishApproved: false, limit: 0, ids: [], prefix: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api") args.api = argv[++i];
    else if (arg === "--publish-approved") args.publishApproved = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--ids") args.ids = argv[++i].split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--prefix") args.prefix = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/facebook_marketplace_worker.js [--api http://127.0.0.1:8766] [--publish-approved] [--ids id1,id2] [--prefix batch-001] [--limit 5]");
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

async function facebookLoginRequired(page) {
  const currentUrl = page.url();
  if (/facebook\.com\/(login|checkpoint|recover|two_step_verification)/i.test(currentUrl)) return true;
  if ((await page.locator('input[type="password"]').count().catch(() => 0)) > 0) return true;
  const loginAction = await firstVisible([
    page.getByRole("button", { name: /^(log in|login)$/i }),
    page.getByRole("link", { name: /^(log in|login)$/i }),
    page.getByText(/^(log in|login)$/i),
  ]);
  return Boolean(loginAction);
}

async function waitForFacebookLogin(page) {
  console.log("Opening Facebook in the configured browser profile.");
  console.log("If a login screen appears, log in in that browser window. Posting will start automatically after the session is ready.");
  await page.goto("https://www.facebook.com/marketplace", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const startedAt = Date.now();
  let lastReminderAt = 0;
  while (await facebookLoginRequired(page)) {
    if (Date.now() - startedAt > LOGIN_WAIT_MS) {
      throw new Error("Timed out waiting for Facebook login in the opened browser profile.");
    }
    if (Date.now() - lastReminderAt > 30000) {
      console.log("Waiting for Facebook login to finish in the browser window...");
      lastReminderAt = Date.now();
    }
    await page.waitForTimeout(LOGIN_POLL_MS);
  }
  console.log("Facebook session is ready; starting the posting queue.");
}

function leaf(value) {
  return String(value || "").split("//").map((part) => part.trim()).filter(Boolean).at(-1) || String(value || "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function facebookCategoryCandidates(value) {
  const lower = String(value || "").toLowerCase();
  const fallback = ["Household"];
  if (lower.includes("video game")) return unique(["Video Games", "Electronics & computers", ...fallback]);
  if (lower.includes("electronics") || lower.includes("smart")) return unique(["Electronics & computers", "Household", ...fallback]);
  if (lower.includes("home") || lower.includes("mattress") || lower.includes("bedroom")) return unique(["Household", "Furniture", ...fallback]);
  return unique([leaf(value), ...fallback]);
}

function facebookCondition(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("new") && !lower.includes("like")) return "New";
  if (lower.includes("fair")) return "Fair";
  if (lower.includes("like new")) return "Like New";
  return "Good";
}

async function chooseDropdownValue(page, triggerPatterns, valuePatterns) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await clickDropdownField(page, triggerPatterns);
    if (!opened.opened) await clickText(page, triggerPatterns);
    await page.waitForTimeout(800 + attempt * 500);
    if (await clickDropdownOption(page, valuePatterns, opened.minY)) return true;
  }
  return false;
}

async function clickDropdownField(page, labelPatterns) {
  for (const pattern of labelPatterns) {
    const labels = await page.getByText(pattern).all().catch(() => []);
    let label = null;
    for (const candidate of labels) {
      const box = await candidate.boundingBox().catch(() => null);
      if (!box || box.x > 380 || box.width <= 0 || box.height <= 0) continue;
      label = candidate;
      break;
    }
    if (!label) label = await firstVisible([page.getByText(pattern).first()]);
    if (!label) continue;
    const box = await label.boundingBox().catch(() => null);
    if (!box) continue;
    await page.mouse.click(box.x + Math.min(285, Math.max(40, box.width + 15)), box.y + Math.max(8, box.height / 2));
    return { opened: true, minY: box.y + box.height + 8 };
  }
  return { opened: false, minY: 100 };
}

async function clickDropdownOption(page, valuePatterns, minY = 100) {
  for (const pattern of valuePatterns) {
    const target = await visibleMenuCandidate(page, pattern, minY);
    if (!target) continue;
    const box = await target.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + Math.min(24, box.width / 2), box.y + box.height / 2);
    } else {
      await target.click({ force: true });
    }
    await page.waitForTimeout(600);
    return true;
  }
  return false;
}

async function visibleMenuCandidate(page, pattern, minY = 100) {
  const textCandidates = await page.getByText(pattern).all().catch(() => []);
  const roleCandidates = await page.locator('[role="option"], [role="button"], [role="menuitem"]').filter({ hasText: pattern }).all().catch(() => []);
  const candidates = [...textCandidates, ...roleCandidates];
  for (const candidate of candidates) {
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const minX = minY > 420 ? 20 : 45;
    if (box.x > 380 || box.x < minX || box.y < minY) continue;
    return candidate;
  }
  return null;
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
    category: await chooseDropdownValue(page, [/category/i], facebookCategoryCandidates(item.category).map((candidate) => new RegExp(`^${escapeRegExp(candidate)}\\b`, "i"))),
    condition: await chooseDropdownValue(page, [/condition/i], [new RegExp(`^Used - ${facebookCondition(item.condition)}$`, "i"), new RegExp(`^${facebookCondition(item.condition)}$`, "i")]),
    location: await fillFirst(page, [/location/i], item.location),
  };
  if (!result.category || !result.condition) {
    throw new Error(`Required Facebook dropdown was not selected: category=${result.category}, condition=${result.condition}`);
  }
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

async function firstEnabledButton(page, pattern) {
  const roleButtons = await page.getByRole("button", { name: pattern }).all().catch(() => []);
  const textButtons = await page.getByText(pattern).all().catch(() => []);
  const buttons = [...roleButtons, ...textButtons];
  for (const button of buttons) {
    if (!(await button.isVisible().catch(() => false))) continue;
    if (await button.isDisabled().catch(() => false)) continue;
    return button;
  }
  return null;
}

async function maybePublish(page) {
  for (let step = 0; step < 5; step += 1) {
    await page.waitForTimeout(900);
    const publish = await firstEnabledButton(page, /^publish$/i);
    if (publish) {
      await publish.click();
      await page.waitForTimeout(2500);
      return { published: true, step: "publish_clicked" };
    }

    const next = await firstEnabledButton(page, /^next$/i);
    if (next) {
      await next.click();
      continue;
    }

    return { published: false, step: `no_enabled_publish_or_next_step_${step}` };
  }
  return { published: false, step: "publish_not_reached_after_steps" };
}

async function main() {
  const args = parseArgs(process.argv);
  const settings = await apiGet(args.api, "/api/settings");
  let queue = await apiGet(args.api, "/api/posting-queue");
  if (args.ids.length) {
    const wanted = new Set(args.ids);
    queue = queue.filter((item) => wanted.has(item.id));
  }
  if (args.prefix) {
    queue = queue.filter((item) => item.id.startsWith(args.prefix));
  }
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
    await waitForFacebookLogin(page);
    for (const item of queue) {
      console.log(`Filling ${item.id}: ${item.title}`);
      try {
        const result = await fillListing(page, item);
        const shot = await screenshot(page, item, "draft");
        const autoPublish = Boolean(args.publishApproved && settings.auto_publish && item.auto_publish_allowed);
        if (autoPublish) {
          const publishResult = await maybePublish(page);
          await apiPostLog(args.api, item, {
            status: publishResult.published ? "published" : "drafted",
            posting_status: publishResult.step,
          });
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
