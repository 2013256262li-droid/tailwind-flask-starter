const { chromium } = require("playwright");

async function run() {
  const baseURL = process.env.BASE_URL || "http://127.0.0.1:5000";
  const barSelector = process.env.BAR_SELECTOR || "#announcement-bar, [data-testid='announcement-bar'], .announcement-bar";
  const closeSelector = process.env.CLOSE_SELECTOR || "#announcement-close, button#announcement-close, button[aria-label*='close' i], button[data-dismiss-target], button[data-dismiss]";

  const result = {
    baseURL,
    barSelector,
    closeSelector,
    homepage_bar_visible: null,
    otherpage_bar_visible: null,
    close_button_found: null,
    close_click_hides: null,
    refresh_still_hidden: null,
    storage_keys: null,
    chosen_storage_key: null,
    expiry_works: null,
    console_errors: [],
    notes: [],
    meta: { time: new Date().toISOString() },
  };

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // capture console errors
  page.on("pageerror", (err) => {
    result.console_errors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") result.console_errors.push(msg.text());
  });

  // helper: check visible
  async function isVisible(sel) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) return false;
    return await loc.isVisible();
  }

  // 1) Homepage
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  result.homepage_bar_visible = await isVisible(barSelector);

  // 2) Other page (accordion)
  await page.goto(`${baseURL}/accordion`, { waitUntil: "domcontentloaded" });
  result.otherpage_bar_visible = await isVisible(barSelector);

  // 3) Back to homepage and close
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  const closeLoc = page.locator(closeSelector).first();
  result.close_button_found = (await closeLoc.count()) > 0;

  if (!result.close_button_found) {
    result.notes.push("close_button_not_found");
  } else {
    try {
      await closeLoc.click({ timeout: 2000 });
    } catch (e) {
      result.notes.push("close_button_not_clickable");
    }
  }

  // after click
  const visibleAfterClick = await isVisible(barSelector);
  result.close_click_hides = result.close_button_found ? !visibleAfterClick : null;

  // reload
  await page.reload({ waitUntil: "domcontentloaded" });
  const visibleAfterReload = await isVisible(barSelector);
  result.refresh_still_hidden = result.close_button_found ? !visibleAfterReload : null;

  // storage keys
  const keys = await page.evaluate(() => Object.keys(localStorage));
  result.storage_keys = keys;

  // pick key: prefer closedAnnouncement, else first match
  const preferred = "closedAnnouncement";
  const candidate = keys.includes(preferred)
    ? preferred
    : (keys.find(k => /announcement|closed|dismiss/i.test(k)) || null);

  result.chosen_storage_key = candidate;

  if (!candidate) {
    result.notes.push("no_storage_key_found");
  } else {
    // set value to 8 days ago (try ISO first)
    await page.evaluate((k) => {
      const eightDaysMs = 8 * 24 * 3600 * 1000;
      const old = new Date(Date.now() - eightDaysMs);
      localStorage.setItem(k, old.toISOString());
    }, candidate);

    // navigate home and check bar re-appears
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    const visibleAfterExpiry = await isVisible(barSelector);
    result.expiry_works = visibleAfterExpiry;
  }

  // note about console errors on other page
  if (result.console_errors.length > 0 && result.otherpage_bar_visible === false) {
    result.notes.push("console_errors_detected_on_other_page");
  }

  await browser.close();
  console.log(JSON.stringify(result, null, 2));
}

run().catch((e) => {
  console.error("VERIFY_FAILED", e);
  process.exit(1);
});
