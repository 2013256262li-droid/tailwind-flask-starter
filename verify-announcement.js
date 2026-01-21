// verify-announcement.js
const { chromium } = require("playwright");

async function run() {
  const baseURL = process.env.BASE_URL || "http://127.0.0.1:5000";

  // 你的实现里明确存在这两个 id；保留兜底选择器兼容其它实现
  const barSelector =
    process.env.BAR_SELECTOR ||
    "#announcement-bar, [data-testid='announcement-bar'], .announcement-bar";
  const closeSelector =
    process.env.CLOSE_SELECTOR ||
    "#announcement-close, button#announcement-close, [data-dismiss-target], [data-dismiss]";

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const result = {
    baseURL,
    barSelector,
    closeSelector,
    homepage_has_bar: null,
    otherpage_has_bar: null,
    close_button_found: null,
    close_click_hides: null,
    refresh_still_hidden: null,
    storage_keys: null,
    chosen_storage_key: null,
    expiry_works: null,
    console_errors: [],
    notes: [],
  };

  // 采集 console error（用于发现非首页 JS 报错等问题）
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      result.console_errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    result.console_errors.push(String(err));
  });

  // 工具函数：安全判断元素是否可见
  async function isBarVisible() {
    try {
      const loc = page.locator(barSelector).first();
      if ((await loc.count()) === 0) return false;
      return await loc.isVisible();
    } catch {
      return false;
    }
  }

  // 工具函数：获取 localStorage keys
  async function getStorageKeys() {
    try {
      return await page.evaluate(() => Object.keys(localStorage));
    } catch {
      return [];
    }
  }

  // 工具函数：选择最像“关闭时间”的 key
  function chooseStorageKey(keys) {
    if (!keys || keys.length === 0) return null;

    // 强优先：常见命名
    const priority = [
      "announcementClosedTime",
      "announcementClosed",
      "announcementClosedAt",
      "announcementDismissedAt",
    ];
    for (const p of priority) {
      if (keys.includes(p)) return p;
    }

    // 次优先：包含 announcement 且包含 closed/dismiss
    const candidates = keys.filter(
      (k) =>
        /announcement/i.test(k) &&
        (/closed/i.test(k) || /dismiss/i.test(k) || /hidden/i.test(k))
    );
    if (candidates.length > 0) return candidates[0];

    // 再兜底：任何包含 announcement 的 key
    const any = keys.find((k) => /announcement/i.test(k));
    return any || keys[0];
  }

  // 1) 首页：检查公告条是否存在
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  result.homepage_has_bar = (await page.locator(barSelector).count()) > 0;

  // 2) 非首页：检查公告条是否不存在（只首页显示要求）
  await page.goto(`${baseURL}/accordion`, { waitUntil: "domcontentloaded" });
  result.otherpage_has_bar = (await page.locator(barSelector).count()) > 0;

  // 记录非首页是否出现 console error（常见：announcementBar 为 null 仍访问 style）
  if (result.console_errors.length > 0) {
    result.notes.push("console_errors_detected_on_other_page");
  }

  // 3) 回到首页，执行关闭测试
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  // 3.1 找关闭按钮
  const closeLoc = page.locator(closeSelector).first();
  result.close_button_found = (await closeLoc.count()) > 0;

  if (!result.close_button_found) {
    result.notes.push("close_button_not_found");
    // 如果找不到按钮，后续无法验证关闭/存储/过期
    result.close_click_hides = null;
    result.refresh_still_hidden = null;
    result.storage_keys = await getStorageKeys();
    result.expiry_works = null;
    await browser.close();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 3.2 点击关闭
  let clicked = false;
  try {
    await closeLoc.click({ timeout: 3000 });
    clicked = true;
  } catch {
    result.notes.push("close_button_not_clickable");
  }

  // 3.3 点击后公告条应隐藏
  const visibleAfterClick = await isBarVisible();
  result.close_click_hides = clicked ? !visibleAfterClick : null;

  // 3.4 刷新后仍隐藏（7天记忆的一部分）
  await page.reload({ waitUntil: "domcontentloaded" });
  const visibleAfterReload = await isBarVisible();
  result.refresh_still_hidden = clicked ? !visibleAfterReload : null;

  // 4) 检查 localStorage 是否写入
  const keys = await getStorageKeys();
  result.storage_keys = keys;

  const chosenKey = chooseStorageKey(keys);
  result.chosen_storage_key = chosenKey;

  if (!chosenKey) {
    result.notes.push("no_storage_key_found_after_close");
    result.expiry_works = null;
    await browser.close();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 5) 过期验证：把时间写成 8 天前 → 刷新后应重新显示
  //   - 先尝试写 ISO
  //   - 若页面实现使用 timestamp，也会在读取 new Date(value) 时兼容
  await page.evaluate((k) => {
    const eightDaysMs = 8 * 24 * 3600 * 1000;
    const old = new Date(Date.now() - eightDaysMs);
    localStorage.setItem(k, old.toISOString());
  }, chosenKey);

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  const visibleAfterExpiry = await isBarVisible();
  result.expiry_works = visibleAfterExpiry;

  await browser.close();
  console.log(JSON.stringify(result, null, 2));
}

run().catch((e) => {
  console.error("VERIFY_FAILED", e);
  process.exit(1);
});
