const workerUrlInput = document.getElementById("worker_url");

const bearerTokenInput = document.getElementById("bearer_token");

const keyInput = document.getElementById("key");

const modelSelect = document.getElementById("model");

const ttsEnabledInput = document.getElementById("tts_enabled");

const ttsVoiceSelect = document.getElementById("tts_voice");

const saveBtn = document.getElementById("save");

const status = document.getElementById("status");

(async () => {
    const stored = await chrome.storage.local.get([ "worker_url", "bearer_token", "anthropic_key", "model", "tts_enabled", "tts_voice_id" ]);
    if (stored.worker_url) workerUrlInput.value = stored.worker_url;
    if (stored.bearer_token) bearerTokenInput.value = stored.bearer_token;
    if (stored.anthropic_key) keyInput.value = stored.anthropic_key;
    if (stored.model) modelSelect.value = stored.model;
    ttsEnabledInput.checked = !!stored.tts_enabled;
    if (stored.tts_voice_id) ttsVoiceSelect.value = stored.tts_voice_id;
    if (stored.worker_url && stored.bearer_token) {
        status.textContent = "Worker mode configured.";
    } else if (stored.anthropic_key) {
        status.textContent = "Direct API mode configured.";
    }
})();

saveBtn.addEventListener("click", async () => {
    const workerUrl = workerUrlInput.value.trim().replace(/\/$/, "");
    const bearerToken = bearerTokenInput.value.trim();
    const key = keyInput.value.trim();
    const model = modelSelect.value;
    const ttsEnabled = !!ttsEnabledInput.checked;
    const ttsVoiceId = ttsVoiceSelect.value;
    const workerSet = workerUrl && bearerToken;
    const directSet = key.startsWith("sk-ant-");
    if (!workerSet && !directSet) {
        status.textContent = "Set either the Worker (URL + token) or an Anthropic API key.";
        status.className = "status error";
        return;
    }
    if (workerUrl && !/^https?:\/\//i.test(workerUrl)) {
        status.textContent = "Worker URL must start with https:// (or http:// for local dev).";
        status.className = "status error";
        return;
    }
    if (ttsEnabled && !workerSet) {
        status.textContent = "TTS requires the Worker — direct API mode cannot play voice.";
        status.className = "status error";
        return;
    }
    await chrome.storage.local.set({
        worker_url: workerUrl,
        bearer_token: bearerToken,
        anthropic_key: key,
        model: model,
        tts_enabled: ttsEnabled,
        tts_voice_id: ttsVoiceId
    });
    status.textContent = workerSet ? `Saved. Using Worker (${workerUrl}).` + (ttsEnabled ? " Voice ON." : "") : `Saved. Using direct Anthropic API.`;
    status.className = "status";
});