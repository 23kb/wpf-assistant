const ASSISTANT_VERSION = "2.12-text-disambig";

console.log(`[Assistant content] v${ASSISTANT_VERSION} loaded`);

const SULLIE_SVG_URL = chrome.runtime.getURL("assets/sullie.svg");

const ID_EXCLUDE_PREFIXES = [ "wp-admin-bar-", "wpadminbar", "wp-toolbar", "adminmenuback", "adminmenuwrap", "adminmenumain", "wpwrap", "wpbody", "wpcontent", "wpfooter", "a11y-speak-", "screen-meta", "contextual-help", "wp-link-", "link-selector", "link-options", "footer-upgrade", "footer-thankyou", "tab-panel-", "tab-link-", "user_ID", "user_login", "wp_http_referer", "closedpostboxesnonce", "_wpnonce", "_wp_http_referer", "_ajax_linking_nonce", "mceu_", "mce-", "mce_", "choices--", "choices-", "tinymce-", "tmce-" ];

const ID_EXCLUDE_EXACT = new Set([ "a", "b", "search-submit", "query-submit", "wp-fullscreen-body", "wp-fullscreen-title", "wp-fullscreen-tagline", "wpbody-content", "wpbody-content-container", "adminmenu" ]);

const CLASS_ROLE_PATTERNS = [ /-button$/, /-btn$/, /-tab$/, /-toggle(?:-control)?$/, /-option(?:s)?$/, /-input$/, /-link$/, /-select$/, /-dropdown$/, /-search$/, /-filter$/, /-active$/, /-open$/, /-close$/, /-dismiss$/, /-add$/, /-save$/, /-submit$/, /-cancel$/, /-delete$/, /-remove$/, /-edit$/, /-toggle$/, /-trigger$/ ];

const INTERACTIVE_TAGS = new Set([ "button", "a", "input", "textarea", "select", "li" ]);

const CLASS_COUNT_CAP = 50;

function isChromeId(id) {
    if (ID_EXCLUDE_EXACT.has(id)) return true;
    for (const p of ID_EXCLUDE_PREFIXES) if (id.startsWith(p)) return true;
    if (/-\d+-/.test(id)) return true;
    return false;
}

function classMatchesRolePattern(name) {
    for (const re of CLASS_ROLE_PATTERNS) if (re.test(name)) return true;
    return false;
}

function isVisible(el) {
    if (!(el instanceof Element)) return false;
    if (el.tagName === "HTML" || el.tagName === "BODY") return true;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.right < 0) return false;
    return true;
}

function visibleText(el) {
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return t.length > 40 ? t.slice(0, 39) + "…" : t;
}

function snapshot() {
    const url = location.href;
    const title = document.title;
    const elements = [];
    const activePanel = document.querySelector(".wpforms-panel.active");
    const allPanels = document.querySelectorAll(".wpforms-panel");
    const inactivePanels = activePanel ? [ ...allPanels ].filter(p => p !== activePanel) : [];
    const useScoping = activePanel && inactivePanels.length > 0;
    function isInInactivePanel(el) {
        if (!useScoping) return false;
        for (const p of inactivePanels) if (p.contains(el)) return true;
        return false;
    }
    const seenIds = new Set;
    const seenDataFieldIds = new Set;
    const seenDataFieldTypes = new Set;
    const seenDataPanels = new Set;
    const seenDataSections = new Set;
    const seenHrefs = new Set;
    const classData = new Map;
    const ourRoot = document.getElementById("nudge-root");
    const adminBar = document.getElementById("wpadminbar");
    for (const el of document.querySelectorAll("*")) {
        if (ourRoot && ourRoot.contains(el)) continue;
        if (adminBar && adminBar.contains(el)) continue;
        if (!isVisible(el)) continue;
        if (isInInactivePanel(el)) continue;
        const tag = el.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "meta" || tag === "link") continue;
        if (el.namespaceURI === "http://www.w3.org/2000/svg") continue;
        const elId = el.getAttribute("id");
        if (elId && !isChromeId(elId) && !seenIds.has(elId)) {
            seenIds.add(elId);
            elements.push({
                sel: `#${cssEscape(elId)}`,
                tag: tag,
                text: visibleText(el)
            });
        }
        if (el.getAttribute) {
            const dfId = el.getAttribute("data-field-id");
            if (dfId && !seenDataFieldIds.has(dfId)) {
                seenDataFieldIds.add(dfId);
                elements.push({
                    sel: `[data-field-id="${dfId}"]`,
                    tag: tag,
                    text: visibleText(el)
                });
            }
            const dfType = el.getAttribute("data-field-type");
            if (dfType && !seenDataFieldTypes.has(dfType)) {
                seenDataFieldTypes.add(dfType);
                elements.push({
                    sel: `[data-field-type="${dfType}"]`,
                    tag: tag,
                    text: visibleText(el)
                });
            }
            const dPanel = el.getAttribute("data-panel");
            if (dPanel && !seenDataPanels.has(dPanel)) {
                seenDataPanels.add(dPanel);
                elements.push({
                    sel: `[data-panel="${dPanel}"]`,
                    tag: tag,
                    text: visibleText(el)
                });
            }
            const dSection = el.getAttribute("data-section");
            if (dSection && !seenDataSections.has(dSection)) {
                seenDataSections.add(dSection);
                elements.push({
                    sel: `[data-section="${dSection}"]`,
                    tag: tag,
                    text: visibleText(el)
                });
            }
        }
        if (tag === "a" && el.hasAttribute("href")) {
            const rawHref = el.getAttribute("href");
            if (rawHref && !rawHref.startsWith("#") && !rawHref.startsWith("javascript:") && !rawHref.includes('"')) {
                let selector = null;
                let dedupeKey = null;
                try {
                    const url = new URL(rawHref, location.href);
                    if (url.origin === location.origin) {
                        const lastSegment = url.pathname.split("/").filter(Boolean).pop() || "";
                        const tail = lastSegment + url.search + url.hash;
                        if (tail) {
                            selector = `a[href$="${tail}"]`;
                            dedupeKey = url.pathname + url.search + url.hash;
                        }
                    } else {
                        selector = `a[href="${rawHref}"]`;
                        dedupeKey = rawHref;
                    }
                } catch (e) {}
                if (selector) {
                    const text = visibleText(el);
                    if (text && !seenHrefs.has(dedupeKey)) {
                        seenHrefs.add(dedupeKey);
                        elements.push({
                            sel: selector,
                            tag: tag,
                            text: text
                        });
                    }
                }
            }
        }
        if (el.getAttribute) {
            const aria = el.getAttribute("aria-label");
            const role = el.getAttribute("role");
            if ((role === "tab" || role === "menuitem" || role === "button") && aria) {
                const sel = `[role="${role}"][aria-label="${aria.replace(/"/g, "")}"]`;
                if (!elements.some(e => e.sel === sel)) {
                    elements.push({
                        sel: sel,
                        tag: tag,
                        text: visibleText(el)
                    });
                }
            }
        }
        if (typeof el.className === "string" && el.className) {
            for (const c of el.className.split(/\s+/)) {
                if (!c) continue;
                if (!c.startsWith("wpforms-") && c !== "choices" && !c.startsWith("choices__")) continue;
                const existing = classData.get(c);
                if (existing) {
                    existing.count++;
                } else {
                    classData.set(c, {
                        count: 1,
                        tag: tag,
                        text: visibleText(el)
                    });
                }
            }
        }
    }
    for (const [c, data] of classData.entries()) {
        if (data.count > CLASS_COUNT_CAP) continue;
        const matchesRole = classMatchesRolePattern(c);
        const interactiveWithText = INTERACTIVE_TAGS.has(data.tag) && data.text.length > 0;
        if (!matchesRole && !interactiveWithText) continue;
        elements.push({
            sel: `.${cssEscape(c)}`,
            tag: data.tag,
            text: data.text
        });
    }
    return {
        url: url,
        title: title,
        elements: elements
    };
}

function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

const NUDGE = {
    rootId: "nudge-root",
    highlightClass: "nudge-highlight",
    active: false,
    busy: false,
    bubble: null,
    arrow: null,
    actionLabel: null,
    cursor: null,
    cursorMode: "idle",
    highlightedEl: null,
    inputEl: null,
    lastSelector: null
};

let lastMouseX = window.innerWidth / 2;

let lastMouseY = window.innerHeight / 2;

document.addEventListener("mousemove", e => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
}, {
    passive: true
});

const CURSOR_TIP_X = 23;

const CURSOR_TIP_Y = 16;

const FOLLOW_OFFSET_X = 8;

const FOLLOW_OFFSET_Y = -10;

const FOLLOW_LERP = .22;

let cursorRenderX = null;

let cursorRenderY = null;

let followRafId = null;

let animateRafId = null;

function startFollowLoop() {
    if (followRafId !== null) return;
    if (cursorRenderX === null) {
        cursorRenderX = lastMouseX + FOLLOW_OFFSET_X + window.scrollX;
        cursorRenderY = lastMouseY + FOLLOW_OFFSET_Y + window.scrollY;
    }
    const step = () => {
        if (NUDGE.cursorMode !== "following" || !NUDGE.cursor) {
            followRafId = null;
            return;
        }
        const targetX = lastMouseX + FOLLOW_OFFSET_X + window.scrollX;
        const targetY = lastMouseY + FOLLOW_OFFSET_Y + window.scrollY;
        const dx = targetX - cursorRenderX;
        const dy = targetY - cursorRenderY;
        if (Math.abs(dx) < .3 && Math.abs(dy) < .3) {
            cursorRenderX = targetX;
            cursorRenderY = targetY;
        } else {
            cursorRenderX += dx * FOLLOW_LERP;
            cursorRenderY += dy * FOLLOW_LERP;
        }
        NUDGE.cursor.style.transition = "none";
        NUDGE.cursor.style.left = cursorRenderX + "px";
        NUDGE.cursor.style.top = cursorRenderY + "px";
        followRafId = requestAnimationFrame(step);
    };
    followRafId = requestAnimationFrame(step);
}

function stopFollowLoop() {
    if (followRafId !== null) {
        cancelAnimationFrame(followRafId);
        followRafId = null;
    }
}

function stopAnimateLoop() {
    if (animateRafId !== null) {
        cancelAnimationFrame(animateRafId);
        animateRafId = null;
    }
}

function safeSendMessage(msg) {
    try {
        chrome.runtime.sendMessage(msg);
    } catch (err) {
        const m = err && err.message ? err.message : String(err);
        if (m.includes("Extension context invalidated") || m.includes("message port closed")) {
            showError("Extension was reloaded. Refresh this page (Ctrl+R) to continue.");
        } else {
            console.warn("[Assistant] sendMessage failed:", err);
            showError("Failed to send message: " + m);
        }
    }
}

function ensureRoot() {
    let root = document.getElementById(NUDGE.rootId);
    if (!root) {
        root = document.createElement("div");
        root.id = NUDGE.rootId;
        document.body.appendChild(root);
    }
    return root;
}

function clearAll() {
    const root = document.getElementById(NUDGE.rootId);
    if (root) root.innerHTML = "";
    document.querySelectorAll("." + NUDGE.highlightClass).forEach(el => el.classList.remove(NUDGE.highlightClass));
    NUDGE.active = false;
    NUDGE.busy = false;
    NUDGE.bubble = null;
    NUDGE.arrow = null;
    NUDGE.actionLabel = null;
    NUDGE.highlightedEl = null;
    NUDGE.inputEl = null;
    stopSpeak();
    stopThinkingRotation();
}

function stopSpeak() {
    if (_ttsCurrentAudio) {
        try {
            _ttsCurrentAudio.pause();
        } catch (e) {}
        _ttsCurrentAudio = null;
    }
}

function clearAllAndCancel() {
    clearAll();
    removeCursor();
    try {
        chrome.runtime.sendMessage({
            action: "cancel"
        });
    } catch (e) {}
}

function ensureCursor() {
    if (NUDGE.cursor && document.body.contains(NUDGE.cursor)) return NUDGE.cursor;
    const cursor = document.createElement("div");
    cursor.className = "nudge-cursor";
    cursor.innerHTML = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="32" height="32">\n    <defs>\n      <radialGradient id="ng-glow" cx="0.5" cy="0.5" r="0.55">\n        <stop offset="0%" stop-color="rgba(96, 165, 250, 0.55)"/>\n        <stop offset="55%" stop-color="rgba(96, 165, 250, 0.18)"/>\n        <stop offset="100%" stop-color="rgba(96, 165, 250, 0)"/>\n      </radialGradient>\n      <linearGradient id="ng-tri" x1="0.2" y1="0.1" x2="0.7" y2="0.9">\n        <stop offset="0%" stop-color="#7dd3fc"/>\n        <stop offset="55%" stop-color="#3b82f6"/>\n        <stop offset="100%" stop-color="#1d4ed8"/>\n      </linearGradient>\n    </defs>\n    \x3c!-- Soft halo behind the triangle --\x3e\n    <circle cx="16" cy="16" r="15" fill="url(#ng-glow)"/>\n    \x3c!-- Right-pointing triangle. Tip at (23, 16). --\x3e\n    <path d="M 11 8 L 23 16 L 11 24 Z"\n          fill="url(#ng-tri)"\n          stroke="rgba(255,255,255,0.95)"\n          stroke-width="1.2"\n          stroke-linejoin="round"\n          stroke-linecap="round"/>\n  </svg>`;
    cursor.style.left = lastMouseX + FOLLOW_OFFSET_X + window.scrollX + "px";
    cursor.style.top = lastMouseY + FOLLOW_OFFSET_Y + window.scrollY + "px";
    document.body.appendChild(cursor);
    NUDGE.cursor = cursor;
    return cursor;
}

function removeCursor() {
    stopFollowLoop();
    stopAnimateLoop();
    if (NUDGE.cursor) {
        NUDGE.cursor.remove();
        NUDGE.cursor = null;
    }
    NUDGE.cursorMode = "idle";
    cursorRenderX = null;
    cursorRenderY = null;
}

function animateCursorTo(target, onArrive) {
    ensureCursor();
    NUDGE.cursorMode = "animating";
    stopFollowLoop();
    stopAnimateLoop();
    const cursor = NUDGE.cursor;
    const rect = target.getBoundingClientRect();
    const tipX = rect.left + window.scrollX + rect.width / 2;
    const tipY = rect.top + window.scrollY + rect.height / 2;
    const endX = tipX - CURSOR_TIP_X;
    const endY = tipY - CURSOR_TIP_Y;
    const startX = cursorRenderX !== null ? cursorRenderX : parseFloat(cursor.style.left) || window.scrollX + window.innerWidth / 2;
    const startY = cursorRenderY !== null ? cursorRenderY : parseFloat(cursor.style.top) || window.scrollY + window.innerHeight / 2;
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.hypot(dx, dy);
    const durationMs = Math.min(Math.max(distance * 1, 500), 900);
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const arcHeight = Math.min(distance * .2, 80);
    const len = distance || 1;
    const perpX = -dy / len;
    const perpY = dx / len;
    const arcSign = perpY > 0 ? -1 : 1;
    const cpX = midX + perpX * arcHeight * arcSign;
    const cpY = midY + perpY * arcHeight * arcSign;
    const startTime = performance.now();
    const step = now => {
        const elapsed = now - startTime;
        const linearT = Math.min(elapsed / durationMs, 1);
        const t = linearT * linearT * (3 - 2 * linearT);
        const oneMinusT = 1 - t;
        const x = oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * cpX + t * t * endX;
        const y = oneMinusT * oneMinusT * startY + 2 * oneMinusT * t * cpY + t * t * endY;
        const scalePulse = Math.sin(linearT * Math.PI);
        cursor.style.transition = "none";
        cursor.style.left = x + "px";
        cursor.style.top = y + "px";
        cursor.style.transform = `scale(${1 + scalePulse * .25})`;
        cursorRenderX = x;
        cursorRenderY = y;
        if (linearT < 1) {
            animateRafId = requestAnimationFrame(step);
            return;
        }
        animateRafId = null;
        cursor.style.transform = "scale(1)";
        cursorRenderX = endX;
        cursorRenderY = endY;
        NUDGE.cursorMode = "on_target";
        cursor.classList.add("nudge-cursor-arrived");
        setTimeout(() => cursor.classList.remove("nudge-cursor-arrived"), 380);
        if (onArrive) onArrive();
    };
    animateRafId = requestAnimationFrame(step);
}

function showInputBox(hint = "") {
    clearAll();
    NUDGE.active = true;
    ensureCursor();
    NUDGE.cursorMode = "following";
    cursorRenderX = lastMouseX + FOLLOW_OFFSET_X + window.scrollX;
    cursorRenderY = lastMouseY + FOLLOW_OFFSET_Y + window.scrollY;
    NUDGE.cursor.style.left = cursorRenderX + "px";
    NUDGE.cursor.style.top = cursorRenderY + "px";
    startFollowLoop();
    const root = ensureRoot();
    const box = document.createElement("div");
    box.className = "nudge-input-box";
    if (hint) {
        const hintEl = document.createElement("div");
        hintEl.className = "nudge-hint";
        hintEl.textContent = hint;
        box.appendChild(hintEl);
    }
    const row = document.createElement("div");
    row.className = "nudge-input-row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = hint ? "Type your answer…" : "Ask a question about WPForms…";
    input.className = "nudge-input";
    row.appendChild(input);
    const mic = document.createElement("button");
    mic.className = "nudge-mic";
    mic.title = "Click to speak";
    mic.setAttribute("aria-label", "Voice input");
    mic.textContent = "🎤";
    row.appendChild(mic);
    box.appendChild(row);
    root.appendChild(box);
    NUDGE.inputEl = input;
    setTimeout(() => input.focus(), 0);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        mic.style.display = "none";
    } else {
        let recognition = null;
        let recording = false;
        mic.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            if (recording && recognition) {
                recognition.stop();
                return;
            }
            try {
                recognition = new SR;
            } catch (err) {
                console.warn("[Nudge] SpeechRecognition init failed:", err);
                return;
            }
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = navigator.language || "en-US";
            recognition.onresult = event => {
                let finalText = "";
                let interimText = "";
                for (let i = 0; i < event.results.length; i++) {
                    const r = event.results[i];
                    if (r.isFinal) finalText += r[0].transcript; else interimText += r[0].transcript;
                }
                input.value = (finalText + interimText).trimStart();
            };
            recognition.onerror = ev => {
                console.warn("[Assistant] speech error:", ev.error);
                recording = false;
                mic.classList.remove("nudge-mic-recording");
            };
            recognition.onend = () => {
                recording = false;
                mic.classList.remove("nudge-mic-recording");
                const value = input.value.trim();
                if (value) submitQuestion(value);
            };
            try {
                recognition.start();
                recording = true;
                mic.classList.add("nudge-mic-recording");
            } catch (err) {
                console.warn("[Nudge] recognition.start failed:", err);
            }
        });
    }
    input.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") {
            e.preventDefault();
            const value = input.value.trim();
            if (!value) return;
            submitQuestion(value);
        } else if (e.key === "Escape") {
            e.preventDefault();
            clearAllAndCancel();
        }
    });
}

const THINKING_PHASES = [ "Thinking…", "Reading docs…", "Looking at the page…", "Finding the right spot…", "Almost there…" ];

let thinkingRotationId = null;

function showThinking() {
    clearAll();
    NUDGE.active = true;
    NUDGE.busy = true;
    const root = ensureRoot();
    const t = document.createElement("div");
    t.className = "nudge-thinking";
    t.innerHTML = `\n    <span class="nudge-thinking-brand" aria-hidden="true">\n      <img src="${SULLIE_SVG_URL}" alt="Sullie" class="nudge-sullie">\n    </span>\n    <span class="nudge-thinking-sep"></span>\n    <span class="nudge-thinking-spinner" aria-hidden="true"></span>\n    <span class="nudge-thinking-text">${THINKING_PHASES[0]}</span>\n    <button class="nudge-btn-stop" aria-label="Stop">Stop</button>\n  `;
    t.querySelector(".nudge-btn-stop").addEventListener("click", clearAllAndCancel);
    root.appendChild(t);
    const textEl = t.querySelector(".nudge-thinking-text");
    let idx = 0;
    stopThinkingRotation();
    thinkingRotationId = setInterval(() => {
        idx = (idx + 1) % THINKING_PHASES.length;
        textEl.style.transition = "opacity 180ms ease-out";
        textEl.style.opacity = "0";
        setTimeout(() => {
            textEl.textContent = THINKING_PHASES[idx];
            textEl.style.opacity = "1";
        }, 200);
    }, 1700);
}

function stopThinkingRotation() {
    if (thinkingRotationId !== null) {
        clearInterval(thinkingRotationId);
        thinkingRotationId = null;
    }
}

function showBubble(target, message) {
    removeBubbleOnly();
    NUDGE.active = true;
    NUDGE.busy = false;
    speak(message);
    const root = ensureRoot();
    target.classList.add(NUDGE.highlightClass);
    const bubble = document.createElement("div");
    bubble.className = "nudge-bubble";
    bubble.innerHTML = `\n    <button class="nudge-btn-close" aria-label="Close" title="Close">\n      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>\n    </button>\n    <button class="nudge-btn-refresh" aria-label="Try again" title="Wasn't right? Try a different element">\n      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8a6 6 0 1 1-1.76-4.24"/><path d="M14 2v3.5h-3.5"/></svg>\n    </button>\n    <div class="nudge-bubble-msg"></div>\n    <div class="nudge-bubble-actions">\n      <button class="nudge-btn nudge-btn-next">done</button>\n    </div>\n  `;
    bubble.querySelector(".nudge-bubble-msg").innerHTML = renderBubbleText(message);
    root.appendChild(bubble);
    positionBubble(bubble, target.getBoundingClientRect());
    const arrow = drawArrow(target.getBoundingClientRect(), bubble.getBoundingClientRect());
    root.appendChild(arrow);
    showActionLabel(target);
    NUDGE.bubble = bubble;
    NUDGE.arrow = arrow;
    NUDGE.highlightedEl = target;
    bubble.querySelector(".nudge-btn-next").addEventListener("click", onUserDidStep);
    bubble.querySelector(".nudge-btn-refresh").addEventListener("click", onUserSaysWrong);
    bubble.querySelector(".nudge-btn-close").addEventListener("click", clearAllAndCancel);
    if (!isNavigationLink(target)) {
        const onTargetClick = () => {
            target.removeEventListener("click", onTargetClick, true);
            setTimeout(() => {
                if (NUDGE.bubble === bubble) onUserDidStep();
            }, 250);
        };
        target.addEventListener("click", onTargetClick, true);
        NUDGE._targetClickListener = {
            target: target,
            fn: onTargetClick
        };
    }
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}

function mdInline(t) {
    return t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function renderBubbleText(text) {
    return mdInline(escapeHtml(text));
}

function renderMarkdown(text) {
    let s = escapeHtml(text).replace(/\s+(\d+)\.\s+(?=[A-Z(*‘“])/g, "\n$1. ").replace(/\s+[-•]\s+(?=[A-Z(*‘“])/g, "\n- ").replace(/\s+&gt;\s+(?=\*|[A-Z])/g, "\n&gt; ");
    const lines = s.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const out = [];
    let list = null;
    const closeList = () => {
        if (list) {
            out.push(`</${list}>`);
            list = null;
        }
    };
    for (const line of lines) {
        const ol = line.match(/^(\d+)\.\s+(.*)$/);
        const ul = line.match(/^[-•*]\s+(.*)$/);
        const note = line.match(/^&gt;\s*(.*)$/);
        if (ol) {
            if (list !== "ol") {
                closeList();
                out.push("<ol>");
                list = "ol";
            }
            out.push(`<li>${mdInline(ol[2])}</li>`);
        } else if (ul) {
            if (list !== "ul") {
                closeList();
                out.push("<ul>");
                list = "ul";
            }
            out.push(`<li>${mdInline(ul[1])}</li>`);
        } else if (note) {
            closeList();
            out.push(`<p class="nudge-note">${mdInline(note[1])}</p>`);
        } else {
            closeList();
            out.push(`<p>${mdInline(line)}</p>`);
        }
    }
    closeList();
    return out.join("");
}

function actionLabelFor(el) {
    if (!el) return "Click this";
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.getAttribute && (el.getAttribute("type") || "")).toLowerCase();
    const role = (el.getAttribute && (el.getAttribute("role") || "")).toLowerCase();
    const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
    if (type === "checkbox" || type === "radio" || role === "switch" || /toggle|switch/.test(cls)) {
        return "Toggle this";
    }
    if (tag === "textarea" || el.isContentEditable || tag === "input" && [ "text", "email", "url", "search", "tel", "number", "password", "" ].includes(type)) {
        return "Type here";
    }
    if (tag === "select" || /\bchoices\b/.test(cls)) {
        return "Select this";
    }
    return "Click this";
}

function showActionLabel(target) {
    const root = ensureRoot();
    const label = document.createElement("div");
    label.className = "nudge-action-label";
    label.textContent = actionLabelFor(target);
    root.appendChild(label);
    const rect = target.getBoundingClientRect();
    const lw = label.offsetWidth;
    const lh = label.offsetHeight;
    const gap = 10;
    let left = rect.left + rect.width / 2 - lw / 2;
    let top = rect.top - lh - gap;
    if (top < 8) top = rect.bottom + gap;
    left = Math.max(8, Math.min(left, window.innerWidth - lw - 8));
    label.style.left = left + window.scrollX + "px";
    label.style.top = top + window.scrollY + "px";
    NUDGE.actionLabel = label;
}

function isNavigationLink(el) {
    if (!el || el.tagName !== "A") return false;
    const href = el.getAttribute("href");
    return !!(href && !href.startsWith("#") && !href.startsWith("javascript:"));
}

function removeBubbleOnly() {
    if (NUDGE.bubble) NUDGE.bubble.remove();
    if (NUDGE.arrow) NUDGE.arrow.remove();
    if (NUDGE.actionLabel) NUDGE.actionLabel.remove();
    if (NUDGE.highlightedEl) NUDGE.highlightedEl.classList.remove(NUDGE.highlightClass);
    if (NUDGE._targetClickListener) {
        const {target: target, fn: fn} = NUDGE._targetClickListener;
        try {
            target.removeEventListener("click", fn, true);
        } catch (e) {}
        NUDGE._targetClickListener = null;
    }
    NUDGE.bubble = null;
    NUDGE.arrow = null;
    NUDGE.actionLabel = null;
    NUDGE.highlightedEl = null;
}

function positionBubble(bubble, targetRect) {
    const margin = 24;
    const bw = 300;
    const bh = bubble.offsetHeight || 120;
    let left = targetRect.right + margin;
    let top = targetRect.top + targetRect.height / 2 - bh / 2;
    if (left + bw > window.innerWidth - 8) {
        left = targetRect.left;
        top = targetRect.bottom + margin;
    }
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    bubble.style.left = left + window.scrollX + "px";
    bubble.style.top = top + window.scrollY + "px";
}

function drawArrow(targetRect, bubbleRect) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.position = "absolute";
    svg.style.left = "0";
    svg.style.top = "0";
    svg.style.width = document.documentElement.scrollWidth + "px";
    svg.style.height = document.documentElement.scrollHeight + "px";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "2147483646";
    const bcx = bubbleRect.left + bubbleRect.width / 2 + window.scrollX;
    const bcy = bubbleRect.top + bubbleRect.height / 2 + window.scrollY;
    const tcx = targetRect.left + targetRect.width / 2 + window.scrollX;
    const tcy = targetRect.top + targetRect.height / 2 + window.scrollY;
    const sx = Math.max(bubbleRect.left + window.scrollX, Math.min(tcx, bubbleRect.right + window.scrollX));
    const sy = Math.max(bubbleRect.top + window.scrollY, Math.min(tcy, bubbleRect.bottom + window.scrollY));
    const tx = Math.max(targetRect.left + window.scrollX, Math.min(bcx, targetRect.right + window.scrollX));
    const ty = Math.max(targetRect.top + window.scrollY, Math.min(bcy, targetRect.bottom + window.scrollY));
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const curveDepth = Math.min(40, len * .18);
    const cpX = (sx + tx) / 2 + -dy / len * curveDepth;
    const cpY = (sy + ty) / 2 + dx / len * curveDepth;
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "nudge-arrowhead");
    marker.setAttribute("markerWidth", "12");
    marker.setAttribute("markerHeight", "12");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "6");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    arrowPath.setAttribute("points", "0 0, 12 6, 0 12, 3 6");
    arrowPath.setAttribute("fill", "#2563eb");
    arrowPath.setAttribute("stroke", "white");
    arrowPath.setAttribute("stroke-width", "0.8");
    arrowPath.setAttribute("stroke-linejoin", "round");
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);
    const halo = document.createElementNS("http://www.w3.org/2000/svg", "path");
    halo.setAttribute("d", `M ${sx} ${sy} Q ${cpX} ${cpY} ${tx} ${ty}`);
    halo.setAttribute("stroke", "rgba(255,255,255,0.85)");
    halo.setAttribute("stroke-width", "6");
    halo.setAttribute("stroke-linecap", "round");
    halo.setAttribute("fill", "none");
    svg.appendChild(halo);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${sx} ${sy} Q ${cpX} ${cpY} ${tx} ${ty}`);
    path.setAttribute("stroke", "#2563eb");
    path.setAttribute("stroke-width", "3");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("fill", "none");
    path.setAttribute("marker-end", "url(#nudge-arrowhead)");
    svg.appendChild(path);
    return svg;
}

function showSummary(message) {
    clearAll();
    removeCursor();
    speak(message);
    const root = ensureRoot();
    const s = document.createElement("div");
    s.className = "nudge-summary";
    s.innerHTML = `\n    <div class="nudge-summary-msg"></div>\n    <button class="nudge-btn-close" aria-label="Close">×</button>\n  `;
    s.querySelector(".nudge-summary-msg").innerHTML = renderMarkdown(message);
    root.appendChild(s);
    s.querySelector(".nudge-btn-close").addEventListener("click", clearAll);
    const dwellMs = Math.min(8e3 + message.length * 35, 45e3);
    setTimeout(() => {
        if (document.querySelector(".nudge-summary")) clearAll();
    }, dwellMs);
}

function showError(message) {
    clearAll();
    removeCursor();
    const root = ensureRoot();
    const e = document.createElement("div");
    e.className = "nudge-error";
    e.innerHTML = `\n    <div class="nudge-error-msg"></div>\n    <button class="nudge-btn-close" aria-label="Close">×</button>\n  `;
    e.querySelector(".nudge-error-msg").textContent = message;
    root.appendChild(e);
    e.querySelector(".nudge-btn-close").addEventListener("click", clearAll);
}

function isWpformsPage() {
    return /[?&]page=wpforms/.test(location.search);
}

let _ttsCurrentAudio = null;

async function speak(text) {
    try {
        const cfg = await chrome.storage.local.get([ "tts_enabled", "worker_url", "bearer_token", "tts_voice_id" ]);
        if (!cfg.tts_enabled || !cfg.worker_url || !cfg.bearer_token || !text) return;
        if (_ttsCurrentAudio) {
            try {
                _ttsCurrentAudio.pause();
            } catch (e) {}
            _ttsCurrentAudio = null;
        }
        const response = await fetch(cfg.worker_url.replace(/\/$/, "") + "/tts", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${cfg.bearer_token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                text: text,
                voice_id: cfg.tts_voice_id || undefined
            })
        });
        if (!response.ok) {
            console.warn("[Assistant] TTS failed:", response.status);
            return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        _ttsCurrentAudio = audio;
        audio.addEventListener("ended", () => {
            URL.revokeObjectURL(url);
            if (_ttsCurrentAudio === audio) _ttsCurrentAudio = null;
        });
        audio.addEventListener("error", () => {
            URL.revokeObjectURL(url);
            if (_ttsCurrentAudio === audio) _ttsCurrentAudio = null;
        });
        await audio.play();
    } catch (err) {
        console.warn("[Assistant] TTS error:", err);
    }
}

function submitQuestion(question) {
    showThinking();
    safeSendMessage({
        action: "ask",
        question: question,
        snapshot: snapshot()
    });
}

function onUserDidStep() {
    showThinking();
    safeSendMessage({
        action: "continue",
        snapshot: snapshot()
    });
}

function handlePointAt(selector, message, wantText) {
    let target;
    try {
        target = pickBestMatch(selector, wantText);
    } catch (e) {
        showError(`Invalid selector "${selector}": ${e.message}`);
        return;
    }
    if (!target) {
        const label = wantText ? ` (labeled "${wantText}")` : "";
        showError(`Couldn't find "${selector}"${label} on this page. Try rephrasing the question.`);
        return;
    }
    NUDGE.lastSelector = selector;
    target.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
    setTimeout(() => {
        animateCursorTo(target, () => showBubble(target, message));
    }, 350);
}

function pickBestMatch(selector, wantText) {
    let candidates = Array.from(document.querySelectorAll(selector));
    console.log(`[Assistant content] pickBestMatch("${selector}"${wantText ? `, text=${JSON.stringify(wantText)}` : ""}) → ${candidates.length} candidate(s)`);
    if (!candidates.length) return null;
    if (wantText) {
        const norm = s => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const want = norm(wantText);
        const exact = candidates.filter(el => norm(el.textContent) === want);
        const matched = exact.length ? exact : candidates.filter(el => {
            const t = norm(el.textContent);
            return t && (t.includes(want) || want.includes(t));
        });
        console.log(`[Assistant content]   text filter "${wantText}" → ${matched.length}/${candidates.length} (${exact.length ? "exact" : "fuzzy"})`);
        if (!matched.length) {
            console.warn("[Assistant content] pickBestMatch: text given but no element text matched — returning null");
            return null;
        }
        candidates = matched;
    }
    const adminBar = document.getElementById("wpadminbar");
    let best = null;
    let bestArea = -1;
    for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        const inAdminBar = !!(adminBar && adminBar.contains(el));
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const reasons = [];
        if (inAdminBar) reasons.push("in #wpadminbar");
        if (rect.width <= 0 || rect.height <= 0) reasons.push("zero-size");
        if (rect.right < 0) reasons.push("off-screen left");
        if (style.display === "none") reasons.push("display:none");
        if (style.visibility === "hidden") reasons.push("visibility:hidden");
        if (reasons.length) {
            console.log(`[Assistant content]   [${i}] SKIPPED (${reasons.join(", ")}):`, el);
            continue;
        }
        const area = rect.width * rect.height;
        console.log(`[Assistant content]   [${i}] candidate, area=${Math.round(area)}, rect=${JSON.stringify({
            l: Math.round(rect.left),
            t: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
        })}:`, el);
        if (area > bestArea) {
            bestArea = area;
            best = el;
        }
    }
    if (best) {
        const swapped = trySwapRowForInner(best);
        if (swapped && swapped !== best) {
            console.log("[Assistant content] swapped row wrapper for inner element:", swapped);
            best = swapped;
        }
        console.log("[Assistant content] pickBestMatch chose:", best);
    } else {
        console.warn("[Assistant content] pickBestMatch: no visible candidate — returning null");
    }
    return best;
}

function trySwapRowForInner(el) {
    if (!el || el.tagName !== "DIV") return null;
    const id = el.id || "";
    const isRow = /-row-/.test(id) || el.classList.contains("wpforms-setting-row");
    if (!isRow) return null;
    const selectors = [ "label.wpforms-toggle-control", ".wpforms-toggle-control", "button", "select", 'input:not([type="hidden"]):not([type="checkbox"])', "label", '[role="button"]', '[role="checkbox"]', "textarea" ];
    for (const sel of selectors) {
        const matches = el.querySelectorAll(sel);
        for (const m of matches) {
            const rect = m.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const style = getComputedStyle(m);
            if (style.display === "none" || style.visibility === "hidden") continue;
            return m;
        }
    }
    return null;
}

function onUserSaysWrong() {
    const wrongSelector = NUDGE.lastSelector || "";
    showThinking();
    safeSendMessage({
        action: "wrong_target",
        wrongSelector: wrongSelector,
        snapshot: snapshot()
    });
}

document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!isWpformsPage()) return;
    if (NUDGE.active) {
        e.preventDefault();
        e.stopPropagation();
        clearAllAndCancel();
    } else {
        e.preventDefault();
        e.stopPropagation();
        showInputBox();
    }
}, true);

chrome.runtime.onMessage.addListener(msg => {
    switch (msg.action) {
      case "point_at":
        handlePointAt(msg.selector, msg.message, msg.text);
        break;

      case "ask_user":
        showInputBox(msg.question);
        break;

      case "done":
        showSummary(msg.summary);
        break;

      case "error":
        showError(msg.message);
        break;

      case "show_thinking":
        showThinking();
        break;
    }
});

if (isWpformsPage()) {
    setTimeout(() => {
        try {
            chrome.runtime.sendMessage({
                action: "page_loaded",
                snapshot: snapshot()
            });
        } catch (e) {}
    }, 120);
}