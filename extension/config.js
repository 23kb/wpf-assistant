export const CONFIG = {
    MODEL: "claude-sonnet-4-6",
    MAX_TOKENS: 2048,
    MAX_ITERATIONS: 12,
    DOC_CLIENT_HEADER: "WPForms-Assistant/0.1",
    SLUG_INDEX_TTL_MS: 7 * 24 * 3600 * 1e3,
    DOC_TTL_MS: 30 * 24 * 3600 * 1e3,
    CONVERSATION_TTL_MS: 10 * 60 * 1e3,
    TOKEN_BUDGET: 8e4
};

export async function getApiKey() {
    const {anthropic_key: anthropic_key} = await chrome.storage.local.get("anthropic_key");
    return anthropic_key || null;
}