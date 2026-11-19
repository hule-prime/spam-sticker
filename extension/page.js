(() => {
  "use strict";
  if (window.__kukuStickerX3Loaded) return;
  window.__kukuStickerX3Loaded = true;

  const core = globalThis.KukuStickerCore;
  const PAGE = "kuku-sticker-x3:page";
  const CONTENT = "kuku-sticker-x3:extension";
  const startedAt = Date.now();
  let config = { ...core.defaults, enabled: false };
  let configured = false;
  let generation = 0;
  let pendingJob = null;
  let batchTimer = null;
  const batchWindowMs = 2000;
  let working = false;
  let stickers = [];
  let ownedStickers = [];
  let rotationOffset = 0;
  let catalogAt = 0;
  let catalogOwner = "";
  let catalogRequest = null;
  let observedRows = new WeakSet();
  let activeConversationNode = null;
  const pendingIds = new Set();
  const observedIds = new Set();
  const status = { state: "starting", text: "Đang kết nối…", sent: 0, batches: 0, available: 0, queued: 0, target: null, replyCount: 0 };

  function publicSticker(value) {
    const item = core.normalizeSticker(value);
    if (!item) return null;
    const absolute = url => url.startsWith("/") ? new URL(`/api${url}`, location.origin).href : url;
    return { ...item, fileUrl: absolute(item.fileUrl), thumbUrl: absolute(item.thumbUrl) };
  }

  function updateTarget() {
    const pool = core.replyPool(stickers, config);
    const target = pool[0] && publicSticker(pool[0]);
    status.target = target ? { id: target.id, name: target.name, previewUrl: target.thumbUrl } : null;
    status.replyCount = pool.length;
  }

  function idleText() {
    if (!config.replyStickers.length) return "Bấm Chọn sticker để chọn mẫu trả lời";
    if (config.mode === "matched" && !config.triggerStickers.length) return "Chưa có sticker theo dõi. Chuột phải sticker để thêm.";
    return config.enabled ? `Chờ tin mới · ${status.replyCount} mẫu trả lời · ${config.mode === "matched" ? "Theo danh sách" : "Mọi sticker/ảnh"}` : "Đã tắt tự gửi";
  }

  function publish(state = status.state, text = status.text) {
    Object.assign(status, { state, text, queued: pendingJob ? 1 : 0 });
    window.postMessage({ source: PAGE, type: "STATUS", status: { ...status } }, location.origin);
  }

  function auth() {
    try {
      const session = JSON.parse(localStorage.getItem("zeplao.auth") || "null");
      if (session?.accessToken && session?.user?.id) return session;
    } catch { /* The login page has no usable session. */ }
    return null;
  }

  class ApiError extends Error {
    constructor(code, text) { super(text); this.code = code; }
  }

  async function api(path, options = {}, expectedOwner) {
    const session = auth();
    if (!session || (expectedOwner && session.user.id !== expectedOwner)) {
      throw new ApiError(401, "Hãy đăng nhập KuKu rồi bật lại.");
    }
    const response = await fetch(new URL(`/api${path}`, location.origin), {
      ...options,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const text = response.status === 401 ? "Phiên đăng nhập hết hạn. Đăng nhập rồi bật lại."
        : response.status === 429 ? "KuKu giới hạn gửi tin. Đã dừng; thử bật lại sau."
        : `KuKu trả lỗi ${response.status}. Đã dừng; kiểm tra rồi bật lại.`;
      throw new ApiError(response.status, text);
    }
    return response.status === 204 ? null : response.json();
  }

  async function loadStickers(owner, force = false) {
    if (!force && catalogOwner === owner && Date.now() - catalogAt < 60000) return stickers;
    if (catalogRequest) return catalogRequest;
    catalogRequest = (async () => {
      const results = await Promise.allSettled(["/stickers/mine", "/stickers/recent", "/stickers/system", "/sticker-packs/mine"]
        .map(path => api(path, {}, owner)));
      const fatal = results.find(item => item.status === "rejected" && [401, 429].includes(item.reason.code));
      if (fatal) throw fatal.reason;
      const successful = results.filter(item => item.status === "fulfilled");
      if (!successful.length) throw results[0].reason;
      // This cache belongs to one account; tokens never leave the page or enter extension storage.
      if (auth()?.user.id !== owner) throw new ApiError(401, "Tài khoản đã đổi. Bật lại để tiếp tục.");
      stickers = core.catalog(successful.map(item => item.value));
      ownedStickers = core.catalog(results.filter((item, index) => item.status === "fulfilled" && index !== 1).map(item => item.value));
      catalogAt = Date.now();
      catalogOwner = owner;
      status.available = stickers.length;
      updateTarget();
      return stickers;
    })().finally(() => { catalogRequest = null; });
    return catalogRequest;
  }

  function messageFromRow(row) {
    const key = Object.keys(row).find(name => name.startsWith("__reactFiber$"));
    let fiber = key ? row[key] : null;
    for (let depth = 0; fiber && depth < 16; depth++, fiber = fiber.return) {
      const message = fiber.memoizedProps?.message;
      if (message?.id === row.dataset.messageId && message.conversationId) return message;
    }
    return null;
  }

  function stickerAt(element, message) {
    let node = element;
    for (let level = 0; node instanceof Element && level < 5; level++, node = node.parentElement) {
      const key = Object.keys(node).find(name => name.startsWith("__reactFiber$"));
      let fiber = key && node[key];
      for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
        const sticker = publicSticker(fiber.memoizedProps?.sticker);
        if (sticker) return sticker;
      }
    }
    return publicSticker(message?.sticker) || publicSticker(stickers.find(item => item.id === message?.stickerId));
  }

  function reportContext(event) {
    const element = event.target instanceof Element ? event.target : null;
    const row = element?.closest(".message-row[data-message-id]");
    const message = row && messageFromRow(row);
    if (message?.messageType !== "sticker" || message.recalledAt) return;
    const sticker = stickerAt(element, message);
    if (sticker) window.postMessage({ source: PAGE, type: "CONTEXT_STICKER", sticker, messageId: message.id, x: event.clientX, y: event.clientY }, location.origin);
  }
  document.addEventListener("contextmenu", reportContext, true);
  document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest(".message-menu-trigger")) reportContext(event);
  }, true);

  async function prepareReply(value) {
    const input = core.normalizeSticker(value);
    const owner = auth()?.user.id;
    if (!input || !owner) throw new Error("Không đọc được sticker hoặc bạn chưa đăng nhập.");
    await loadStickers(owner);
    const own = ownedStickers.find(item => core.sameSticker(item, input));
    if (own) return publicSticker(own);
    // Keeping another person's sticker is the site's regular adopt action.
    const adopted = await api(`/stickers/${encodeURIComponent(input.id)}/adopt`, { method: "POST" }, owner);
    await loadStickers(owner, true);
    const kept = ownedStickers.find(item => core.sameSticker(item, input))
      || core.normalizeSticker(adopted?.sticker || adopted);
    if (!kept) throw new Error("Đã thêm vào khay nhưng chưa đọc được sticker. Hãy tải lại khay.");
    return publicSticker(kept);
  }

  async function handleRequest(data) {
    try {
      let result;
      if (data.type === "GET_CATALOG") {
        const owner = auth()?.user.id;
        if (!owner) throw new Error("Hãy đăng nhập KuKu để mở khay sticker.");
        await loadStickers(owner, data.force === true);
        result = stickers.map(publicSticker).filter(Boolean);
      } else result = await prepareReply(data.sticker);
      window.postMessage({ source: PAGE, type: "RPC_RESULT", requestId: data.requestId, result }, location.origin);
    } catch (error) {
      window.postMessage({ source: PAGE, type: "RPC_RESULT", requestId: data.requestId, error: error.message || "Chưa thực hiện được. Hãy thử lại." }, location.origin);
    }
  }

  function openRow(message) {
    const row = document.getElementById(`message-${message.id}`);
    if (!row || !row.matches(".message-row.theirs") || !row.closest(".message-list")) return null;
    const shell = row.closest(".shell");
    if (shell?.hidden || (shell && getComputedStyle(shell).display === "none")) return null;
    if (shell?.dataset.pane === "list") return null;
    const current = messageFromRow(row);
    if (current && current.conversationId !== message.conversationId) return null;
    return row;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function rememberObserved(id) {
    observedIds.add(id);
    while (observedIds.size > 2000) observedIds.delete(observedIds.values().next().value);
  }

  function stop(text) {
    config.enabled = false;
    generation++;
    clearPending();
    publish("error", text);
    window.postMessage({ source: PAGE, type: "PAUSED", text }, location.origin);
  }

  function clearPending() {
    clearTimeout(batchTimer);
    batchTimer = null;
    pendingJob = null;
  }

  function offerReply(message, owner, ticket) {
    // There is one two-second collection window, never a per-message queue.
    // Incoming stickers during an active send do not add another batch.
    if (working) return;
    if (pendingJob) {
      pendingJob.ids.push(message.id);
      if (Date.parse(message.createdAt) >= Date.parse(pendingJob.message.createdAt)) pendingJob.message = message;
      return;
    }
    pendingJob = { message, owner, ticket, ids: [message.id] };
    publish("collecting", "Gom sticker trong 2 giây · Tối đa một lượt 3 sticker");
    batchTimer = setTimeout(() => {
      const latest = pendingJob;
      clearPending();
      if (latest && config.enabled && latest.ticket === generation) void drain(latest);
    }, batchWindowMs);
  }

  async function accept(message, live = false) {
    const owner = auth()?.user.id;
    if (!configured || !config.enabled || !config.replyStickers.length || !core.isTrigger(message, owner, config)) return;
    if (pendingIds.has(message.id) || observedIds.has(message.id)) return;
    // Old history, scrolling and reloads must never trigger a response.
    const time = Date.parse(message.createdAt);
    if (!live && (!Number.isFinite(time) || time < startedAt)) return;
    const ticket = generation;
    pendingIds.add(message.id);
    try {
      if (live) {
        for (const delay of [0, 80, 200, 500, 1000]) {
          if (delay) await sleep(delay);
          if (ticket !== generation || !config.enabled) return;
          if (openRow(message)) break;
        }
      }
      if (!openRow(message) || ticket !== generation || !config.enabled) {
        if (live) rememberObserved(message.id);
        return;
      }
      rememberObserved(message.id);
      offerReply(message, owner, ticket);
    } finally {
      pendingIds.delete(message.id);
    }
  }

  async function sendBatch(job) {
    const { message, owner, ticket } = job;
    const valid = () => config.enabled && generation === ticket && auth()?.user.id === owner && !!openRow(message);
    if (!valid()) return;
    const ledgerKey = `kuku.stickerX3.processed.${owner}`;
    let ledger;
    try {
      ledger = JSON.parse(localStorage.getItem(ledgerKey) || "[]");
      if (!Array.isArray(ledger)) ledger = [];
    } catch { ledger = []; }
    if (job.ids.some(id => ledger.includes(id))) return;
    await loadStickers(owner);
    let selected = core.pickReplies(stickers, config, rotationOffset);
    if (!selected.length) {
      await loadStickers(owner, true);
      selected = core.pickReplies(stickers, config, rotationOffset);
    }
    if (!valid()) return;
    if (!selected.length) {
      stop("Các sticker đã chọn không còn trong khay. Mở bảng chọn để cập nhật.");
      return;
    }
    // Claim before sending: an uncertain network result must not produce a second batch.
    localStorage.setItem(ledgerKey, JSON.stringify([...ledger, ...job.ids].slice(-1000)));
    publish("sending", "Đang gửi 3 sticker từ danh sách đã chọn…");
    for (let index = 0; index < selected.length; index++) {
      if (index) await sleep(config.intervalMs);
      if (!valid()) return;
      await api("/messages", {
        method: "POST",
        body: JSON.stringify({
          conversationId: message.conversationId,
          stickerId: selected[index].id,
          messageType: "sticker",
          clientMessageId: crypto.randomUUID(),
          replyToMessageId: message.id,
        }),
      }, owner);
      status.sent++;
      publish("sending", `Đã gửi ${index + 1}/3 sticker`);
    }
    status.batches++;
    rotationOffset += 3;
  }

  async function drain(job) {
    if (working) return;
    working = true;
    try {
      // Chrome Web Locks serializes all KuKu tabs; all IDs in a window are claimed together.
      if (!navigator.locks) throw new Error("Chrome chưa hỗ trợ khoá tab. Hãy cập nhật Chrome.");
      await navigator.locks.request("kuku-sticker-x3:send", () => sendBatch(job));
      if (config.enabled) publish("ready", idleText());
    } catch (error) {
      stop(error instanceof ApiError ? error.message : "Gửi chưa hoàn tất. Đã dừng; kiểm tra kết nối rồi bật lại.");
    } finally {
      working = false;
    }
  }

  // Observe the existing SignalR connection without sending or changing its frames.
  const NativeWebSocket = window.WebSocket;
  const WrappedWebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args, newTarget) {
      const socket = Reflect.construct(Target, args, newTarget === WrappedWebSocket ? Target : newTarget);
      try {
        const url = new URL(args[0], location.href);
        if (url.hostname === location.hostname && url.pathname === "/api/hubs/chat") {
          socket.addEventListener("message", event => {
            for (const message of core.liveMessages(event.data)) void accept(message, true);
          });
        }
      } catch { /* Other WebSockets belong to the site and are left alone. */ }
      return socket;
    },
  });
  window.WebSocket = WrappedWebSocket;

  function baseline() {
    activeConversationNode = document.querySelector(".conversation-item.active");
    observedRows = new WeakSet(document.querySelectorAll(".message-list .message-row[data-message-id]"));
    for (const row of document.querySelectorAll(".message-list .message-row[data-message-id]")) {
      rememberObserved(row.dataset.messageId);
    }
  }

  function scanRows() {
    if (document.querySelector(".conversation-item.active") !== activeConversationNode) {
      baseline();
      return;
    }
    for (const row of document.querySelectorAll(".message-list .message-row[data-message-id]")) {
      if (observedRows.has(row)) continue;
      observedRows.add(row);
      const message = messageFromRow(row);
      if (message) void accept(message);
    }
  }

  let scanTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanRows, 40);
  });
  observer.observe(document, { childList: true, subtree: true });

  async function checkSession(ticket) {
    const owner = auth()?.user.id;
    if (ticket !== generation) return;
    if (!owner) { publish("waiting", "Chờ bạn đăng nhập KuKu"); return; }
    try {
      await loadStickers(owner);
      if (ticket !== generation) return;
      updateTarget();
      if (!config.replyStickers.length || (config.mode === "matched" && !config.triggerStickers.length)) {
        publish("choosing", idleText());
        return;
      }
      if (!status.target) {
        const text = "Các sticker đã chọn không còn trong khay. Mở bảng chọn để cập nhật.";
        if (config.enabled) stop(text);
        else publish("paused", text);
        return;
      }
      if (!working) {
        publish(config.enabled ? "ready" : "paused", idleText());
      }
    } catch (error) {
      if (config.enabled && ticket === generation) stop(error instanceof ApiError ? error.message : "Chưa tải được khay sticker. Kiểm tra kết nối rồi bật lại.");
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== CONTENT) return;
    if (event.data.type === "GET_STATUS") { publish(); return; }
    if (["GET_CATALOG", "PREPARE_REPLY"].includes(event.data.type)) { void handleRequest(event.data); return; }
    if (event.data.type !== "SETTINGS") return;
    const next = core.settings(event.data.settings);
    const toggled = !configured || config.enabled !== next.enabled || JSON.stringify([config.mode, config.replyStickers, config.triggerStickers]) !== JSON.stringify([next.mode, next.replyStickers, next.triggerStickers]);
    config = next;
    configured = true;
    if (toggled) {
      generation++;
      clearPending();
      baseline();
      rotationOffset = 0;
      updateTarget();
      if (!config.enabled) publish("paused", "Đã tắt tự gửi");
      void checkSession(generation);
    } else publish();
  });

  setInterval(() => {
    if (config.enabled && status.state === "waiting" && auth()) void checkSession(generation);
    publish();
  }, 5000);
  window.postMessage({ source: PAGE, type: "READY" }, location.origin);
})();
