// ==UserScript==
// @name         Epal Gift Tracker - Detailed Logs Edition
// @namespace    http://tampermonkey.net/
// @version      3.1.0
// @description  Cloud Sync + Detailed Console Logs + Medals
// @author       Fab
// @match        https://www.epal.gg/chill/chatroom/*
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const JSON_URL = "https://raw.githubusercontent.com/OfficialEPal/epalgifttracker/main/prices.json";
    const customIcon = "https://raw.githubusercontent.com/OfficialEPal/epalgifttracker/main/buff.png";
    const GIFT_MESSAGE_SELECTOR = '.epal-live-chat.text-positive-variant-normal';
    const MESSAGE_CONTAINER_SELECTOR = '.hover\\:bg-surface-element-normal';
    const DONOR_SELECTOR = '.epal-name-gold, .epal-name-vip, .text-primary-variant-normal';
    const RECENT_SIGNATURE_TTL_MS = 1500;

    const style = document.createElement('style');
    style.textContent = `
        #epal-tracker-pro button { transition: all 0.2s ease; cursor: pointer; border: none; outline: none; }
        #epal-tracker-pro button:hover { filter: brightness(1.2); transform: translateY(-1px); }
        #epal-tracker-pro button:active { transform: translateY(1px) scale(0.96); }
        #btn-sync:hover { transform: rotate(90deg); }
        .gift-row { animation: fadeIn 0.3s ease-out; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
        @keyframes fadeIn { from { opacity: 0; transform: translateX(-5px); } to { opacity: 1; transform: translateX(0); } }
    `;
    document.head.appendChild(style);

    let giftPrices = { "Rose": 1, "Default": 0 };
    let totalValue = 0, isRunning = false, donors = {};
    let timerInterval = null, timeLeft = 0;
    const processedGiftNodes = new WeakSet();
    const recentMessageSignatures = new Map();

    const normalizeText = (value) => value.replace(/\s+/g, ' ').trim();
    const normalizeName = (value) => normalizeText(value).toLowerCase();
    const cleanupRecentMessageSignatures = () => {
        const cutoff = Date.now() - RECENT_SIGNATURE_TTL_MS;
        for (const [signature, ts] of recentMessageSignatures.entries()) {
            if (ts < cutoff) recentMessageSignatures.delete(signature);
        }
    };
    const updateTimerDisplay = () => {
        document.getElementById('display-timer').innerText = `${Math.floor(timeLeft / 60).toString().padStart(2, '0')}:${(timeLeft % 60).toString().padStart(2, '0')}`;
    };
    const setStatusIndicator = (text, color) => {
        const indicator = document.getElementById('status-indicator');
        if (indicator) {
            indicator.innerText = text;
            indicator.style.color = color;
        }
    };
    const setRunningState = (running) => {
        isRunning = running;
        const btnStart = document.getElementById('btn-start');
        btnStart.innerText = running ? "STOP" : "START";
        btnStart.style.background = running ? "#f44336" : "#4CAF50";
        setStatusIndicator(running ? "LIVE" : "OFF", running ? "#4CAF50" : "#ff4d4d");
        if (!running && timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    };
    const appendParagraphs = (container, lines) => {
        container.replaceChildren();
        lines.forEach((line) => {
            const paragraph = document.createElement('p');
            paragraph.textContent = line;
            container.appendChild(paragraph);
        });
    };
    const findGiftName = (fullText) => {
        const normalized = fullText.toLowerCase();
        return Object.keys(giftPrices)
            .sort((a, b) => b.length - a.length)
            .find((giftName) => normalized.includes(giftName.toLowerCase())) || null;
    };
    const extractRecipientName = (fullText, giftName) => {
        if (!giftName) return null;
        const escapedGiftName = giftName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        const match = fullText.match(new RegExp(`gifted\\s+(.+?)\\s+(?:an?\\s+)?${escapedGiftName}(?:\\s+x\\d+)?\\s*$`, 'i'));
        return match ? normalizeText(match[1]) : null;
    };
    const buildMessageSignature = (donorName, recipientName, giftName, quantity, fullText) => (
        `${normalizeName(donorName)}|${normalizeName(recipientName || '')}|${normalizeName(giftName || '')}|${quantity}|${normalizeText(fullText)}`
    );

    async function syncPrices() {
        try {
            const response = await fetch(JSON_URL);
            if (!response.ok) throw new Error("Sync failed");
            const remotePrices = await response.json();
            if (!remotePrices || typeof remotePrices !== 'object' || Array.isArray(remotePrices)) {
                throw new Error("Invalid prices format");
            }
            giftPrices = Object.fromEntries(
                Object.entries(remotePrices)
                    .filter(([key, value]) => typeof key === 'string' && Number.isFinite(Number(value)))
                    .map(([key, value]) => [key, Number(value)])
            );
            if (Object.keys(giftPrices).length === 0) {
                throw new Error("No valid prices found");
            }
            console.log("%c✅ Prices Synced", "color: #00d4ff; font-weight: bold;");
            const indicator = document.getElementById('status-indicator');
            if(indicator) {
                indicator.innerText = "SYNCED"; indicator.style.color = "#00d4ff";
                setTimeout(() => { 
                    indicator.innerText = isRunning ? "LIVE" : "OFF";
                    indicator.style.color = isRunning ? "#4CAF50" : "#ff4d4d";
                }, 2000);
            }
        } catch (e) { console.error("❌ Sync Error:", e); }
    }

    const dashboard = document.createElement('div');
    dashboard.id = "epal-tracker-pro";
    dashboard.style = `position: fixed; top: 100px; left: 20px; z-index: 99999; background: rgba(15, 15, 15, 0.98); color: white; padding: 18px; border-radius: 12px; font-family: 'Segoe UI', sans-serif; border: 1px solid #ff4d89; min-width: 260px; box-shadow: 0 15px 40px rgba(0,0,0,0.6);`;

    dashboard.innerHTML = `
        <div id="drag-handle" style="font-weight:bold; color:#ff4d89; margin-bottom:12px; display:flex; justify-content:space-between; font-size:11px; cursor:move; padding-bottom:5px; border-bottom:1px solid rgba(255,77,137,0.2);">
            <span>🎁 GIFT TRACKER</span>
            <span id="status-indicator" style="color:#ff4d4d; font-weight:bold;">OFF</span>
        </div>
        <div style="display:flex; gap:4px; margin-bottom:10px;">
            <input type="text" id="input-target" placeholder="Target User..." style="flex:3; background:#222; border:1px solid #444; color:#00d4ff; border-radius:4px; padding:6px; font-size:12px; outline:none;">
            <button id="btn-sync" title="Sync Prices" style="flex:1; background:#333; border:1px solid #444; color:white; border-radius:4px; font-size:10px;">🔄</button>
        </div>
        <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
            <input type="number" id="input-minutes" value="3" min="1" style="width:45px; background:#222; border:1px solid #444; color:white; border-radius:4px; padding:4px; font-size:12px;">
            <span style="font-size:11px; color:#ccc;">min</span>
            <div id="display-timer" style="flex:1; text-align:right; font-family:monospace; font-size:20px; font-weight:bold; color:#4CAF50;">00:00</div>
        </div>
        <div id="top-donors" style="background:rgba(255,255,255,0.03); padding:8px; border-radius:6px; margin-bottom:12px; font-size:12px; min-height:60px; border-left:2px solid #ff4d89;">Waiting...</div>
        <div style="margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
                <span id="epal-value-num" style="font-size:1.8em; font-weight:bold; color:#ffce00;">0.00</span>
                <img src="${customIcon}" style="width:24px; height:24px; object-fit:contain;">
            </div>
        </div>
        <div style="display:flex; gap:6px;">
            <button id="btn-start" style="flex:2; background:#4CAF50; color:white; padding:8px; border-radius:6px; font-weight:bold; font-size:11px;">START</button>
            <button id="btn-copy" style="flex:1.5; background:#ffce00; color:black; padding:8px; border-radius:6px; font-weight:bold; font-size:11px;">SEND</button>
            <button id="btn-reset" style="flex:1; background:#333; color:#ff4d4d; padding:8px; border-radius:6px; font-size:11px; font-weight:bold;">RESET</button>
        </div>
    `;
    document.body.appendChild(dashboard);

    const updateUI = () => {
        document.getElementById('epal-value-num').innerText = totalValue.toFixed(2);
        const sorted = Object.entries(donors).sort(([,a],[,b]) => b-a).slice(0,3);
        const medals = ["🥇", "🥈", "🥉"];
        const topDonors = document.getElementById('top-donors');
        topDonors.replaceChildren();
        if (sorted.length === 0) {
            topDonors.textContent = "Waiting for gifts...";
            return;
        }

        sorted.forEach(([donorName, amount], i) => {
            const row = document.createElement('div');
            row.className = 'gift-row';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${medals[i]} ${donorName}`;

            const amountSpan = document.createElement('span');
            amountSpan.style.color = '#ffce00';
            amountSpan.style.fontWeight = 'bold';
            amountSpan.textContent = `${amount.toFixed(2)} $`;

            row.append(nameSpan, amountSpan);
            topDonors.appendChild(row);
        });
    };

    const processGiftElement = (giftPart) => {
        if (!isRunning || processedGiftNodes.has(giftPart)) return;

        processedGiftNodes.add(giftPart);
        const fullText = normalizeText(giftPart.innerText || '');
        if (!fullText || !fullText.toLowerCase().includes("gifted")) return;

        const qtyMatch = fullText.match(/x(\d+)\s*$/i);
        if (!qtyMatch) return;

        const quantity = Number.parseInt(qtyMatch[1], 10);
        if (!Number.isFinite(quantity) || quantity <= 0) return;

        const foundGift = findGiftName(fullText);
        if (!foundGift) {
            console.warn(`%c❓ UNKNOWN GIFT: ${fullText}`, "color:#ff9800;");
            return;
        }

        const recipientName = extractRecipientName(fullText, foundGift);
        const targetFilter = normalizeText(document.getElementById('input-target').value);
        if (targetFilter && (!recipientName || normalizeName(recipientName) !== normalizeName(targetFilter))) {
            return;
        }

        const messageContainer = giftPart.closest(MESSAGE_CONTAINER_SELECTOR);
        let donorName = "User";
        if (messageContainer) {
            const donorElem = messageContainer.querySelector(DONOR_SELECTOR);
            if (donorElem) donorName = normalizeText(donorElem.innerText);
        }

        cleanupRecentMessageSignatures();
        const signature = buildMessageSignature(donorName, recipientName, foundGift, quantity, fullText);
        if (recentMessageSignatures.has(signature)) return;
        recentMessageSignatures.set(signature, Date.now());

        const price = Number(giftPrices[foundGift]) || 0;
        const totalAmount = price * quantity;
        console.log(
            `%c🎁 [GIFT] ${foundGift} x${quantity} | %cTo: ${recipientName || targetFilter || "Everyone"} %c| From: ${donorName} | %cValue: $${totalAmount.toFixed(2)}`,
            "color:#4CAF50; font-weight:bold;",
            "color:#00d4ff;",
            "color:#ffffff;",
            "color:#ffce00; font-weight:bold;"
        );

        totalValue += totalAmount;
        donors[donorName] = (donors[donorName] || 0) + totalAmount;
        updateUI();
    };

    const processNode = (node) => {
        if (!isRunning || node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.matches?.(GIFT_MESSAGE_SELECTOR)) {
            processGiftElement(node);
        }

        node.querySelectorAll?.(GIFT_MESSAGE_SELECTOR).forEach(processGiftElement);
    };

    document.getElementById('btn-sync').onclick = syncPrices;
    document.getElementById('btn-reset').onclick = () => {
        if (confirm("⚠️ Reset everything?")) {
            totalValue = 0; donors = {}; updateUI();
        }
    };

    document.getElementById('btn-copy').onclick = function() {
        const target = document.getElementById('input-target').value.trim() || "Everyone";
        const sorted = Object.entries(donors).sort(([,a],[,b]) => b-a).slice(0,3);
        const medals = ["🥇","🥈","🥉"];
        const lines = [`🏆 TOP DONORS (${target})`];
        sorted.forEach((d, i) => lines.push(`${medals[i]} ${d[0]}: ${d[1].toFixed(1)}$`));
        const chat = document.querySelector('.ql-editor');
        if (chat) {
            appendParagraphs(chat, lines);
            chat.focus();
            setTimeout(() => {
                chat.dispatchEvent(new Event('input', { bubbles: true }));
                chat.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
                const btn = document.getElementById('btn-copy');
                btn.innerText = "SENT !"; btn.style.background = "#4CAF50"; btn.style.color = "white";
                setTimeout(() => { btn.innerText = "SEND"; btn.style.background = "#ffce00"; btn.style.color = "black"; }, 1500);
            }, 300);
        }
    };

    document.getElementById('btn-start').onclick = function() {
        if (!isRunning) {
            const mins = parseFloat(document.getElementById('input-minutes').value) || 1;
            timeLeft = Math.floor(mins * 60);
            setRunningState(true);
            updateTimerDisplay();
            timerInterval = setInterval(() => { 
                if (timeLeft > 0) {
                    timeLeft--;
                    updateTimerDisplay();
                } else {
                    setRunningState(false);
                }
            }, 1000);
        } else {
            setRunningState(false);
        }
    };

    syncPrices();
    const observer = new MutationObserver(m => m.forEach(mu => mu.addedNodes.forEach(processNode)));
    observer.observe(document.body, { childList: true, subtree: true });
    updateUI();
    updateTimerDisplay();

    let isDragging = false, ox, oy;
    const handleDragMove = (e) => {
        if (!isDragging) return;
        dashboard.style.left = (e.clientX - ox) + "px";
        dashboard.style.top = (e.clientY - oy) + "px";
    };
    const stopDragging = () => {
        isDragging = false;
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', stopDragging);
    };
    document.getElementById('drag-handle').addEventListener('mousedown', (e) => {
        isDragging = true;
        ox = e.clientX - dashboard.offsetLeft;
        oy = e.clientY - dashboard.offsetTop;
        window.addEventListener('mousemove', handleDragMove);
        window.addEventListener('mouseup', stopDragging);
    });
})();
