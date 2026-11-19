const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { chromium } = require("playwright");

const extension = path.resolve(__dirname, "../extension");
const id = [...crypto.createHash("sha256").update(extension).digest().subarray(0, 16)]
  .flatMap(byte => [byte >> 4, byte & 15]).map(value => String.fromCharCode(97 + value)).join("");
const targetId = "reply-one";
const tray = ["incoming", targetId, "two", "three", "four"].map(id => ({ id, fileUrl: `/stickers/${id}.webp`, name: id }));
const incoming = (id, overrides = {}) => ({ id, conversationId: "a", senderUserId: "friend", messageType: "sticker", stickerId: "incoming", sticker: tray[0], createdAt: new Date().toISOString(), ...overrides });

test("real MV3 extension in Chromium against a mock KuKu chat", { timeout: 120000 }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "kuku-x3-browser-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  t.after(async () => { await context.close(); await fs.rm(profile, { recursive: true, force: true }); });
  const sockets = new Set();
  const posts = [];
  let failure = 0;
  let available = [...tray];
  const adopted = [];
  await context.routeWebSocket("wss://kuku.vn/api/hubs/chat**", socket => { sockets.add(socket); socket.onClose(() => sockets.delete(socket)); });
  const html = await fs.readFile(path.join(__dirname, "fixture.html"), "utf8");
  await context.route("https://kuku.vn/**", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname.endsWith(".webp")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"/>' });
    assert.equal(route.request().headers().authorization, "Bearer fixture-only");
    if (/\/stickers\/[^/]+\/adopt$/.test(url.pathname)) {
      const kept = { id: "kept-foreign", rootStickerId: "foreign-original", name: "Friend sticker", fileUrl: "/stickers/foreign.webp" };
      adopted.push(url.pathname);
      available.push(kept);
      return route.fulfill({ json: { sticker: kept } });
    }
    if (url.pathname.startsWith("/api/stickers/") || url.pathname === "/api/sticker-packs/mine") return route.fulfill({ json: available });
    if (url.pathname === "/api/messages") {
      posts.push(route.request().postDataJSON());
      if (failure) return route.fulfill({ status: failure, json: { error: "fixture_failure" } });
      return route.fulfill({ json: { id: crypto.randomUUID() } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await context.addInitScript(() => {
    localStorage.setItem("zeplao.auth", JSON.stringify({ accessToken: "fixture-only", user: { id: "me" } }));
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.evaluate(async sticker => {
    await chrome.storage.local.set({ kukuStickerSettings: { enabled: true, reactToImages: true, intervalMs: 400, replyStickers: [sticker], triggerStickers: [], mode: "all" } });
  }, tray[1]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://kuku.vn/");
  try {
    await page.waitForSelector("#kuku-sticker-x3-control", { state: "attached", timeout: 5000 });
    await page.locator("#choose").waitFor({ timeout: 5000 });
  } catch (error) {
    t.diagnostic(JSON.stringify({ errors, info: await page.evaluate(() => ({ body: document.body.innerHTML.slice(-1200), status: window.fixture?.statuses.slice(-2), host: document.getElementById("kuku-sticker-x3-control")?.outerHTML })) }));
    throw error;
  }
  await page.waitForFunction(() => fixture.statuses.some(status => status.state === "ready"));
  await popup.waitForSelector("#enabled");
  async function configure(changes) {
    await popup.evaluate(async changes => {
      const result = await chrome.storage.local.get("kukuStickerSettings");
      await chrome.storage.local.set({ kukuStickerSettings: { enabled: true, reactToImages: true, intervalMs: 400, ...result.kukuStickerSettings, ...changes } });
    }, changes);
    await page.waitForTimeout(150);
  }
  await configure({ intervalMs: 400 });
  async function emit(message) {
    for (const socket of sockets) socket.send(JSON.stringify({ type: 1, target: "MessageCreated", arguments: [message] }) + "\x1e");
  }
  async function waitCount(expected) {
    const end = Date.now() + 8000;
    while (posts.length < expected && Date.now() < end) await page.waitForTimeout(40);
    assert.equal(posts.length, expected, `Expected ${expected} POSTs: ${JSON.stringify(await page.evaluate(() => fixture.statuses.slice(-4)))}`);
    await page.waitForTimeout(500);
    assert.equal(posts.length, expected, "No extra sticker sends");
  }

  await t.test("initial old history does not trigger", async () => {
    await page.waitForTimeout(600);
    assert.equal(posts.length, 0);
  });

  await t.test("one incoming sticker receives three replies using only the selected sticker", async () => {
    await emit(incoming("new-one"));
    await waitCount(3);
    assert.ok(posts.every(item => item.stickerId === targetId && item.conversationId === "a" && item.messageType === "sticker" && item.replyToMessageId === "new-one"));
    assert.equal(new Set(posts.map(item => item.clientMessageId)).size, 3);
  });

  await t.test("own stickers, duplicate events, text and background history do not trigger", async () => {
    await emit(incoming("mine", { senderUserId: "me" }));
    await emit(incoming("new-one"));
    await emit(incoming("text", { messageType: "text", stickerId: null, sticker: null }));
    await emit(incoming("background", { conversationId: "b" }));
    await page.waitForTimeout(2100);
    await page.evaluate(() => fixture.switchRoom("b"));
    await page.waitForTimeout(250);
    await page.evaluate(() => fixture.switchRoom("a"));
    await page.waitForTimeout(400);
    assert.equal(posts.length, 3);
  });

  await t.test("image attachments trigger and the image toggle takes effect", async () => {
    await emit(incoming("photo", { messageType: "media", stickerId: null, sticker: null, attachments: [{ id: "photo", mimeType: "image/jpeg" }] }));
    await waitCount(6);
    await configure({ reactToImages: false });
    await emit(incoming("photo-disabled", { messageType: "media", attachments: [{ mimeType: "image/png" }] }));
    await page.waitForTimeout(500);
    assert.equal(posts.length, 6);
    await configure({ reactToImages: true });
  });

  await t.test("DOM fallback handles a new row without a WebSocket event", async () => {
    await page.evaluate(message => fixture.receive(message), incoming("dom-fallback"));
    await waitCount(9);
  });

  await t.test("two tabs do not both reply to the same received message", async () => {
    const second = await context.newPage();
    await second.goto("https://kuku.vn/");
    await second.waitForSelector("#kuku-sticker-x3-control");
    await second.waitForFunction(() => fixture.statuses.some(status => status.state === "ready"));
    await emit(incoming("two-tabs"));
    await waitCount(12);
    await second.close();
  });

  await t.test("disabling during a burst cancels its remaining sends", async () => {
    await configure({ intervalMs: 1500 });
    await emit(incoming("stop-mid-burst"));
    const end = Date.now() + 4000;
    while (posts.length < 13 && Date.now() < end) await page.waitForTimeout(20);
    assert.equal(posts.length, 13);
    await configure({ enabled: false });
    await page.waitForTimeout(1800);
    assert.equal(posts.length, 13);
    await emit(incoming("while-disabled"));
    await page.waitForTimeout(200);
    await configure({ enabled: true, intervalMs: 400 });
    await page.waitForTimeout(500);
    assert.equal(posts.length, 13);
  });

  await t.test("changing chats cancels the remainder of the previous burst", async () => {
    await configure({ intervalMs: 1500 });
    await emit(incoming("switch-mid-burst"));
    const end = Date.now() + 4000;
    while (posts.length < 14 && Date.now() < end) await page.waitForTimeout(20);
    assert.equal(posts.length, 14);
    await page.evaluate(() => fixture.switchRoom("b"));
    await page.waitForTimeout(1750);
    assert.equal(posts.length, 14);
    await page.evaluate(() => fixture.switchRoom("a"));
    await page.waitForTimeout(200);
    await configure({ intervalMs: 400 });
  });

  await t.test("rate limiting stops after the first failed POST and disables the extension", async () => {
    failure = 429;
    await emit(incoming("rate-limit"));
    await waitCount(15);
    await page.waitForFunction(() => fixture.statuses.some(status => status.state === "error" && status.text.includes("giới hạn")));
    const stored = await popup.evaluate(async () => (await chrome.storage.local.get("kukuStickerSettings")).kukuStickerSettings);
    assert.equal(stored.enabled, false);
    failure = 0;
  });

  await t.test("many stickers in two seconds produce one three-sticker reply to the latest message, without buildup during sending", async () => {
    await configure({ enabled: true, intervalMs: 400 });
    for (let index = 0; index < 8; index++) {
      await emit(incoming(`burst-${index}`));
      await page.waitForTimeout(100);
    }
    assert.equal(posts.length, 15, "Wait for the collection window before sending");
    const end = Date.now() + 5000;
    while (posts.length < 16 && Date.now() < end) await page.waitForTimeout(20);
    assert.equal(posts.length, 16);
    for (let index = 0; index < 5; index++) await emit(incoming(`during-send-${index}`));
    await waitCount(18);
    assert.ok(posts.slice(-3).every(item => item.stickerId === targetId && item.replyToMessageId === "burst-7"));
    await page.waitForTimeout(2500);
    assert.equal(posts.length, 18, "No accumulated batches after sending finishes");
  });

  await t.test("a missing target stops without sending any other sticker", async () => {
    available = tray.filter(item => item.id !== targetId);
    await configure({ enabled: true });
    await page.reload();
    await page.waitForSelector("#kuku-sticker-x3-control");
    await page.waitForFunction(() => fixture.statuses.some(status => status.state === "error" && status.text.includes("khay")));
    await emit(incoming("missing-target"));
    await page.waitForTimeout(500);
    assert.equal(posts.length, 18);
  });

  const storedSettings = () => popup.evaluate(async () => (await chrome.storage.local.get("kukuStickerSettings")).kukuStickerSettings);
  await t.test("the gallery selects different outgoing stickers, removes selections and persists after reload", async () => {
    available = [...tray];
    await configure({ enabled: false, replyStickers: [], triggerStickers: [], mode: "all" });
    await page.locator("#choose").click();
    await page.getByRole("dialog", { name: "Chọn sticker tự trả lời" }).waitFor();
    const search = page.locator("#sticker-search");
    await search.fill("two");
    await page.locator('[data-sticker-id="two"]').click();
    await page.waitForTimeout(150);
    await search.fill("three");
    await page.locator('[data-sticker-id="three"]').click();
    await page.waitForTimeout(150);
    assert.deepEqual((await storedSettings()).replyStickers.map(item => item.id), ["two", "three"]);
    await page.getByRole("button", { name: "Bỏ two", exact: true }).click();
    await page.waitForTimeout(150);
    assert.deepEqual((await storedSettings()).replyStickers.map(item => item.id), ["three"]);
    await search.fill("two");
    await page.locator('[data-sticker-id="two"]').click();
    await page.waitForTimeout(150);
    await page.reload();
    await page.waitForSelector("#choose");
    assert.deepEqual((await storedSettings()).replyStickers.map(item => item.id), ["three", "two"]);
  });

  const foreign = { id: "foreign-original", rootStickerId: "foreign-original", name: "Friend sticker", fileUrl: "/stickers/foreign.webp" };
  await t.test("right-click adds a friend's sticker to the reply pool through the normal adopt API and keeps the site's menu", async () => {
    await page.evaluate(message => fixture.receive(message), incoming("friend-menu", { stickerId: foreign.id, sticker: foreign }));
    await page.locator("#message-friend-menu img").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Trả lời", exact: true }).waitFor();
    await page.getByRole("menuitem", { name: "Thêm vào sticker trả lời", exact: true }).click();
    await page.waitForTimeout(350);
    assert.equal(adopted.length, 1);
    assert.ok((await storedSettings()).replyStickers.some(item => item.id === "kept-foreign"));
    assert.equal(await page.evaluate(() => fixture.nativeReplies), 0);
    assert.equal(posts.length, 18, "Choosing a sticker does not send it to chat");
  });

  await t.test("right-click tracking enables matched mode without replacing the outgoing selection", async () => {
    await page.locator("#message-friend-menu img").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Theo dõi sticker này để tự reply", exact: true }).click();
    await page.waitForTimeout(200);
    const saved = await storedSettings();
    assert.equal(saved.mode, "matched");
    assert.equal(saved.triggerStickers[0].id, foreign.id);
    assert.equal(saved.replyStickers.length, 3);
  });

  await t.test("matched mode ignores other stickers and photos, then replies with the selected list to a tracked copy", async () => {
    await configure({ enabled: true, mode: "matched", intervalMs: 400 });
    await emit(incoming("untracked"));
    await emit(incoming("photo-matched", { messageType: "media", attachments: [{ mimeType: "image/png" }] }));
    await page.waitForTimeout(2400);
    assert.equal(posts.length, 18);
    await emit(incoming("tracked-copy", { stickerId: "another-copy", sticker: { ...foreign, id: "another-copy" } }));
    await waitCount(21);
    assert.deepEqual(posts.slice(-3).map(item => item.stickerId), ["three", "two", "kept-foreign"]);
    assert.ok(posts.slice(-3).every(item => item.replyToMessageId === "tracked-copy"));
  });

  await t.test("removing the selected pool cancels a pending window and never sends a fallback", async () => {
    await emit(incoming("cancel-selection", { stickerId: foreign.id, sticker: foreign }));
    await page.waitForTimeout(250);
    await configure({ replyStickers: [] });
    await page.waitForTimeout(2300);
    assert.equal(posts.length, 21);
  });

  assert.deepEqual(errors, []);
});
