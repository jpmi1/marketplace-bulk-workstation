#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Reusable browser worker for the local Marketplace workstation.
 *
 * Reads approved listings from the FastAPI project API, opens Facebook with a
 * persistent local profile, posts Marketplace listings live when both the
 * project setting and CLI flag allow it, and otherwise stops before Publish.
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
const RENEW_LISTING_PATTERN = /(?:^|\b)(renew|refresh)(?:\s+(?:your\s+)?listing)?\??$/i;

function parseArgs(argv) {
  const args = {
    api: DEFAULT_API,
    publishApproved: false,
    editExisting: false,
    renewListings: false,
    renewIfEnabled: false,
    limit: 0,
    ids: [],
    prefix: "",
    editUrl: "",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api") args.api = argv[++i];
    else if (arg === "--publish-approved" || arg === "--live") args.publishApproved = true;
    else if (arg === "--edit-existing") args.editExisting = true;
    else if (arg === "--renew-listings" || arg === "--refresh-listings") args.renewListings = true;
    else if (arg === "--renew-if-enabled" || arg === "--refresh-if-enabled") args.renewIfEnabled = true;
    else if (arg === "--edit-url") args.editUrl = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--ids") args.ids = argv[++i].split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--prefix") args.prefix = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/facebook_marketplace_worker.js [--api http://127.0.0.1:8766] [--publish-approved|--live] [--edit-existing] [--edit-url URL] [--renew-listings|--renew-if-enabled] [--ids id1,id2] [--prefix batch-001] [--limit 5]");
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
    try {
      if (fs.existsSync(out) || (await downloadUrl(urls[index], out))) downloaded.push(out);
    } catch (error) {
      console.warn(`Skipping unavailable reference photo ${urls[index]}: ${error.message}`);
    }
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
      await target.scrollIntoViewIfNeeded().catch(() => null);
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
  console.log("Facebook session is ready; starting Marketplace automation.");
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
  if (lower.includes("video game") || lower.includes("controller")) return unique(["Video Games", "Electronics & computers", ...fallback]);
  if (lower.includes("smart home") || lower.includes("smart lighting") || lower.includes("hue") || lower.includes("echo")) return unique(["Household", "Electronics & computers", ...fallback]);
  if (lower.includes("electronics") || lower.includes("smart")) return unique(["Electronics & computers", "Household", ...fallback]);
  if (lower.includes("home improvement") || lower.includes("mount") || lower.includes("solar") || lower.includes("strap")) return unique(["Tools", "Household", "Garden", ...fallback]);
  if (lower.includes("home") || lower.includes("mattress") || lower.includes("bedroom")) return unique(["Household", "Furniture", ...fallback]);
  if (lower.includes("bag") || lower.includes("pouch") || lower.includes("luggage")) return unique(["Bags & Luggage", "Household", ...fallback]);
  if (lower.includes("clothing") || lower.includes("costume") || lower.includes("shirt") || lower.includes("cap")) return unique(["Men's clothing & shoes", "Women's clothing & shoes", "Baby & kids", "Household", ...fallback]);
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
    for (let scroll = 0; scroll < 5; scroll += 1) {
      await page.mouse.wheel(0, 360);
      await page.waitForTimeout(350);
      if (await clickDropdownOption(page, valuePatterns, opened.minY)) return true;
    }
  }
  return false;
}

async function chooseCategory(page, value) {
  const patterns = facebookCategoryCandidates(value).map((candidate) => new RegExp(`^${escapeRegExp(candidate)}$`, "i"));
  return chooseDropdownValue(page, [/category/i], patterns);
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
    await label.scrollIntoViewIfNeeded().catch(() => null);
    await page.waitForTimeout(250);
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
    await target.scrollIntoViewIfNeeded().catch(() => null);
    await page.waitForTimeout(250);
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
  const roleCandidates = await page.locator('[role="option"], [role="button"], [role="menuitem"]').filter({ hasText: pattern }).all().catch(() => []);
  const textCandidates = await page.getByText(pattern).all().catch(() => []);
  const candidates = [...roleCandidates, ...textCandidates];
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
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => null);
  const photos = await materializePhotos(item);
  const uploaded = await uploadPhotos(page, photos);
  await page.waitForTimeout(1200);
  const result = {
    uploaded,
    title: await fillFirst(page, [/title/i], item.title),
    price: await fillFirst(page, [/price/i], item.price),
    description: await fillFirst(page, [/description/i], item.description),
    category: await chooseCategory(page, item.category),
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

function listingIdFromUrl(url) {
  const match = String(url || "").match(/(?:listing_id=|marketplace\/item\/)(\d+)/i);
  return match ? match[1] : "";
}

function editUrlForListing(item, explicitUrl = "") {
  if (explicitUrl) return explicitUrl;
  const listingId = listingIdFromUrl(item.posted_url);
  if (!listingId) {
    throw new Error(`${item.id}: no Facebook listing id found in posted_url; pass --edit-url`);
  }
  return `https://www.facebook.com/marketplace/edit/?listing_id=${listingId}`;
}

function clampRefreshIntervalDays(value) {
  const parsed = Number(value || 3);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(4, Math.max(3, parsed));
}

function autoRefreshDecision(settings) {
  if (!settings.listing_auto_refresh_enabled) {
    return { run: false, message: "Marketplace listing auto-refresh is disabled in Settings." };
  }
  const intervalDays = clampRefreshIntervalDays(settings.listing_auto_refresh_interval_days);
  const lastRun = Date.parse(settings.listing_auto_refresh_last_run_at || "");
  if (Number.isFinite(lastRun)) {
    const elapsedMs = Date.now() - lastRun;
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
    if (elapsedMs < intervalMs) {
      const nextRun = new Date(lastRun + intervalMs).toISOString();
      return { run: false, message: `Marketplace listing auto-refresh is not due yet. Next eligible run: ${nextRun}` };
    }
  }
  return { run: true, message: `Marketplace listing auto-refresh is enabled and due after ${intervalDays} days.` };
}

async function fullListingToQueueItem(base, id) {
  const listing = await apiGet(base, `/api/listings/${encodeURIComponent(id)}`);
  const photos = (listing.photos || [])
    .filter((photo) => !photo.removed)
    .sort((a, b) => Number(!a.cover) - Number(!b.cover) || (a.sort_order || 0) - (b.sort_order || 0) || String(a.id).localeCompare(String(b.id)));
  return {
    id: listing.id,
    title: listing.title,
    price: listing.price,
    condition: listing.condition,
    category: listing.category,
    quantity_text: listing.quantity_text,
    description: listing.description,
    location: listing.location,
    pickup_enabled: listing.pickup_enabled,
    shipping_enabled: listing.shipping_enabled,
    package_weight_oz: listing.package_weight_oz,
    posted_url: listing.posted_url,
    photo_paths: photos.map((photo) => photo.path).filter(Boolean),
    photo_urls: photos
      .filter((photo) => photo.kind !== "web_candidate" || photo.reference_only_approved)
      .map((photo) => photo.source_url || photo.uri)
      .filter((value) => value && /^https?:\/\//i.test(value)),
  };
}

async function replaceExistingText(page, labels, value) {
  for (const label of labels) {
    const targets = [
      page.getByLabel(label),
      page.getByPlaceholder(label),
      page.getByRole("textbox", { name: label }),
      page.locator('input, textarea, [contenteditable="true"]').filter({ hasText: label }),
    ];
    const target = await firstVisible(targets);
    if (!target) continue;
    await target.scrollIntoViewIfNeeded().catch(() => null);
    await target.click({ clickCount: 3 }).catch(() => null);
    await target.fill(String(value || "")).catch(async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.type(String(value || ""), { delay: 2 });
    });
    return true;
  }
  return false;
}

async function updateExistingListing(page, item, explicitUrl = "") {
  const url = editUrlForListing(item, explicitUrl);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  if (await facebookLoginRequired(page)) {
    throw new Error("Facebook is not logged in in this browser profile.");
  }

  const photos = await materializePhotos(item);
  let uploaded = 0;
  if (photos.length) {
    await removeExistingFacebookPhotos(page);
    uploaded = await uploadPhotos(page, photos.slice(0, 10)).catch(() => 0);
    await page.waitForTimeout(uploaded ? 1500 : 500);
  }

  const result = {
    uploaded,
    title: await replaceExistingText(page, [/title/i], item.title),
    price: await replaceExistingText(page, [/price/i], item.price),
    description: await replaceExistingText(page, [/description/i], item.description),
    location: await replaceExistingText(page, [/location/i], item.location),
  };

  const saveResult = await saveExistingEdit(page);
  if (!saveResult.saved) {
    throw new Error(`Could not find enabled Save/Update button after editing: ${JSON.stringify(result)}`);
  }
  return { ...result, step: saveResult.step };
}

async function removeExistingFacebookPhotos(page) {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => null);
  await page.waitForTimeout(700);
  let removed = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const remove = await firstVisible([
      page.getByRole("button", { name: /^(remove|delete|remove photo|delete photo)$/i }),
      page.locator('button[aria-label*="Remove" i]').first(),
      page.locator('button[aria-label*="Delete" i]').first(),
      page.locator('[aria-label*="Remove photo" i]').first(),
      page.locator('[aria-label*="Delete photo" i]').first(),
    ]);
    if (!remove) break;
    await remove.click().catch(() => null);
    removed += 1;
    await page.waitForTimeout(500);
    const confirm = await firstEnabledButton(page, /^(remove|delete|confirm)$/i);
    if (confirm) {
      await confirm.click();
      await page.waitForTimeout(800);
    }
  }
  return removed;
}

async function saveExistingEdit(page) {
  for (let step = 0; step < 8; step += 1) {
    await page.waitForTimeout(900);
    const save = await firstEnabledButton(page, /^(save|update|publish)$/i);
    if (save) {
      const label = (await save.innerText().catch(() => "save")).trim() || "save";
      await save.click();
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null);
      await page.waitForTimeout(2500);
      return { saved: true, step: label.toLowerCase().replace(/\s+/g, "_") };
    }

    const next = await firstEnabledButton(page, /^next$/i);
    if (next) {
      await next.click();
      continue;
    }

    const skip = await firstEnabledButton(page, /^skip$/i);
    if (skip) {
      await skip.click();
      continue;
    }

    const notNow = await firstEnabledButton(page, /^not now$/i);
    if (notNow) {
      await notNow.click();
      continue;
    }

    break;
  }
  return { saved: false, step: "save_or_update_not_reached" };
}

async function renewVisibleListings(page, limit = 0) {
  await page.goto("https://www.facebook.com/marketplace/you/selling", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  if (await facebookLoginRequired(page)) {
    throw new Error("Facebook is not logged in in this browser profile.");
  }
  let renewed = 0;
  const maxAttempts = limit > 0 ? limit : 50;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const button = await firstEnabledButton(page, RENEW_LISTING_PATTERN);
    if (!button) {
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(900);
      const afterScroll = await firstEnabledButton(page, RENEW_LISTING_PATTERN);
      if (!afterScroll) {
        const menuButton = await firstEnabledButton(page, /^(more|more options|actions|manage)$/i);
        if (!menuButton) break;
        await menuButton.click();
        await page.waitForTimeout(600);
        const menuRenew = await firstEnabledButton(page, RENEW_LISTING_PATTERN);
        if (!menuRenew) {
          await page.keyboard.press("Escape").catch(() => null);
          break;
        }
        await menuRenew.click();
        renewed += 1;
        await page.waitForTimeout(1800);
        continue;
      }
      await afterScroll.click();
    } else {
      await button.click();
    }
    renewed += 1;
    await page.waitForTimeout(1800);
  }
  return { renewed };
}

async function screenshot(page, item, suffix) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const out = path.join(RESULT_DIR, `${item.id}-${suffix}-${Date.now()}.png`);
  await page.screenshot({ path: out, fullPage: true }).catch(() => null);
  return out;
}

async function firstEnabledButton(page, pattern) {
  const roleButtons = await page.getByRole("button", { name: pattern }).all().catch(() => []);
  for (const button of roleButtons) {
    if (!(await button.isVisible().catch(() => false))) continue;
    if (await button.isDisabled().catch(() => false)) continue;
    return button;
  }

  const textCandidates = await page.getByText(pattern).all().catch(() => []);
  for (const candidate of textCandidates) {
    const clickable = await actionableFromTextCandidate(candidate, pattern);
    if (!clickable) continue;
    if (!(await clickable.isVisible().catch(() => false))) continue;
    if (await clickable.isDisabled().catch(() => false)) continue;
    return clickable;
  }
  return null;
}

async function actionableFromTextCandidate(candidate, pattern) {
  if (!(await candidate.isVisible().catch(() => false))) return null;

  const nearbyControls = await candidate
    .locator('xpath=ancestor::*[.//button or .//*[@role="button"] or .//*[@role="menuitem"]][1]')
    .locator('button, [role="button"], [role="menuitem"]')
    .all()
    .catch(() => []);
  for (const control of nearbyControls) {
    if (await controlMatchesTextPattern(control, pattern)) return control;
  }

  const direct = candidate.locator('xpath=ancestor-or-self::*[self::button or self::a or @role="button" or @role="menuitem"][1]');
  if ((await direct.count().catch(() => 0)) > 0) {
    const control = direct.first();
    const ariaLabel = await control.getAttribute("aria-label").catch(() => "");
    if (!ariaLabel || pattern.test(ariaLabel)) return control;
    return null;
  }

  if (pattern === RENEW_LISTING_PATTERN) return null;
  return candidate;
}

async function controlMatchesTextPattern(control, pattern) {
  const ariaLabel = await control.getAttribute("aria-label").catch(() => "");
  if (ariaLabel && !pattern.test(ariaLabel)) return false;
  const text = await control.innerText().catch(() => "");
  return pattern.test(ariaLabel) || pattern.test(text);
}

async function maybePublish(page) {
  for (let step = 0; step < 9; step += 1) {
    await page.waitForTimeout(1200);
    const publish = await firstEnabledButton(page, /^publish$/i);
    if (publish) {
      await publish.click();
      const postedUrl = await waitForPostedUrl(page);
      return { published: true, step: "publish_clicked", postedUrl };
    }

    const next = await firstEnabledButton(page, /^next$/i);
    if (next) {
      await next.click();
      continue;
    }

    const skip = await firstEnabledButton(page, /^skip$/i);
    if (skip) {
      await skip.click();
      continue;
    }

    const notNow = await firstEnabledButton(page, /^not now$/i);
    if (notNow) {
      await notNow.click();
      continue;
    }

    return { published: false, step: `no_enabled_publish_next_or_skip_step_${step}` };
  }
  return { published: false, step: "publish_not_reached_after_steps" };
}

async function waitForPostedUrl(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(3500);
  const currentUrl = page.url();
  if (/facebook\.com\/marketplace\/item\//i.test(currentUrl)) return currentUrl;
  const itemLink = page.locator('a[href*="/marketplace/item/"]').first();
  const href = await itemLink.getAttribute("href").catch(() => "");
  if (!href) return currentUrl;
  return href.startsWith("http") ? href : `https://www.facebook.com${href}`;
}

async function maybeSaveDraft(page) {
  await page.waitForTimeout(900);
  const saveDraft = await firstEnabledButton(page, /^save draft$/i);
  if (!saveDraft) return { saved: false, step: "save_draft_not_available" };
  await saveDraft.click();
  await page.waitForTimeout(1800);
  return { saved: true, step: "save_draft_clicked" };
}

async function main() {
  const args = parseArgs(process.argv);
  const settings = await apiGet(args.api, "/api/settings");
  if (args.renewIfEnabled) {
    const decision = autoRefreshDecision(settings);
    console.log(decision.message);
    if (!decision.run) return;
    args.renewListings = true;
    if (!args.limit) args.limit = Number(settings.listing_auto_refresh_limit || 50);
  }
  let queue = [];
  if (!args.renewListings || args.editExisting) {
    queue = await apiGet(args.api, "/api/posting-queue");
    if (args.ids.length) {
      const wanted = new Set(args.ids);
      queue = queue.filter((item) => wanted.has(item.id));
    }
    if (args.prefix) {
      queue = queue.filter((item) => item.id.startsWith(args.prefix));
    }
    if (args.limit > 0) queue = queue.slice(0, args.limit);
    if (args.editExisting && args.ids.length) {
      queue = [];
      for (const id of args.ids) queue.push(await fullListingToQueueItem(args.api, id));
    }
  }
  if (!queue.length && !args.renewListings) {
    console.log("No approved, valid listings are available in the posting queue.");
    return;
  }
  if (args.publishApproved && !settings.auto_publish) {
    console.log("Live posting requested, but Settings auto_publish=false. The worker will fill listings and stop before Publish.");
  }

  const context = await chromium.launchPersistentContext(settings.facebook_profile_path, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  try {
    await waitForFacebookLogin(page);
    if (args.renewListings) {
      const result = await renewVisibleListings(page, args.limit);
      const message = `Renewed/refreshed ${result.renewed} visible listings.`;
      console.log(message);
      await apiPatch(args.api, "/api/settings", {
        listing_auto_refresh_last_run_at: new Date().toISOString(),
        listing_auto_refresh_last_result: message,
      }).catch((error) => console.warn(`Could not store listing refresh result: ${error.message}`));
    } else if (args.editExisting) {
      for (const item of queue) {
        console.log(`Updating existing Facebook listing ${item.id}: ${item.title}`);
        try {
          const result = await updateExistingListing(page, item, args.editUrl);
          await apiPostLog(args.api, item, {
            status: "published",
            posting_status: `live_edit_saved ${JSON.stringify(result)}`,
          });
          console.log(`Updated ${item.id}: ${JSON.stringify(result)}`);
        } catch (error) {
          const shot = await screenshot(page, item, "edit-failed");
          await apiPostLog(args.api, item, { status: "failed", posting_status: `${error.message} screenshot=${shot}` });
          throw error;
        }
      }
    } else {
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
              posted_url: publishResult.postedUrl || "",
            });
          } else {
            const draftResult = await maybeSaveDraft(page);
            await apiPostLog(args.api, item, { status: "drafted", posting_status: `${draftResult.step} screenshot=${shot}` });
          }
          console.log(`Filled ${item.id}: ${JSON.stringify(result)}`);
        } catch (error) {
          const shot = await screenshot(page, item, "failed");
          await apiPostLog(args.api, item, { status: "failed", posting_status: `${error.message} screenshot=${shot}` });
          console.error(`Failed ${item.id}: ${error.message}`);
        }
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
