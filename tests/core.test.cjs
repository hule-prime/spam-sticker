const test = require("node:test");
const assert = require("node:assert/strict");
require("../extension/core.js");
const core = globalThis.KukuStickerCore;
const sticker = id => ({ id, fileUrl: `/stickers/${id}.webp` });

test("only sends user-selected stickers and repeats a single selected image three times", () => {
  const target = sticker("chosen");
  const config = core.settings({ replyStickers: [target] });
  assert.deepEqual(core.pickReplies([target], config), [target, target, target]);
  assert.deepEqual(core.pickReplies([sticker("other"), target], config), [target, target, target]);
});

test("an empty selection or missing selected sticker never falls back to another image", () => {
  assert.deepEqual(core.pickReplies([sticker("a"), sticker("b")], core.settings()), []);
  assert.deepEqual(core.pickReplies([{ ...sticker("wrong"), name: "same name" }], core.settings({ replyStickers: [{ ...sticker("chosen"), name: "same name" }] })), []);
});

test("multiple selected stickers rotate, and adopted copies resolve by their original ID", () => {
  const a = sticker("a"), b = sticker("b");
  const config = core.settings({ replyStickers: [a, b] });
  assert.deepEqual(core.pickReplies([a, b], config), [a, b, a]);
  assert.deepEqual(core.pickReplies([a, b], config, 3), [b, a, b]);
  const clone = { ...sticker("clone-id"), rootStickerId: a.id };
  assert.deepEqual(core.pickReplies([clone], core.settings({ replyStickers: [a] })), [clone, clone, clone]);
});

test("matched mode accepts only tracked sticker identities, including copies, and ignores photos", () => {
  const config = core.settings({ mode: "matched", triggerStickers: [sticker("original")] });
  const message = { id: "m", conversationId: "room", senderUserId: "friend", messageType: "sticker", stickerId: "copy", sticker: { ...sticker("copy"), rootStickerId: "original" } };
  assert.equal(core.isTrigger(message, "me", config), true);
  assert.equal(core.isTrigger({ ...message, stickerId: "another", sticker: sticker("another") }, "me", config), false);
  assert.equal(core.isTrigger({ ...message, messageType: "media", attachments: [{ mimeType: "image/png" }] }, "me", config), false);
  assert.equal(core.isTrigger(message, "me", core.settings({ mode: "matched" })), false);
});

test("saved lists deduplicate copies and discard unsafe URLs", () => {
  const a = sticker("a");
  const values = core.settings({ replyStickers: [a, { ...sticker("clone"), rootStickerId: "a" }, { id: "bad", fileUrl: "javascript:alert(1)" }] });
  assert.deepEqual(values.replyStickers.map(item => item.id), ["a"]);
  assert.equal(core.normalizeSticker({ id: "bad", fileUrl: "//example.com/image" }), null);
});

test("ignores own messages and treats only image attachments as optional triggers", () => {
  const incoming = { id: "m", conversationId: "room", senderUserId: "friend", messageType: "sticker" };
  assert.equal(core.isTrigger(incoming, "me", core.defaults), true);
  assert.equal(core.isTrigger(incoming, "friend", core.defaults), false);
  assert.equal(core.isTrigger(incoming, null, core.defaults), false);
  assert.equal(core.isTrigger({ ...incoming, recalledAt: "now" }, "me", core.defaults), false);
  const photo = { ...incoming, messageType: "media", attachments: [{ mimeType: "image/png" }] };
  assert.equal(core.isTrigger(photo, "me", core.defaults), true);
  assert.equal(core.isTrigger(photo, "me", { ...core.defaults, reactToImages: false }), false);
  assert.equal(core.isTrigger({ ...photo, attachments: [{ mimeType: "video/mp4" }] }, "me", core.defaults), false);
  assert.equal(core.isTrigger({ ...photo, attachments: [] }, "me", core.defaults), false);
});

test("decodes concatenated SignalR events, ignores updates, history and binary data", () => {
  const message = { id: "m", conversationId: "room" };
  const created = JSON.stringify({ type: 1, target: "MessageCreated", arguments: [message] });
  const updated = JSON.stringify({ type: 1, target: "MessageUpdated", arguments: [message] });
  const payload = '{}\x1e{"type":6}\x1e' + created + "\x1e" + updated + "\x1einvalid\x1e";
  assert.deepEqual(core.liveMessages(payload), [message]);
  assert.deepEqual(core.liveMessages(new Uint8Array(10)), []);
});

test("normalizes the real KuKu array catalog and removes duplicate IDs", () => {
  assert.deepEqual(core.catalog([[sticker("a")], [sticker("a"), sticker("b")], { packs: [{ stickers: [sticker("c")] }] }]).map(item => item.id), ["a", "b", "c"]);
});

test("clamps settings and defaults malformed values", () => {
  assert.deepEqual(core.settings(), core.defaults);
  assert.equal(core.settings({ intervalMs: 1 }).intervalMs, 400);
  assert.equal(core.settings({ intervalMs: Infinity }).intervalMs, 800);
  assert.equal(core.settings({ intervalMs: 9000 }).intervalMs, 5000);
  assert.equal(core.settings({ enabled: "yes" }).enabled, true);
});
