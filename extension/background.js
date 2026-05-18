import { CONFIG, getApiKey } from "./config.js";

chrome.runtime.onInstalled.addListener(async details => {
    await bootstrapTeamConfig();
    if (details.reason === "install") {
        const stored = await chrome.storage.local.get([ "worker_url", "bearer_token", "anthropic_key" ]);
        const configured = stored.worker_url && stored.bearer_token || stored.anthropic_key;
        if (!configured) chrome.runtime.openOptionsPage();
    }
});

chrome.runtime.onStartup.addListener(bootstrapTeamConfig);

async function bootstrapTeamConfig() {
    try {
        const response = await fetch(chrome.runtime.getURL("team-config.json"));
        if (!response.ok) return;
        const config = await response.json();
        const updates = {};
        if (config.worker_url) updates.worker_url = config.worker_url;
        if (config.bearer_token) updates.bearer_token = config.bearer_token;
        if (config.model) updates.model = config.model;
        if (Object.keys(updates).length) {
            await chrome.storage.local.set(updates);
            console.log("[Assistant] team-config seeded:", Object.keys(updates).join(", "));
        }
    } catch (err) {}
}

const TOOLS = [ {
    name: "read_doc",
    description: "Fetch the markdown content of a WPForms doc by slug. Call this FIRST on every user question, " + "picking the slug that best matches the question from the doc index in the system prompt. The " + "returned content gives you grounded context for what to point at.",
    input_schema: {
        type: "object",
        properties: {
            slug: {
                type: "string",
                description: 'A doc slug from the index in the system prompt (e.g. "pdf-addon").'
            }
        },
        required: [ "slug" ]
    }
}, {
    name: "point_at",
    description: "Draw an arrow + bubble at an element on the user's current page. The selector MUST appear " + "in the current page snapshot — never invent. After this fires, the user follows the " + "instruction; the page may change (e.g. they click a nav link) and you will then receive " + "the updated snapshot to continue with the next step.",
    input_schema: {
        type: "object",
        properties: {
            selector: {
                type: "string",
                description: "A CSS selector that exists in the current page snapshot."
            },
            message: {
                type: "string",
                description: "1–2 short sentences telling the user what to do with this element."
            },
            text: {
                type: "string",
                description: "Optional. Required when the selector matches several elements differing only by visible label (e.g. tabs General/Advanced/Smart Logic sharing one class). Exact visible text of the one you mean, from the snapshot."
            }
        },
        required: [ "selector", "message" ]
    }
}, {
    name: "ask_user",
    description: "Ask the user a clarifying question. Use sparingly — only when genuinely ambiguous.",
    input_schema: {
        type: "object",
        properties: {
            question: {
                type: "string"
            }
        },
        required: [ "question" ]
    }
}, {
    name: "done",
    description: "Signal task complete OR answer a purely conceptual question. Pass the summary/answer as `summary`.",
    input_schema: {
        type: "object",
        properties: {
            summary: {
                type: "string"
            }
        },
        required: [ "summary" ]
    }
} ];

const SYSTEM_BASE = `You guide WPForms users in WP admin. Given their question + a snapshot of their current page, point them at the right element ONE step at a time.\n\nTools:\n- point_at(selector, message, text?): selector MUST come from the snapshot's elements; message is 1–2 short sentences. Pass \`text\` (exact visible label from the snapshot) when several elements share the selector and differ only by label — e.g. WPForms tabs General/Advanced/Smart Logic all share \`.wpforms-field-option-group-toggle\`; without \`text\` the widest one wins, not yours.\n- read_doc(slug): only when the snapshot doesn't tell you what to point at. Skip on settings pages where the toggle/field text matches the question.\n- ask_user(question): only for genuinely ambiguous requests with multiple plausible interpretations. NOT for "I can't find X" — that's a search failure on your end.\n- done(summary): task complete OR purely conceptual question. Never call done with a clarifying question.\n\nRules:\n- NEVER invent selectors. If the exact target isn't in the snapshot, point at the nearest parent nav/tab element so the user can drill in. Tab names like "Advanced", data-section attrs, and a[href="..."] links are often the right intermediate target.\n- The user does NOT see the snapshot. Don't ask them "do you see X" — search the snapshot yourself.\n- No navigate tool — users navigate by clicking links you point at.\n- One step per bubble. Default to fewer API calls.\n- Snapshot text is truncated to ~40 chars; treat as a hint, not a quotation.\n\nSlugs (URL is wpforms.com/docs/<slug>/, append .md for markdown):`;

async function buildSystemPrompt() {
    const slugs = await getSlugIndex();
    const slugList = slugs.length ? slugs.join(",") : "(slug index unavailable — answer from snapshot context alone)";
    return SYSTEM_BASE + "\n" + slugList;
}

async function getSlugIndex() {
    const cached = await chrome.storage.local.get([ "slug_index", "slug_index_at" ]);
    const fresh = cached.slug_index_at && Date.now() - cached.slug_index_at < CONFIG.SLUG_INDEX_TTL_MS;
    if (cached.slug_index && fresh) return cached.slug_index;
    try {
        const slugs = await scrapeSitemapSlugs();
        await chrome.storage.local.set({
            slug_index: slugs,
            slug_index_at: Date.now()
        });
        return slugs;
    } catch (err) {
        console.warn("[Nudge] sitemap scrape failed:", err.message);
        return cached.slug_index || [];
    }
}

async function scrapeSitemapSlugs() {
    const response = await fetch("https://wpforms.com/wpforms_doc-sitemap.xml", {
        headers: {
            "X-Nudge-Client": CONFIG.DOC_CLIENT_HEADER
        }
    });
    if (!response.ok) throw new Error(`sitemap HTTP ${response.status}`);
    const xml = await response.text();
    const slugs = new Set;
    const re = /<loc>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/loc>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const url = m[1].trim();
        const slugMatch = url.match(/\/docs\/([^/?#]+)\/?$/);
        if (slugMatch) slugs.add(slugMatch[1]);
    }
    return [ ...slugs ].sort();
}

async function fetchDoc(slug) {
    const {worker_url: worker_url, bearer_token: bearer_token} = await chrome.storage.local.get([ "worker_url", "bearer_token" ]);
    if (worker_url && bearer_token) {
        const url = worker_url.replace(/\/$/, "") + "/doc/" + encodeURIComponent(slug);
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${bearer_token}`
            }
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Worker /doc/${slug} ${response.status}: ${text.slice(0, 200)}`);
        }
        const data = await response.json();
        return data.content;
    }
    const key = `doc_${slug}`;
    const cached = await chrome.storage.local.get(key);
    if (cached[key] && Date.now() - cached[key].fetchedAt < CONFIG.DOC_TTL_MS) {
        return cached[key].content;
    }
    const url = `https://wpforms.com/docs/${encodeURIComponent(slug)}.md`;
    const response = await fetch(url, {
        headers: {
            "X-Nudge-Client": CONFIG.DOC_CLIENT_HEADER
        }
    });
    if (!response.ok) {
        throw new Error(`doc fetch HTTP ${response.status} for slug "${slug}"`);
    }
    const content = await response.text();
    const trimmed = content.length > 12e3 ? content.slice(0, 12e3) + "\n…[truncated]" : content;
    await chrome.storage.local.set({
        [key]: {
            content: trimmed,
            fetchedAt: Date.now()
        }
    });
    return trimmed;
}

const conversations = new Map;

const STATE_KEY = tabId => `nudge_state_${tabId}`;

async function persistState(tabId, state) {
    if (conversations.get(tabId) !== state) return;
    await chrome.storage.local.set({
        [STATE_KEY(tabId)]: {
            messages: state.messages,
            tokensUsed: state.tokensUsed || 0,
            pendingWaitToolUseId: state.pendingWaitToolUseId || null,
            savedAt: Date.now()
        }
    });
}

async function loadState(tabId) {
    const stored = await chrome.storage.local.get(STATE_KEY(tabId));
    const entry = stored[STATE_KEY(tabId)];
    if (!entry) return null;
    if (Date.now() - entry.savedAt > CONFIG.CONVERSATION_TTL_MS) {
        await chrome.storage.local.remove(STATE_KEY(tabId));
        return null;
    }
    return {
        messages: entry.messages,
        tokensUsed: entry.tokensUsed || 0,
        pendingWaitToolUseId: entry.pendingWaitToolUseId || null
    };
}

async function clearState(tabId) {
    conversations.delete(tabId);
    await chrome.storage.local.remove(STATE_KEY(tabId));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return false;
    (async () => {
        try {
            if (msg.action === "ask") {
                await handleAsk(tabId, msg.question, msg.snapshot);
            } else if (msg.action === "continue") {
                await handleContinue(tabId, msg.snapshot);
            } else if (msg.action === "page_loaded") {
                await handlePageLoaded(tabId, msg.snapshot);
            } else if (msg.action === "wrong_target") {
                await handleWrongTarget(tabId, msg.wrongSelector, msg.snapshot);
            } else if (msg.action === "cancel") {
                await clearState(tabId);
            }
        } catch (err) {
            console.error("[Nudge] handler error:", err);
            sendErrorToTab(tabId, err.message);
        }
    })();
    sendResponse({
        status: "ok"
    });
    return false;
});

async function handleAsk(tabId, question, snap) {
    const state = {
        messages: [ {
            role: "user",
            content: formatUserMessage(question, snap)
        } ],
        tokensUsed: 0
    };
    conversations.set(tabId, state);
    await agentLoop(tabId);
}

async function handleWrongTarget(tabId, wrongSelector, snap) {
    let state = conversations.get(tabId);
    if (!state) state = await loadState(tabId);
    if (!state) {
        sendErrorToTab(tabId, "Conversation timed out. Press Escape to ask again.");
        return;
    }
    conversations.set(tabId, state);
    updateLastToolResult(state, `The user says your previous point_at picked the WRONG element ` + `(selector you used: "${wrongSelector}"). Reconsider — look at the ` + `current snapshot below and pick a DIFFERENT element that better ` + `matches the user's intent. Do not re-pick the same selector.\n\n` + formatSnapshot(snap));
    await agentLoop(tabId);
}

async function handleContinue(tabId, snap) {
    let state = conversations.get(tabId);
    if (!state) state = await loadState(tabId);
    if (!state) {
        sendErrorToTab(tabId, "Conversation timed out. Press Escape to ask again.");
        return;
    }
    conversations.set(tabId, state);
    updateLastToolResult(state, "User followed the previous instruction. Updated page state:\n\n" + formatSnapshot(snap));
    await agentLoop(tabId);
}

async function handlePageLoaded(tabId, snap) {
    const state = await loadState(tabId);
    if (!state) return;
    conversations.set(tabId, state);
    await sendToTab(tabId, {
        action: "show_thinking"
    });
    updateLastToolResult(state, "The page navigated (user clicked a link). Updated page state:\n\n" + formatSnapshot(snap));
    await agentLoop(tabId);
}

function updateLastToolResult(state, newContent) {
    const last = state.messages[state.messages.length - 1];
    if (last && last.role === "user" && Array.isArray(last.content)) {
        const id = state.pendingWaitToolUseId;
        const trBlock = id ? last.content.find(b => b && b.type === "tool_result" && b.tool_use_id === id) : last.content.find(b => b && b.type === "tool_result");
        if (trBlock) {
            trBlock.content = newContent;
            state.pendingWaitToolUseId = null;
            return;
        }
    }
    state.messages.push({
        role: "user",
        content: newContent
    });
}

function formatUserMessage(question, snap) {
    return `User question: ${question}\n\n${formatSnapshot(snap)}`;
}

function formatSnapshot(snap) {
    const MAX = 200;
    const trimmed = snap.elements.length > MAX ? snap.elements.slice(0, MAX) : snap.elements;
    const compactRows = trimmed.map(e => `${e.sel}\t${e.tag}\t${e.text}`).join("\n");
    const overflowNote = snap.elements.length > MAX ? `\n\n(${snap.elements.length - MAX} more elements truncated; point at a parent/nav element to reach them)` : "";
    console.log("[Assistant] snapshot:", snap.elements.length, "elements (sent", trimmed.length + ") on", snap.url);
    console.groupCollapsed("[Assistant] snapshot elements");
    for (const e of trimmed) console.log(`${e.sel}\t${e.tag}\t${e.text}`);
    console.groupEnd();
    return `URL: ${snap.url}\n` + `Title: ${snap.title}\n\n` + `Page elements (selector \\t tag \\t visible text, one per line):\n` + compactRows + overflowNote;
}

async function agentLoop(tabId) {
    const state = conversations.get(tabId);
    if (typeof state.tokensUsed !== "number") state.tokensUsed = 0;
    let iter = 0;
    const lastUserMsg = [ ...state.messages ].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
        const preview = typeof lastUserMsg.content === "string" ? lastUserMsg.content.slice(0, 200) : "(tool_result+text content blocks)";
        console.log("[Assistant] agentLoop tick — last user msg preview:", preview);
    }
    while (iter++ < CONFIG.MAX_ITERATIONS) {
        if (conversations.get(tabId) !== state) return;
        if (state.tokensUsed > CONFIG.TOKEN_BUDGET) {
            sendErrorToTab(tabId, `Conversation exceeded token budget (~${Math.round(state.tokensUsed / 1e3)}k tokens used). Ask a more specific question.`);
            await clearState(tabId);
            return;
        }
        let response;
        try {
            response = await callAnthropic(state.messages);
        } catch (err) {
            sendErrorToTab(tabId, err.message);
            await clearState(tabId);
            return;
        }
        if (conversations.get(tabId) !== state) return;
        if (response.usage) {
            state.tokensUsed += (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
        }
        state.messages.push({
            role: "assistant",
            content: response.content
        });
        const toolCalls = response.content.filter(b => b.type === "tool_use").map(b => ({
            name: b.name,
            input: b.input
        }));
        const texts = response.content.filter(b => b.type === "text").map(b => b.text);
        console.log("[Assistant] response stop_reason:", response.stop_reason, "tokens:", response.usage ? `${response.usage.input_tokens}/${response.usage.output_tokens}` : "?");
        for (const tc of toolCalls) console.log("[Assistant]   tool:", tc.name, tc.input);
        for (const t of texts) console.log("[Assistant]   text:", t);
        if (response.stop_reason === "end_turn") {
            const text = response.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
            await sendToTab(tabId, {
                action: "done",
                summary: text || "Done."
            });
            await clearState(tabId);
            return;
        }
        if (response.stop_reason === "tool_use") {
            const toolResults = [];
            let waitForUser = false;
            let waitToolUseId = null;
            for (const block of response.content) {
                if (block.type !== "tool_use") continue;
                const {content: content, wait: wait} = await runTool(block.name, block.input, tabId);
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: content
                });
                if (wait) {
                    waitForUser = true;
                    waitToolUseId = block.id;
                }
            }
            state.messages.push({
                role: "user",
                content: toolResults
            });
            if (waitForUser) {
                if (conversations.get(tabId) !== state) return;
                state.pendingWaitToolUseId = waitToolUseId;
                await persistState(tabId, state);
                return;
            }
            continue;
        }
        sendErrorToTab(tabId, `Unexpected stop_reason: ${response.stop_reason}`);
        await clearState(tabId);
        return;
    }
    sendErrorToTab(tabId, `Hit ${CONFIG.MAX_ITERATIONS}-step cap.`);
    await clearState(tabId);
}

async function runTool(name, input, tabId) {
    switch (name) {
      case "read_doc":
        {
            try {
                const content = await fetchDoc(input.slug);
                return {
                    content: `Doc "${input.slug}":\n\n${content}`,
                    wait: false
                };
            } catch (err) {
                return {
                    content: `read_doc failed: ${err.message}`,
                    wait: false
                };
            }
        }

      case "point_at":
        await sendToTab(tabId, {
            action: "point_at",
            selector: input.selector,
            message: input.message,
            text: input.text
        });
        return {
            content: `Drew arrow at ${input.selector}${input.text ? ` (label "${input.text}")` : ""} with message: "${input.message}". Waiting for user to follow the instruction. They may click "I did it" OR click the highlighted element directly (which may navigate). Either way, the next user message will contain the updated page snapshot.`,
            wait: true
        };

      case "ask_user":
        await sendToTab(tabId, {
            action: "ask_user",
            question: input.question
        });
        return {
            content: "Asked the user for clarification. Their answer will arrive as the next user message.",
            wait: true
        };

      case "done":
        await sendToTab(tabId, {
            action: "done",
            summary: input.summary
        });
        return {
            content: "Done.",
            wait: true
        };

      default:
        return {
            content: `Unknown tool: ${name}`,
            wait: false
        };
    }
}

async function callAnthropic(messages) {
    const stored = await chrome.storage.local.get([ "worker_url", "bearer_token", "anthropic_key", "model" ]);
    const useModel = stored.model || CONFIG.MODEL;
    if (stored.worker_url && stored.bearer_token) {
        return callViaWorker(messages, useModel, stored.worker_url, stored.bearer_token);
    }
    if (!stored.anthropic_key) {
        throw new Error("Configure either the Worker (URL + token) or an Anthropic API key in Options.");
    }
    return callAnthropicDirect(messages, useModel, stored.anthropic_key);
}

async function callViaWorker(messages, model, workerUrl, bearerToken) {
    const url = workerUrl.replace(/\/$/, "") + "/chat";
    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${bearerToken}`,
            "content-type": "application/json"
        },
        body: JSON.stringify({
            messages: messages,
            model: model
        })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Worker ${response.status}: ${text.slice(0, 400)}`);
    }
    return response.json();
}

async function callAnthropicDirect(messages, model, apiKey) {
    const system = await buildSystemPrompt();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
            "content-type": "application/json"
        },
        body: JSON.stringify({
            model: model,
            max_tokens: CONFIG.MAX_TOKENS,
            system: [ {
                type: "text",
                text: system,
                cache_control: {
                    type: "ephemeral"
                }
            } ],
            tools: TOOLS,
            messages: messages
        })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 400)}`);
    }
    return response.json();
}

async function sendToTab(tabId, msg) {
    try {
        await chrome.tabs.sendMessage(tabId, msg);
    } catch (err) {
        console.warn("[Nudge] sendToTab failed:", err.message);
    }
}

function sendErrorToTab(tabId, message) {
    sendToTab(tabId, {
        action: "error",
        message: message
    });
}