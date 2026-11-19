(() => {
  "use strict";

  const defaults = Object.freeze({ enabled: true, reactToImages: true, intervalMs: 800, mode: "all", replyStickers: Object.freeze([]), triggerStickers: Object.freeze([]) });

  function normalizeSticker(value) {
    if (!value || typeof value.id !== "string" || !value.id.trim() || typeof value.fileUrl !== "string") return null;
    const validUrl = url => typeof url === "string" && url.length <= 4096 && (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url));
    if (!validUrl(value.fileUrl)) return null;
    return {
      id: value.id.slice(0, 150),
      rootStickerId: typeof value.rootStickerId === "string" ? value.rootStickerId.slice(0, 150) : null,
      name: String(value.name || "Sticker").slice(0, 150),
      fileUrl: value.fileUrl,
      thumbUrl: validUrl(value.thumbUrl) ? value.thumbUrl : value.fileUrl,
    };
  }

  function sameSticker(left, right) {
    if (!left || !right) return false;
    const a = [left.id, left.stickerId, left.rootStickerId].filter(Boolean);
    const b = [right.id, right.stickerId, right.rootStickerId].filter(Boolean);
    return a.some(id => b.includes(id)) || !!(left.fileUrl && left.fileUrl === right.fileUrl);
  }

  function stickerList(values) {
    const list = [];
    for (const value of Array.isArray(values) ? values : []) {
      const item = normalizeSticker(value);
      if (item && !list.some(other => sameSticker(item, other))) list.push(item);
    }
    return list;
  }

  function settings(value = {}) {
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
      reactToImages: typeof value.reactToImages === "boolean" ? value.reactToImages : defaults.reactToImages,
      intervalMs: Number.isFinite(Number(value.intervalMs))
        ? Math.min(5000, Math.max(400, Math.round(Number(value.intervalMs))))
        : defaults.intervalMs,
      mode: value.mode === "matched" ? "matched" : "all",
      replyStickers: stickerList(value.replyStickers),
      triggerStickers: stickerList(value.triggerStickers),
    };
  }

  function isTrigger(message, userId, config) {
    if (!message?.id || !message.conversationId || !message.senderUserId || !userId) return false;
    if (message.senderUserId === userId || message.recalledAt || message.status === "recalled") return false;
    if (message.messageType === "sticker") {
      if (config.mode !== "matched") return true;
      const sticker = { ...message.sticker, stickerId: message.stickerId };
      return (config.triggerStickers || []).some(item => sameSticker(item, sticker));
    }
    if (config.mode === "matched") return false;
    if (!config.reactToImages) return false;
    const attachments = [...(Array.isArray(message.attachments) ? message.attachments : []), message.attachment];
    return attachments.some(item => item && (item.kind === "image" || item.mimeType?.startsWith("image/")));
  }

  function catalog(data) {
    const found = [];
    function visit(value) {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      if (typeof value.id === "string" && typeof value.fileUrl === "string" && value.fileUrl) {
        found.push(value);
      } else {
        for (const key of ["items", "stickers", "packs", "mine", "recent", "system"]) visit(value[key]);
      }
    }
    visit(data);
    return [...new Map(found.map(item => [item.id, item])).values()];
  }

  function replyPool(stickers, config) {
    return (config.replyStickers || []).map(selected =>
      stickers.find(item => item.id === selected.id) || stickers.find(item => sameSticker(item, selected))
    ).filter(Boolean);
  }

  function pickReplies(stickers, config, offset = 0) {
    const pool = replyPool(stickers, config);
    return pool.length ? Array.from({ length: 3 }, (_, index) => pool[(offset + index) % pool.length]) : [];
  }

  function liveMessages(payload) {
    if (typeof payload !== "string") return [];
    const messages = [];
    for (const frame of payload.split("\u001e")) {
      try {
        const event = JSON.parse(frame);
        if (event.type === 1 && event.target?.toLowerCase() === "messagecreated") {
          for (const item of event.arguments ?? []) {
            if (item?.id && item.conversationId) messages.push(item);
          }
        }
      } catch { /* Handshake, heartbeat and non-JSON frames are not messages. */ }
    }
    return messages;
  }

  globalThis.KukuStickerCore = Object.freeze({ defaults, normalizeSticker, sameSticker, stickerList, settings, isTrigger, catalog, replyPool, pickReplies, liveMessages });
})();
