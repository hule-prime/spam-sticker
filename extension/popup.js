"use strict";
const KEY = "kukuStickerSettings";
const core = globalThis.KukuStickerCore;
const enabled = document.getElementById("enabled");
const images = document.getElementById("reactToImages");
const interval = document.getElementById("intervalMs");
const label = document.getElementById("intervalValue");
const mode = document.getElementById("mode");
const statusBox = document.getElementById("status");

function intervalLabel() { label.textContent = `${(Number(interval.value) / 1000).toLocaleString("vi-VN")} giây`; }
function renderSettings(value) {
  const settings = core.settings(value);
  enabled.checked = settings.enabled;
  images.checked = settings.reactToImages;
  images.disabled = settings.mode === "matched";
  interval.value = settings.intervalMs;
  mode.value = settings.mode;
  intervalLabel();
  document.getElementById("selectionCount").textContent = `${settings.replyStickers.length} mẫu trả lời · ${settings.triggerStickers.length} mẫu theo dõi`;
}
async function save() {
  const stored = await chrome.storage.local.get(KEY);
  const settings = core.settings({ ...stored[KEY], enabled: enabled.checked, reactToImages: images.checked, intervalMs: Number(interval.value), mode: mode.value });
  await chrome.storage.local.set({ [KEY]: settings });
  renderSettings(settings);
}
async function activeTab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}
async function refresh() {
  try {
    const tab = await activeTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "KUKU_STATUS" });
    statusBox.textContent = response.status.text;
    renderSettings(response.settings);
    document.getElementById("sent").textContent = response.status.sent;
    document.getElementById("available").textContent = response.status.available;
  } catch { statusBox.textContent = "Mở kuku.vn và F5 trang một lần sau khi cài extension."; }
}
document.getElementById("openPanel").addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await chrome.tabs.sendMessage(tab.id, { type: "KUKU_OPEN_PANEL" });
    window.close();
  } catch { statusBox.textContent = "Mở tab KuKu rồi bấm Chọn sticker ngay trên trang."; }
});
chrome.storage.local.get(KEY).then(result => { renderSettings(result[KEY]); void refresh(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[KEY]) renderSettings(changes[KEY].newValue); });
enabled.addEventListener("change", save);
images.addEventListener("change", save);
mode.addEventListener("change", save);
interval.addEventListener("input", intervalLabel);
interval.addEventListener("change", save);
setInterval(refresh, 1000);
