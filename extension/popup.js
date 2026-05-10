// ── BRAZINO_API vem de config.js (carregado antes no popup.html) ──

// ══════════════════════════════════════════════════════════
//  BRAZINO v5.0 — Popup Script
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async function () {

    // ── Navegação ──
    document.querySelectorAll('.nav-btn').forEach(btn =>
        btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab'))));

    function switchTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(tabName + 'Tab').classList.add('active');
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        if (tabName === 'vpn')    initVPN();
        if (tabName === 'contas') { renderAccounts(); checkAndShowAlerts(); }
        if (tabName !== 'login') {
            document.getElementById('profileView').style.display = 'none';
            document.getElementById('loginCard').style.display = 'block';
        }
    }

    // ── Utilitários ──
    function showAlert(message, type, alertId) {
        const el = document.getElementById(alertId);
        if (!el) return;
        const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
        el.innerHTML = `<div class="alert alert-${type}"><div class="alert-main"><i class="fas fa-${icon}"></i> ${message}</div></div>`;
    }
    function showStatus(msg, type) {
        const el = document.getElementById('status-msg');
        el.className = type === 'success' ? 'msg-success' : 'msg-error';
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 2500);
    }
    function copyText(text) {
        if (!text) return;
        navigator.clipboard.writeText(String(text)).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = String(text); document.body.appendChild(ta);
            ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        });
    }
    function escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function isValidTotpSecret(s) {
        return typeof s === 'string' && s.length >= 8 && s.length <= 64 && /^[A-Z2-7=]+$/i.test(s.replace(/\s/g,''));
    }

    // ── Limpeza de storage legado (cookie guardado por engano na chave TOTP) ──
    async function cleanupLegacyStorage() {
        const data = await chrome.storage.local.get(['robloxSecret','brazinoTotpSecret']);
        const toRemove = [];
        // Migra robloxSecret válido → brazinoTotpSecret
        if (data.robloxSecret && isValidTotpSecret(data.robloxSecret) && !data.brazinoTotpSecret)
            await chrome.storage.local.set({ brazinoTotpSecret: data.robloxSecret });
        // Remove legado
        if (data.robloxSecret) toRemove.push('robloxSecret');
        // Limpa brazinoTotpSecret se for na verdade um cookie (muito longo ou não base32)
        if (data.brazinoTotpSecret && !isValidTotpSecret(data.brazinoTotpSecret)) toRemove.push('brazinoTotpSecret');
        if (toRemove.length) await chrome.storage.local.remove(toRemove);
    }

    await cleanupLegacyStorage();

    // ── Remove alertas falsos salvos (strings que não são TOTP válido) ──
    async function cleanupFalseAlerts() {
        const d = await chrome.storage.local.get(['brazinoAlerts']);
        const alerts = d.brazinoAlerts || [];
        const clean = alerts.filter(a => {
            if (a.type !== 'newAuthKey') return true; // mantém outros tipos
            // Revalida a chave
            const s = (a.secret || '').replace(/\s/g,'').toUpperCase();
            if (![16,24,32].includes(s.length)) return false;
            if (!/^[A-Z2-7]+$/.test(s)) return false;
            const digits = (s.match(/[2-7]/g)||[]).length;
            return digits >= 2 && digits / s.length >= 0.10;
        });
        if (clean.length !== alerts.length)
            await chrome.storage.local.set({ brazinoAlerts: clean });
    }
    await cleanupFalseAlerts();

    // ══════════════════════════════
    //  CONTAS — armazenamento
    // ══════════════════════════════
    let savedAccounts = [];
    let contasTotpIntervals  = {};
    let accountInboxIntervals = {};
    let editingUserId  = null;
    let deletingUserId = null;
    const accountDataMap = new Map();

    async function loadAccounts() {
        const d = await chrome.storage.local.get(['brazinoAccounts']);
        savedAccounts = d.brazinoAccounts || [];
        accountDataMap.clear();
        savedAccounts.forEach(a => accountDataMap.set(String(a.userId), a));
        return savedAccounts;
    }
    async function persistAccounts() {
        await chrome.storage.local.set({ brazinoAccounts: savedAccounts });
        accountDataMap.clear();
        savedAccounts.forEach(a => accountDataMap.set(String(a.userId), a));
    }
    function findAccount(uid) { return savedAccounts.find(a => String(a.userId) === String(uid)); }

    async function upsertAccount(fields) {
        await loadAccounts();
        const uid = String(fields.userId);
        const clean = {};
        Object.entries(fields).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') clean[k] = v; });
        clean.userId = uid;
        const idx = savedAccounts.findIndex(a => String(a.userId) === uid);
        if (idx >= 0) savedAccounts[idx] = { ...savedAccounts[idx], ...clean, updatedAt: Date.now() };
        else savedAccounts.push({ ...clean, createdAt: Date.now(), updatedAt: Date.now() });
        await persistAccounts();
    }
    async function deleteAccount(uid) {
        await loadAccounts();
        savedAccounts = savedAccounts.filter(a => String(a.userId) !== String(uid));
        await persistAccounts();
    }
    async function getCurrentLoggedUserId() {
        try {
            const r = await fetch('https://users.roblox.com/v1/users/authenticated', { credentials: 'include' });
            if (!r.ok) return null;
            const d = await r.json();
            return d.id ? String(d.id) : null;
        } catch { return null; }
    }

    // ── Delegação global de cópia ──
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-copy-uid][data-copy-field]');
        if (!btn) return;
        e.stopPropagation();
        const uid   = btn.dataset.copyUid;
        const field = btn.dataset.copyField;
        if (field === 'totp') {
            const el = document.getElementById(`totp-code-${uid}`);
            if (el) { copyText(el.textContent); showStatus('Código copiado!', 'success'); }
            return;
        }
        if (field === 'tempEmail') {
            const acc = accountDataMap.get(uid);
            if (acc?.tempEmail) { copyText(acc.tempEmail); showStatus('E-mail copiado!', 'success'); }
            return;
        }
        const acc = accountDataMap.get(uid);
        if (acc?.[field]) { copyText(acc[field]); showStatus('Copiado!', 'success'); }
    });

    // ══════════════════════════════
    //  ALERTAS de Auth Key
    // ══════════════════════════════
    // ── Botão limpar todos os alertas ──
    document.getElementById('clearAlertsBtn').addEventListener('click', async () => {
        await chrome.storage.local.set({ brazinoAlerts: [] });
        checkAndShowAlerts();
        showStatus('Alertas limpos.', 'success');
    });

    async function checkAndShowAlerts() {
        const area = document.getElementById('contasAlertArea');
        if (!area) return;
        const d = await chrome.storage.local.get(['brazinoAlerts']);
        const alerts = d.brazinoAlerts || [];
        const clearBtn = document.getElementById('clearAlertsBtn');
        if (clearBtn) clearBtn.style.display = alerts.length ? 'inline-flex' : 'none';
        if (!alerts.length) { area.innerHTML = ''; return; }
        area.innerHTML = '';
        alerts.forEach((alert, idx) => {
            const div = document.createElement('div');
            if (alert.type === 'authRemoved') {
                div.className = 'auth-alert-banner danger';
                div.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <div class="auth-alert-body">
                        <strong>Autenticador Removido</strong>
                        <span>A chave 2FA da conta <b>${escapeHtml(alert.username || alert.userId)}</b> foi removida do Roblox. Auth Key limpa dos dados salvos.</span>
                        <div class="auth-alert-actions">
                            <button class="auth-alert-dismiss" data-dismiss="${idx}"><i class="fas fa-times"></i> Fechar</button>
                        </div>
                    </div>`;
            } else if (alert.type === 'newAuthKey') {
                div.className = 'auth-alert-banner';
                div.innerHTML = `
                    <i class="fas fa-shield-alt"></i>
                    <div class="auth-alert-body">
                        <strong>Nova Chave Autenticador Detectada</strong>
                        <span>Conta <b>${escapeHtml(alert.username || alert.userId)}</b> — nova chave: <code style="font-size:10px;color:var(--primary);">${escapeHtml(alert.secret)}</code></span>
                        <div class="auth-alert-actions">
                            <button class="auth-alert-accept" data-accept="${idx}" data-uid="${alert.userId}" data-secret="${escapeHtml(alert.secret)}">
                                <i class="fas fa-save"></i> Salvar nova chave
                            </button>
                            <button class="auth-alert-dismiss" data-dismiss="${idx}"><i class="fas fa-times"></i> Ignorar</button>
                        </div>
                    </div>`;
            }
            area.appendChild(div);
        });

        area.querySelectorAll('[data-accept]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const idx  = parseInt(btn.dataset.accept);
                const uid  = btn.dataset.uid;
                const secret = btn.dataset.secret;
                await upsertAccount({ userId: uid, authKey: secret });
                await chrome.storage.local.set({ brazinoTotpSecret: secret });
                await dismissAlert(idx);
                showStatus('Nova chave salva!', 'success');
                renderAccounts();
            });
        });
        area.querySelectorAll('[data-dismiss]').forEach(btn => {
            btn.addEventListener('click', async () => { await dismissAlert(parseInt(btn.dataset.dismiss)); });
        });
    }
    async function dismissAlert(idx) {
        const d = await chrome.storage.local.get(['brazinoAlerts']);
        const alerts = (d.brazinoAlerts || []).filter((_, i) => i !== idx);
        await chrome.storage.local.set({ brazinoAlerts: alerts });
        checkAndShowAlerts();
    }

    // ══════════════════════════════
    //  RENDERIZAÇÃO — Contas
    // ══════════════════════════════
    function renderAccounts() {
        loadAccounts().then(() => {
            const list  = document.getElementById('accountList');
            const empty = document.getElementById('contasEmpty');
            Object.values(contasTotpIntervals).forEach(clearInterval);
            contasTotpIntervals = {};
            if (!savedAccounts.length) { empty.style.display = 'block'; list.style.display = 'none'; list.innerHTML = ''; return; }
            empty.style.display = 'none';
            list.style.display = 'flex';
            list.innerHTML = '';
            savedAccounts.forEach(acc => list.appendChild(buildAccountCard(acc)));
        });
    }

    function buildAccountCard(account) {
        const card = document.createElement('div');
        card.className = 'account-card';
        const uid = String(account.userId);
        card.dataset.uid = uid;

        const badges = [
            account.authKey ? '<span class="account-badge badge-auth"><i class="fas fa-shield-alt"></i> 2FA</span>' : '',
            account.password ? '<span class="account-badge badge-pass"><i class="fas fa-lock"></i> Senha</span>' : '',
            account.email    ? '<span class="account-badge" style="background:rgba(59,130,246,.15);color:#93c5fd;"><i class="fas fa-envelope"></i> Email</span>' : ''
        ].filter(Boolean).join('');

        const lastLogin = account.lastLogin ? new Date(account.lastLogin).toLocaleDateString('pt-BR') : 'nunca';

        card.innerHTML = `
            <div class="account-card-header">
                ${account.avatarUrl
                    ? `<img src="${escapeHtml(account.avatarUrl)}" class="account-avatar" alt="${escapeHtml(account.username||'')}">` 
                    : `<div class="account-avatar-placeholder"><i class="fas fa-user"></i></div>`}
                <div class="account-info">
                    <div class="account-name">${escapeHtml(account.username || 'Desconhecido')}</div>
                    <div class="account-meta"><span>ID: ${uid}</span>${badges}</div>
                    <div class="account-meta" style="margin-top:2px;"><span style="font-size:10px;">Último login: ${lastLogin}</span></div>
                </div>
                <i class="fas fa-chevron-down account-chevron"></i>
            </div>
            <div class="account-details">
                <div class="detail-grid">
                    ${detailRow('fas fa-id-badge','Username', account.username, uid,'username')}
                    ${detailRow('fas fa-lock',    'Senha',    account.password, uid,'password',true)}
                    ${detailRow('fas fa-envelope','E-mail',   account.email,    uid,'email')}
                    ${detailRow('fas fa-key',     'Auth Key', account.authKey,  uid,'authKey',false,true)}
                    ${totpRow(uid, account.authKey)}
                </div>
                ${buildTempEmailSection(uid, account)}
                <div class="account-actions" style="margin-top:10px;">
                    <button class="btn-primary login-btn" data-uid="${uid}" style="font-size:12px;padding:8px 10px;">
                        <i class="fas fa-sign-in-alt"></i> Login
                    </button>
                    <button class="btn-ghost edit-btn" data-uid="${uid}"><i class="fas fa-edit"></i> Editar</button>
                    <button class="btn-ghost download-btn" data-uid="${uid}"><i class="fas fa-download"></i> Baixar</button>
                    <button class="btn-danger delete-btn" data-uid="${uid}"
                        style="flex:0;width:34px;height:34px;padding:0;border-radius:8px;"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;

        // Toggle expand
        card.querySelector('.account-card-header').addEventListener('click', () => {
            const wasExpanded = card.classList.contains('expanded');
            document.querySelectorAll('.account-card.expanded').forEach(c => c.classList.remove('expanded'));
            if (!wasExpanded) {
                card.classList.add('expanded');
                if (account.authKey) startContaTotp(uid, account.authKey);
                if (account.tempToken) startAccountInboxMonitoring(uid, account.tempToken);
            } else {
                if (contasTotpIntervals[uid]) { clearInterval(contasTotpIntervals[uid]); delete contasTotpIntervals[uid]; }
            }
        });

        // Login
        card.querySelector('.login-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            await chrome.storage.local.set({ pendingLogin: { username: account.username, password: account.password }, lastLoggedUserId: uid });
            chrome.tabs.create({ url: 'https://www.roblox.com/login' });
            showStatus('Abrindo login...', 'success');
        });

        card.querySelector('.edit-btn').addEventListener('click',    (e) => { e.stopPropagation(); openEditModal(uid); });
        card.querySelector('.download-btn').addEventListener('click',(e) => { e.stopPropagation(); downloadSingleAccount(uid); });
        card.querySelector('.delete-btn').addEventListener('click',  (e) => { e.stopPropagation(); openDeleteModal(uid); });

        // Gerar email temporário para esta conta
        const genBtn = card.querySelector('.btn-gen-temp');
        if (genBtn) {
            genBtn.addEventListener('click', (e) => { e.stopPropagation(); genAccountEmail(uid, card); });
        }

        return card;
    }

    // ── Seção de email temporário por conta ──
    function buildTempEmailSection(uid, account) {
        if (account.tempEmail) {
            const lastNotif = account.tempLastNotif;
            const isVerified = lastNotif?.type === 'verify';
            const dotClass   = isVerified ? '' : 'active';
            const statusText = isVerified ? 'Verificado!' : 'Monitorando...';
            let notifHtml = '';
            if (lastNotif) {
                if (lastNotif.type === 'verify' && lastNotif.link) {
                    notifHtml = `<div class="temp-inbox-notif verify" data-link="${escapeHtml(lastNotif.link)}">
                        <i class="fas fa-check-circle"></i>
                        <span>${escapeHtml(lastNotif.content)}</span>
                        <i class="fas fa-external-link-alt" style="margin-left:auto;opacity:.7;"></i>
                    </div>`;
                } else if (lastNotif.type === 'revert' && lastNotif.link) {
                    notifHtml = `<div class="temp-inbox-notif revert" data-link="${escapeHtml(lastNotif.link)}">
                        <i class="fas fa-undo"></i>
                        <span>${escapeHtml(lastNotif.content)}</span>
                        <i class="fas fa-external-link-alt" style="margin-left:auto;opacity:.7;"></i>
                    </div>`;
                } else if (lastNotif.type === 'code') {
                    notifHtml = `<div class="temp-inbox-notif code">
                        <i class="fas fa-key"></i>
                        <span>${escapeHtml(lastNotif.content)}</span>
                    </div>`;
                }
            }
            return `<div class="account-temp-email">
                <div class="temp-email-header">
                    <span class="temp-email-label"><i class="fas fa-inbox"></i> Email Temporário</span>
                    <div class="temp-inbox-status">
                        <div class="temp-inbox-dot ${dotClass}" id="temp-dot-${uid}"></div>
                        <span id="temp-status-${uid}">${statusText}</span>
                    </div>
                </div>
                <div class="temp-email-row">
                    <span title="${escapeHtml(account.tempEmail)}">${escapeHtml(account.tempEmail)}</span>
                    <div class="temp-email-actions">
                        <button class="btn-temp-sm" data-copy-uid="${uid}" data-copy-field="tempEmail" title="Copiar email"><i class="fas fa-copy"></i></button>
                        <button class="btn-temp-sm btn-gen-temp-replace" data-uid="${uid}" title="Gerar novo email"><i class="fas fa-sync-alt"></i></button>
                    </div>
                </div>
                ${notifHtml}
            </div>`;
        }
        return `<div class="account-temp-email">
            <button class="btn-gen-temp" data-uid="${uid}"><i class="fas fa-plus"></i> Gerar Email Temporário</button>
        </div>`;
    }

    // Gera email temporário para uma conta específica
    async function genAccountEmail(uid, cardEl) {
        const btn = cardEl?.querySelector(`.btn-gen-temp[data-uid="${uid}"], .btn-gen-temp-replace[data-uid="${uid}"]`);
        if (btn) btn.disabled = true;
        showStatus('Gerando e-mail...', 'success');
        try {
            const r = await fetch(`${BRAZINO_API}/api/email/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const { address, token } = await r.json();

            await upsertAccount({ userId: uid, tempEmail: address, tempToken: token, tempLastNotif: null, tempLastMsgId: null, tempVerifyDone: false });
            if (accountInboxIntervals[uid]) { clearInterval(accountInboxIntervals[uid]); delete accountInboxIntervals[uid]; }
            copyText(address);
            showStatus('E-mail gerado e copiado!', 'success');
            renderAccounts();
            setTimeout(() => startAccountInboxMonitoring(uid, token), 400);
            chrome.runtime.sendMessage({ action: 'bgStartAccMonitor', uid }).catch(() => {});
        } catch {
            showStatus('Erro ao gerar e-mail.', 'error');
            if (btn) btn.disabled = false;
        }
    }

    // Monitora inbox de um email temporário de uma conta específica
    function startAccountInboxMonitoring(uid, token) {
        if (!token) return;
        if (accountInboxIntervals[uid]) return;

        const initAcc = findAccount(uid);
        let lastMsgId  = initAcc?.tempLastMsgId  || null;
        let verifyDone = initAcc?.tempVerifyDone  || false;

        accountInboxIntervals[uid] = setInterval(async () => {
            try {
                const freshAcc = findAccount(uid);
                if (!freshAcc?.tempToken) { clearInterval(accountInboxIntervals[uid]); delete accountInboxIntervals[uid]; return; }
                const r = await fetch(`${BRAZINO_API}/api/email/check-inbox`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: freshAcc.tempToken, lastMsgId })
                });
                const result = await r.json();
                if (result.action === 'none') return;
                lastMsgId = result.msgId;

                if (result.action === 'verify' && !verifyDone) {
                    verifyDone = true;
                    await upsertAccount({ userId: uid, tempLastMsgId: result.msgId, tempVerifyDone: true, tempLastNotif: { type: 'verify', content: 'Clique para verificar a conta Roblox', link: result.link } });
                    chrome.tabs.create({ url: result.link });
                } else if (result.action === 'revert') {
                    await upsertAccount({ userId: uid, tempLastMsgId: result.msgId, tempLastNotif: { type: 'revert', content: 'Clique para reverter alterações', link: result.link } });
                    chrome.tabs.create({ url: result.link });
                } else if (result.action === 'code') {
                    await upsertAccount({ userId: uid, tempLastMsgId: result.msgId, tempLastNotif: { type: 'code', content: `Código: ${result.code}` } });
                    await chrome.storage.local.set({ lastTempCode: result.code, lastTempCodeTime: Date.now() });
                    chrome.tabs.query({ url: '*://*.roblox.com/*' }, (tabs) => {
                        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'codeCaptured', code: result.code }).catch(() => {}));
                    });
                }
                renderAccounts();
            } catch { }
        }, 4000);
    }


    // ── TOTP por conta ──
    function detailRow(icon, label, value, uid, field, isPassword=false, isMono=false) {
        const has = !!value;
        const display = isPassword && has ? '••••••••' : (has ? escapeHtml(value) : '');
        const content = has ? display : 'não definido';
        const copyBtn = has
            ? `<button class="detail-copy-btn" data-copy-uid="${uid}" data-copy-field="${field}" title="Copiar"><i class="fas fa-copy"></i></button>`
            : '';
        return `<div class="detail-row">
            <i class="${icon} detail-icon"></i>
            <span class="detail-label">${label}</span>
            <span class="detail-value${has ? '' : ' empty'}" style="${isMono ? 'font-size:10px;font-family:monospace;' : ''}">${content}</span>
            ${copyBtn}
        </div>`;
    }

    function totpRow(uid, authKey) {
        if (!authKey) return `<div class="detail-row"><i class="fas fa-clock detail-icon"></i>
            <span class="detail-label">Cód. 2FA</span><span class="detail-value empty">sem auth key</span></div>`;
        return `<div class="detail-row">
            <i class="fas fa-clock detail-icon"></i>
            <span class="detail-label">Cód. 2FA</span>
            <div style="flex:1;display:flex;align-items:center;gap:8px;">
                <span class="totp-inline" id="totp-code-${uid}">------</span>
                <span class="totp-timer" id="totp-timer-${uid}"></span>
            </div>
            <button class="detail-copy-btn" data-copy-uid="${uid}" data-copy-field="totp" title="Copiar"><i class="fas fa-copy"></i></button>
        </div>`;
    }

    function startContaTotp(uid, authKey) {
        if (contasTotpIntervals[uid]) clearInterval(contasTotpIntervals[uid]);
        async function tick() {
            const cEl = document.getElementById(`totp-code-${uid}`);
            const tEl = document.getElementById(`totp-timer-${uid}`);
            if (!cEl) { clearInterval(contasTotpIntervals[uid]); return; }
            try {
                const r = await fetch(`${BRAZINO_API}/api/totp/generate`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ secret: authKey })
                });
                const d = await r.json();
                if (d.code) cEl.textContent = d.code;
            } catch {}
            const secs = 30 - (Math.floor(Date.now() / 1000) % 30);
            if (tEl) tEl.textContent = `${secs}s`;
        }
        tick();
        contasTotpIntervals[uid] = setInterval(tick, 1000);
    }

    // Clique em notificação de email temporário (link de verificação)
    document.addEventListener('click', e => {
        const notif = e.target.closest('.temp-inbox-notif[data-link]');
        if (notif?.dataset.link) chrome.tabs.create({ url: notif.dataset.link });

        // Botão "gerar novo email" no card já renderizado
        const replaceBtn = e.target.closest('.btn-gen-temp-replace');
        if (replaceBtn) {
            e.stopPropagation();
            const uid  = replaceBtn.dataset.uid;
            const card = replaceBtn.closest('.account-card');
            if (uid) genAccountEmail(uid, card);
        }
    });

    // ── Edit Modal ──
    function openEditModal(uid) {
        editingUserId = uid;
        const acc = findAccount(uid);
        if (!acc) return;
        document.getElementById('edit-password').value = acc.password || '';
        document.getElementById('edit-authKey').value  = acc.authKey  || '';
        document.getElementById('edit-email').value    = acc.email    || '';
        document.getElementById('editModal').classList.add('active');
    }
    ['editModalClose','editModalCancel'].forEach(id =>
        document.getElementById(id).addEventListener('click', () => {
            document.getElementById('editModal').classList.remove('active');
            editingUserId = null;
        }));
    document.getElementById('editModalSave').addEventListener('click', async () => {
        if (!editingUserId) return;
        const authKey = document.getElementById('edit-authKey').value.trim().replace(/\s/g,'');
        const fields = {
            userId: editingUserId,
            password: document.getElementById('edit-password').value,
            email: document.getElementById('edit-email').value.trim()
        };
        // Auth Key: só adiciona se o usuário inseriu explicitamente um valor válido
        if (authKey && isValidTotpSecret(authKey)) {
            fields.authKey = authKey;
            await chrome.storage.local.set({ brazinoTotpSecret: authKey });
        } else if (!authKey) {
            // Usuário limpou o campo — remove a auth key da conta
            await loadAccounts();
            const idx = savedAccounts.findIndex(a => String(a.userId) === editingUserId);
            if (idx >= 0) {
                delete savedAccounts[idx].authKey;
                await persistAccounts();
            }
        }
        await upsertAccount(fields);
        document.getElementById('editModal').classList.remove('active');
        editingUserId = null;
        showStatus('Conta atualizada!', 'success');
        renderAccounts();
    });

    // ── Delete Modal ──
    function openDeleteModal(uid) { deletingUserId = uid; document.getElementById('deleteModal').classList.add('active'); }
    document.getElementById('deleteModalCancel').addEventListener('click', () => {
        document.getElementById('deleteModal').classList.remove('active'); deletingUserId = null;
    });
    document.getElementById('deleteModalConfirm').addEventListener('click', async () => {
        if (!deletingUserId) return;
        await deleteAccount(deletingUserId);
        if (accountInboxIntervals[deletingUserId]) { clearInterval(accountInboxIntervals[deletingUserId]); delete accountInboxIntervals[deletingUserId]; }
        document.getElementById('deleteModal').classList.remove('active');
        deletingUserId = null;
        showStatus('Conta removida.', 'success');
        renderAccounts();
    });

    // ── Download ──
    function downloadSingleAccount(uid) {
        const acc = savedAccounts.find(a => String(a.userId) === uid);
        if (!acc) return;
        const blob = new Blob([JSON.stringify(acc, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `brazino_${acc.username || uid}.json`; a.click(); URL.revokeObjectURL(url);
        showStatus('Download iniciado!', 'success');
    }
    document.getElementById('downloadAllBtn').addEventListener('click', async () => {
        await loadAccounts();
        if (!savedAccounts.length) { showStatus('Nenhuma conta para exportar.', 'error'); return; }
        const blob = new Blob([JSON.stringify(savedAccounts, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `brazino_contas_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
        showStatus(`${savedAccounts.length} conta(s) exportada(s)!`, 'success');
    });

    // ══════════════════════════
    //  TAB: LOGIN
    // ══════════════════════════
    function getAvatarUrl(userId) {
        return fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`)
            .then(r => r.json()).then(j => j.data?.[0]?.imageUrl || '').catch(() => '');
    }
    async function getRobux(userId) {
        try { const d = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`,{credentials:'include'}).then(r=>r.json()); return d.robux !== undefined ? String(d.robux) : '0'; }
        catch { return '0'; }
    }
    async function showUserInfo(user) {
        const [avatarUrl, robux, profile] = await Promise.all([
            getAvatarUrl(user.id), getRobux(user.id),
            fetch(`https://users.roblox.com/v1/users/${user.id}`).then(r=>r.json()).catch(()=>({}))
        ]);
        const created = profile.created || '';
        document.getElementById('userAvatar').src          = avatarUrl;
        document.getElementById('userName').textContent    = user.name || '';
        document.getElementById('userId').textContent      = user.id   || '';
        document.getElementById('userCreated').textContent = created ? new Date(created).toLocaleDateString('pt-BR') : '-';
        document.getElementById('daysSince').textContent   = created ? Math.floor((Date.now()-new Date(created).getTime())/86400000) : 'N/A';
        document.getElementById('userRobux').textContent   = robux;
        document.getElementById('loginCard').style.display   = 'none';
        document.getElementById('profileView').style.display = 'block';
        const uid = String(user.id);
        await chrome.storage.local.set({ lastLoggedUserId: uid });
        await upsertAccount({ userId: uid, username: user.name||'', avatarUrl, lastLogin: Date.now() });
        setTimeout(() => chrome.tabs.create({ url: 'https://www.roblox.com/my/account#!/info' }), 2000);
    }
    function setRobloxCookie(cookieValue) {
        chrome.cookies.get({ url:'https://www.roblox.com/',name:'.ROBLOSECURITY'}, (old) => {
            chrome.cookies.set({ url:'https://www.roblox.com/',name:'.ROBLOSECURITY',value:cookieValue,domain:'.roblox.com',path:'/',secure:true,httpOnly:true,sameSite:'no_restriction' }, () => {
                fetch('https://users.roblox.com/v1/users/authenticated',{credentials:'include'})
                    .then(r=>{if(!r.ok)throw new Error('Cookie inválido');return r.json();})
                    .then(data=>{ showAlert('Sessão iniciada com sucesso!','success','login-alert'); showUserInfo(data); })
                    .catch(()=>{ if(old)chrome.cookies.set({url:'https://www.roblox.com/',name:'.ROBLOSECURITY',value:old.value,domain:'.roblox.com',path:'/',secure:true,httpOnly:true,sameSite:'no_restriction'}); showAlert('Cookie inválido ou expirado.','error','login-alert'); });
            });
        });
    }
    document.getElementById('loginForm').addEventListener('submit', function(e) {
        e.preventDefault();
        let raw = document.getElementById('cookie').value;
        let cleaned = raw.replace(/[`"'\s\r\n\t*]/g,'');
        const wt = '_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_';
        let cv = cleaned.includes(wt) ? cleaned.split(wt)[1] : cleaned;
        const m = cv.match(/CAE[A-Z0-9._-]{100,}/i)||cv.match(/[A-Z0-9._-]{100,}/i);
        if(m) cv = m[0];
        cv = cv.replace(/[^A-Z0-9._-]+/i,'').replace(/_+$/,'');
        if(!cv||cv.length<50){showAlert('Cookie inválido ou muito curto.','error','login-alert');return;}
        setRobloxCookie(cv);
    });
    document.getElementById('backBtn').addEventListener('click',()=>{
        document.getElementById('loginCard').style.display='block';
        document.getElementById('profileView').style.display='none';
        document.getElementById('login-alert').innerHTML='';
        document.getElementById('cookie').value='';
    });

    // ══════════════════════════
    //  TAB: ACCESS
    // ══════════════════════════
    let cookieVisible = false;
    const getCookieBtn = document.getElementById('getCookieBtn');
    const accessCookie = document.getElementById('accessCookie');
    getCookieBtn.addEventListener('click', function() {
        if (cookieVisible) {
            accessCookie.type='password'; accessCookie.value='';
            getCookieBtn.innerHTML='<i class="fas fa-eye"></i> Mostrar Cookie';
            cookieVisible=false; return;
        }
        chrome.cookies.get({url:'https://www.roblox.com/',name:'.ROBLOSECURITY'}, (cookie)=>{
            if(cookie){
                accessCookie.type='text'; accessCookie.value=cookie.value;
                getCookieBtn.innerHTML='<i class="fas fa-eye-slash"></i> Ocultar Cookie';
                cookieVisible=true; copyText(cookie.value);
                showAlert('Cookie copiado!','success','access-alert');
            } else showAlert('Nenhum cookie. Faça login primeiro.','error','access-alert');
        });
    });

    // ══════════════════════════
    //  TAB: FRIENDS
    // ══════════════════════════
    async function getCsrf() {
        const r = await fetch('https://auth.roblox.com/v1/logout',{method:'POST',credentials:'include'});
        return r.headers.get('x-csrf-token');
    }
    document.getElementById('friendsForm').addEventListener('submit', async(e)=>{
        e.preventDefault();
        const fc=document.getElementById('friendsCookie').value.trim();
        if(!fc||fc.length<50){showAlert('Cookie inválido.','error','friends-alert');return;}
        showAlert('Iniciando remoção...','info','friends-alert');
        chrome.cookies.set({url:'https://www.roblox.com/',name:'.ROBLOSECURITY',value:fc,domain:'.roblox.com',path:'/',secure:true,httpOnly:true,sameSite:'no_restriction'},async()=>{
            try{
                const user=(await fetch('https://users.roblox.com/v1/users/authenticated',{credentials:'include'}).then(r=>{if(!r.ok)throw new Error('Cookie inválido');return r.json();}));
                const csrf=await getCsrf(); if(!csrf)throw new Error('Token CSRF falhou');
                const fd=await fetch(`https://friends.roblox.com/v1/users/${user.id}/friends`,{credentials:'include'}).then(r=>r.json());
                if(!fd.data?.length){showAlert('Nenhum amigo para remover.','info','friends-alert');return;}
                let removed=0;
                for(const f of fd.data){try{const r=await fetch(`https://friends.roblox.com/v1/users/${f.id}/unfriend`,{method:'POST',headers:{'X-CSRF-TOKEN':csrf,'Content-Type':'application/json'},credentials:'include'});if(r.ok)removed++;}catch{}}
                showAlert(`${removed} amigo(s) removido(s)!`,'success','friends-alert');
                document.getElementById('friendsCookie').value='';
            }catch(err){showAlert('Erro: '+err.message,'error','friends-alert');}
        });
    });

    // ══════════════════════════
    //  TAB: SEARCH
    // ══════════════════════════
    const sfc=document.getElementById('searchFormContainer'), sr=document.getElementById('searchResult');
    document.getElementById('searchForm').addEventListener('submit',async(e)=>{
        e.preventDefault();
        const username=document.getElementById('searchUsernameInput').value.trim();
        if(!username)return;
        sr.style.display='none'; document.getElementById('search-alert').innerHTML='';
        try{
            const rd=await fetch('https://users.roblox.com/v1/usernames/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usernames:[username],excludeBannedUsers:false})}).then(r=>r.json());
            if(!rd.data?.length)throw new Error('Usuário não encontrado');
            const uid=rd.data[0].id;
            const[ud,av,fr,fw]=await Promise.all([
                fetch(`https://users.roblox.com/v1/users/${uid}`).then(r=>r.json()),
                getAvatarUrl(uid),
                fetch(`https://friends.roblox.com/v1/users/${uid}/friends/count`).then(r=>r.json()),
                fetch(`https://friends.roblox.com/v1/users/${uid}/followers/count`).then(r=>r.json())
            ]);
            document.getElementById('searchAvatar').src=av;
            document.getElementById('searchDisplayName').textContent=ud.displayName;
            document.getElementById('searchUsername').textContent=`@${ud.name}`;
            document.getElementById('resId').textContent=ud.id;
            document.getElementById('resCreated').textContent=new Date(ud.created).toLocaleDateString('pt-BR');
            document.getElementById('resFriends').textContent=fr.count||0;
            document.getElementById('resFollowers').textContent=fw.count||0;
            document.getElementById('resDescription').textContent=ud.description||'Sem descrição.';
            sfc.style.display='none'; sr.style.display='block';
            showAlert('Usuário encontrado!','success','search-alert');
        }catch(err){showAlert('Erro: '+err.message,'error','search-alert');}
    });
    document.getElementById('searchBackBtn').addEventListener('click',()=>{
        sr.style.display='none'; sfc.style.display='block';
        document.getElementById('search-alert').innerHTML='';
        document.getElementById('searchUsernameInput').value='';
    });
    document.getElementById('downloadPdfBtn').addEventListener('click',()=>{
        const{jsPDF}=window.jspdf; const doc=new jsPDF();
        const dn=document.getElementById('searchDisplayName').textContent;
        const un=document.getElementById('searchUsername').textContent;
        const id=document.getElementById('resId').textContent;
        const cr=document.getElementById('resCreated').textContent;
        const fr=document.getElementById('resFriends').textContent;
        const fw=document.getElementById('resFollowers').textContent;
        const ds=document.getElementById('resDescription').textContent;
        doc.setFillColor(16,185,129);doc.rect(0,0,210,38,'F');
        doc.setTextColor(255,255,255);doc.setFontSize(22);doc.setFont('helvetica','bold');doc.text('BRAZINO',105,18,{align:'center'});
        doc.setFontSize(11);doc.setFont('helvetica','normal');doc.text('Relatório de Dados do Usuário',105,28,{align:'center'});
        doc.setTextColor(30,41,59);doc.setFontSize(17);doc.setFont('helvetica','bold');doc.text(dn,20,55);
        doc.setFontSize(12);doc.setTextColor(100,116,139);doc.setFont('helvetica','normal');doc.text(un,20,64);
        doc.setDrawColor(226,232,240);doc.line(20,72,190,72);
        const dd=(l,v,x,y)=>{doc.setFontSize(9);doc.setTextColor(16,185,129);doc.setFont('helvetica','bold');doc.text(l.toUpperCase(),x,y);doc.setFontSize(11);doc.setTextColor(30,41,59);doc.setFont('helvetica','normal');doc.text(String(v),x,y+7);};
        dd('ID',id,20,82);dd('Criação',cr,110,82);dd('Amigos',fr,20,107);dd('Seguidores',fw,110,107);
        doc.setFontSize(9);doc.setTextColor(16,185,129);doc.setFont('helvetica','bold');doc.text('DESCRIÇÃO',20,130);
        doc.setFontSize(10);doc.setTextColor(30,41,59);doc.setFont('helvetica','normal');doc.text(doc.splitTextToSize(ds,170),20,138);
        const ph=doc.internal.pageSize.height;doc.setFontSize(9);doc.setTextColor(148,163,184);
        doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} por Brazino v5.0`,105,ph-16,{align:'center'});
        doc.save(`Brazino_${un.replace('@','')}.pdf`);
    });

    // ══════════════════════════
    //  TAB: AUTH
    // ══════════════════════════
    let authIntervalId=null, inboxIntervalId=null;
    const authSecretInput=document.getElementById('auth-secret');
    const authEmailInput =document.getElementById('auth-email');
    const authCurrPass   =document.getElementById('auth-current-pass');
    const authNewPass    =document.getElementById('auth-new-pass');
    const codeContainer  =document.getElementById('code-container');
    const codeDisplay    =document.getElementById('current-code');
    const timerBar       =document.getElementById('timer-bar');
    const timerText      =document.getElementById('timer-text');
    const displaySecret  =document.getElementById('display-secret');

    function startCodeGeneration(secret) {
        if(!isValidTotpSecret(secret)) return;
        if(authIntervalId)clearInterval(authIntervalId);
        async function tick(){
            try {
                const r = await fetch(`${BRAZINO_API}/api/totp/generate`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ secret })
                });
                const d = await r.json();
                const code = d.code;
                if(!code) return;
                codeDisplay.textContent=code; displaySecret.textContent=secret; codeContainer.style.display='block';
                const secs=30-(Math.floor(Date.now()/1000)%30);
                timerText.textContent=`Expira em ${secs}s`;
                timerBar.style.width=((secs/30)*100)+'%';
                timerBar.style.background=secs<=5?'var(--danger)':'var(--primary)';
            } catch {}
        }
        tick(); authIntervalId=setInterval(tick,1000);
    }
    displaySecret.addEventListener('click',()=>{copyText(displaySecret.textContent);showStatus('Chave copiada!','success');});

    // Carrega dados — só popula o campo de chave se for base32 válido
    chrome.storage.local.get(['brazinoTotpSecret','email','currentPassword','newPassword','tempEmail','tempToken','lastNotif'],function(data){
        if(data.brazinoTotpSecret&&isValidTotpSecret(data.brazinoTotpSecret)){
            authSecretInput.value=data.brazinoTotpSecret;
            startCodeGeneration(data.brazinoTotpSecret);
        }
        if(data.email)           authEmailInput.value=data.email;
        if(data.currentPassword) authCurrPass.value=data.currentPassword;
        if(data.newPassword)     authNewPass.value=data.newPassword;
        if(data.tempEmail){
            document.getElementById('temp-email-addr').textContent=data.tempEmail;
            if(data.tempToken)startInboxMonitoring(data.tempToken);
        }
        if(data.lastNotif)updateEmailCard(data.lastNotif.type,data.lastNotif.content,data.lastNotif.link);
    });

    chrome.storage.onChanged.addListener(async(changes)=>{
        if(changes.currentPassword?.newValue!==undefined){
            authCurrPass.value=changes.currentPassword.newValue;
            const liveUid=await getCurrentLoggedUserId();
            const st=await chrome.storage.local.get(['lastLoggedUserId']);
            if(liveUid&&st.lastLoggedUserId&&liveUid===st.lastLoggedUserId){
                await upsertAccount({userId:liveUid,password:changes.currentPassword.newValue});
                renderAccounts();
            }
        }
        if(changes.newPassword?.newValue!==undefined) authNewPass.value=changes.newPassword.newValue;
        // Reexibe alertas se chegou novo
        if(changes.brazinoAlerts) {
            const ct=document.querySelector('[data-tab="contas"].active');
            if(ct) checkAndShowAlerts();
        }
        // Atualiza contas e notificações quando o background altera (monitoramento em background)
        if(changes.brazinoAccounts) {
            renderAccounts();
        }
        if(changes.lastNotif?.newValue){
            const n=changes.lastNotif.newValue;
            updateEmailCard(n.type,n.content,n.link);
        }
    });

    document.getElementById('auth-save').addEventListener('click',async()=>{
        const secret  =authSecretInput.value.trim().replace(/\s/g,'');
        const email   =authEmailInput.value.trim();
        const currPass=authCurrPass.value;
        const newPass =authNewPass.value;

        await chrome.storage.local.set({ brazinoTotpSecret:secret, email, currentPassword:currPass, newPassword:newPass });
        chrome.tabs.query({url:'*://*.roblox.com/*'},(tabs)=>tabs.forEach(t=>chrome.tabs.reload(t.id)));

        // ── Atualiza conta somente se session bate ──
        const liveUid=await getCurrentLoggedUserId();
        const st=await chrome.storage.local.get(['lastLoggedUserId']);
        if(liveUid&&st.lastLoggedUserId&&liveUid===st.lastLoggedUserId){
            const update={userId:liveUid};
            // Auth Key: só salva na conta se o usuário inseriu um valor válido explicitamente
            if(secret&&isValidTotpSecret(secret)) {
                update.authKey=secret;
            } else if(!secret) {
                // Usuário limpou o campo — remove authKey da conta
                await loadAccounts();
                const idx=savedAccounts.findIndex(a=>String(a.userId)===liveUid);
                if(idx>=0){ delete savedAccounts[idx].authKey; await persistAccounts(); }
            }
            if(currPass) update.password=currPass;
            // NÃO salva email aqui — email só é salvo quando a verificação chegar na inbox
            if(Object.keys(update).length>1){await upsertAccount(update);renderAccounts();}
            showAlert('Configurações salvas e conta atualizada!','success','auth-alert');
        } else {
            showAlert('Configurações salvas.','success','auth-alert');
        }

        if(secret&&isValidTotpSecret(secret)) startCodeGeneration(secret);
        else { if(authIntervalId)clearInterval(authIntervalId); codeContainer.style.display='none'; }
    });

    // ── Temp Email (aba Auth — inbox global) ──
    document.getElementById('gen-temp-email').addEventListener('click',async()=>{
        const btn=document.getElementById('gen-temp-email');
        const inboxText=document.getElementById('inbox-text');
        btn.disabled=true; inboxText.textContent='Gerando e-mail...';
        try{
            const r = await fetch(`${BRAZINO_API}/api/email/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const { address, token } = await r.json();
            await chrome.storage.local.set({ tempEmail: address, tempToken: token, tempLastMsgId: null, tempVerifyDone: false, lastNotif: null });
            document.getElementById('temp-email-addr').textContent=address;
            document.getElementById('email-notification').classList.remove('active');
            inboxText.textContent='Monitorando...';
            if(inboxIntervalId) clearInterval(inboxIntervalId);
            startInboxMonitoring(token);
            chrome.runtime.sendMessage({ action: 'bgStartGlobalMonitor' }).catch(() => {});
            copyText(address);
            showStatus('E-mail gerado e copiado!', 'success');
        }catch{
            inboxText.textContent=''; showStatus('Erro ao gerar e-mail.', 'error');
        }finally{ btn.disabled=false; }
    });

    async function startInboxMonitoring(token){
        if(!token) return;
        if(inboxIntervalId) clearInterval(inboxIntervalId);
        let lastMsgId = null;
        const stored = await chrome.storage.local.get(['tempLastMsgId','tempVerifyDone']);
        if(stored.tempLastMsgId) lastMsgId = stored.tempLastMsgId;
        let verifyDone = stored.tempVerifyDone || false;

        inboxIntervalId = setInterval(async()=>{
            try{
                const freshData = await chrome.storage.local.get(['tempToken']);
                if(!freshData.tempToken){ clearInterval(inboxIntervalId); return; }
                const r = await fetch(`${BRAZINO_API}/api/email/check-inbox`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: freshData.tempToken, lastMsgId })
                });
                const result = await r.json();
                if(result.action === 'none') return;
                lastMsgId = result.msgId;
                if(result.action === 'verify' && !verifyDone){
                    verifyDone = true;
                    await chrome.storage.local.set({ lastNotif: { type:'verify', content:'Clique para verificar a conta Roblox', link:result.link }, tempLastMsgId:result.msgId, tempVerifyDone:true });
                    updateEmailCard('verify','Clique para verificar a conta Roblox',result.link);
                    chrome.tabs.create({url:result.link});
                } else if(result.action === 'revert'){
                    await chrome.storage.local.set({ lastNotif: { type:'revert', content:'Clique para reverter alterações', link:result.link }, tempLastMsgId:result.msgId });
                    updateEmailCard('revert','Clique para reverter alterações',result.link);
                } else if(result.action === 'code'){
                    await chrome.storage.local.set({ lastNotif:{ type:'code', content:`Código recebido: ${result.code}`, link:null }, lastTempCode:result.code, lastTempCodeTime:Date.now(), tempLastMsgId:result.msgId });
                    updateEmailCard('code',`Código recebido: ${result.code}`,null);
                }
            }catch{}
        },4000);
    }
                    // Abre aba de verificação
                    chrome.tabs.create({url:link});
                }else if(rm){
                    const link=rm[0].replace(/&amp;/g,'&');
                    lastMsgId=messages[0].id;
                    updateEmailCard('revert','Clique para reverter alterações',link);
                    await chrome.storage.local.set({lastNotif:{type:'revert',content:'Clique para reverter',link},tempLastMsgId:lastMsgId});
                    showStatus('Link de reversão recebido!','success');
                }else if(cm){
                    const code=cm[0];
                    lastMsgId=messages[0].id;
                    updateEmailCard('code',`Código recebido: ${code}`,null);
                    await chrome.storage.local.set({lastNotif:{type:'code',content:`Código: ${code}`,link:null},lastTempCode:code,lastTempCodeTime:Date.now(),tempLastMsgId:lastMsgId});
                    chrome.tabs.query({url:'*://*.roblox.com/*'},(tabs)=>tabs.forEach(t=>chrome.tabs.sendMessage(t.id,{action:'codeCaptured',code}).catch(()=>{})));
                    it.textContent=`Código: ${code}`;
                    showStatus('Código capturado!','success');
                }
            }catch{}
        },4000);
    }
    function updateEmailCard(type,content,link){
        const icons={verify:'fas fa-check-circle',revert:'fas fa-undo',code:'fas fa-key'};
        const labels={verify:'Verificação de E-mail',revert:'Reversão de Conta',code:'Código Capturado'};
        document.getElementById('notif-type').innerHTML=`<i class="${icons[type]||'fas fa-envelope'}"></i> ${labels[type]||'Mensagem'}`;
        document.getElementById('notif-content').textContent=content;
        const en=document.getElementById('email-notification');
        en.classList.add('active'); en.style.cursor=link?'pointer':'default';
        en.onclick=link?()=>chrome.tabs.create({url:link}):null;
    }

    // ══════════════════════════
    //  TAB: ROBUX
    // ══════════════════════════
    chrome.storage.local.get(['robuxData'],(data)=>{
        if(data.robuxData){
            document.getElementById('robux-cookie').value =data.robuxData.cookie||'';
            document.getElementById('robux-value').value  =data.robuxData.value||'';
            // CORREÇÃO: ID do Jogo e ID da Game Pass só carregam se forem valores numéricos válidos
            // (evita que o cookie ou outro dado longo seja carregado nesses campos por engano)
            const rawGameId = String(data.robuxData.gameId||'').trim();
            const rawPassId = String(data.robuxData.passId||'').trim();
            document.getElementById('robux-game-id').value = /^\d+$/.test(rawGameId) ? rawGameId : '';
            document.getElementById('robux-pass-id').value = /^\d+$/.test(rawPassId) ? rawPassId : '';
        }
    });
    document.getElementById('btn-update-robux').addEventListener('click',async()=>{
        // CORREÇÃO: garante que gameId e passId são apenas numéricos ao salvar
        const rawGameId = document.getElementById('robux-game-id').value.trim();
        const rawPassId = document.getElementById('robux-pass-id').value.trim();
        const rb={cookie:document.getElementById('robux-cookie').value.trim(),value:document.getElementById('robux-value').value.trim(),gameId:rawGameId.replace(/\D/g,''),passId:rawPassId.replace(/\D/g,'')};
        if(!rb.cookie||!rb.value||!rb.gameId||!rb.passId){showAlert('Preencha todos os campos!','error','robux-alert');return;}
        await chrome.storage.local.set({robuxData:rb});
        showAlert('Iniciando automação...','info','robux-alert');
        chrome.runtime.sendMessage({action:'updateGamePass',data:rb},(res)=>{
            if(res?.success)showAlert('Automação concluída!','success','robux-alert');
            else showAlert('Erro: '+(res?.error||'Falha'),'error','robux-alert');
        });
    });

    // ══════════════════════════════════════════════════════
    //  TAB: VPN — reconstruído com busca de proxies ao vivo
    // ══════════════════════════════════════════════════════

    let vpnInitialized = false;
    let activeVpnConfig = null;
    let connectedItemEl  = null;

    function sendVpn(action, extra = {}) {
        return new Promise(r => chrome.runtime.sendMessage({ action, ...extra }, r));
    }

    // Mapeamento de código de país → bandeira emoji
    const countryFlag = (c) => {
        if (!c || c.length !== 2) return '🌐';
        return String.fromCodePoint(...[...c.toUpperCase()].map(ch => 0x1F1E6 - 65 + ch.charCodeAt(0)));
    };
    const countryName = (c) => {
        try { return new Intl.DisplayNames(['pt-BR'], { type: 'region' }).of(c) || c; } catch { return c; }
    };

    async function fetchCurrentIp() {
        const btn = document.getElementById('refreshIpBtn');
        const el  = document.getElementById('currentIp');
        btn.classList.add('spinning');
        el.textContent = 'Verificando...';
        try {
            // Delega ao background (domínios de IP sempre passam DIRECT, nunca pelo proxy)
            const r = await sendVpn('checkPublicIp');
            el.textContent = r?.ip || 'Indisponível';
        } catch {
            el.textContent = 'Indisponível';
        }
        btn.classList.remove('spinning');
    }

    function setVpnStatus(enabled) {
        document.getElementById('proxyToggle').checked = enabled;
        const badge = document.getElementById('vpnStatusBadge');
        const text  = document.getElementById('vpnStatusText');
        if (enabled) { badge.classList.add('active'); text.textContent = 'Ativo'; }
        else         { badge.classList.remove('active'); text.textContent = 'Desativado'; }
    }

    async function applyProxy(config, itemEl) {
        // Marca o item como "conectando"
        if (connectedItemEl) {
            connectedItemEl.classList.remove('connected', 'connecting', 'failed');
            const prevBtn = connectedItemEl.querySelector('.vpn-connect-btn');
            if (prevBtn) { prevBtn.textContent = 'Usar'; prevBtn.className = 'vpn-connect-btn'; }
        }
        if (itemEl) {
            itemEl.classList.add('connecting');
            const btn = itemEl.querySelector('.vpn-connect-btn');
            if (btn) { btn.textContent = 'Conectando...'; btn.className = 'vpn-connect-btn connecting-state'; }
        }
        const r = await sendVpn('setProxy', { config });
        if (r?.success) {
            activeVpnConfig = config;
            connectedItemEl = itemEl;
            setVpnStatus(true);
            if (itemEl) {
                itemEl.classList.remove('connecting');
                itemEl.classList.add('connected');
                const btn = itemEl.querySelector('.vpn-connect-btn');
                if (btn) { btn.textContent = 'Ativo'; btn.className = 'vpn-connect-btn active'; }
            }
            // Confirma mudança de IP após 1.5s
            setTimeout(async () => {
                await fetchCurrentIp();
            }, 1500);
        } else {
            if (itemEl) {
                itemEl.classList.remove('connecting');
                itemEl.classList.add('failed');
                const btn = itemEl.querySelector('.vpn-connect-btn');
                if (btn) { btn.textContent = 'Falhou'; btn.className = 'vpn-connect-btn failed-state'; }
            }
            showStatus('Proxy recusou a conexão.', 'error');
        }
    }

    async function disableProxy() {
        const r = await sendVpn('clearProxy');
        if (r?.success) {
            activeVpnConfig = null;
            setVpnStatus(false);
            if (connectedItemEl) {
                connectedItemEl.classList.remove('connected', 'connecting', 'failed');
                const btn = connectedItemEl.querySelector('.vpn-connect-btn');
                if (btn) { btn.textContent = 'Usar'; btn.className = 'vpn-connect-btn'; }
                connectedItemEl = null;
            }
            setTimeout(fetchCurrentIp, 800);
        }
    }

    // Busca lista de proxies ao vivo via API
    async function fetchLiveProxies() {
        const btn      = document.getElementById('fetchProxiesBtn');
        const listArea = document.getElementById('vpnProxyListArea');
        const protocol = document.getElementById('vpnProtocolFilter').value;
        btn.disabled = true;
        btn.innerHTML = '<span class="vpn-spinner" style="display:inline-block;"></span> Buscando...';
        listArea.innerHTML = '<div class="vpn-loading"><div class="vpn-spinner"></div> Carregando proxies...</div>';
        try {
            const r = await fetch(`${BRAZINO_API}/api/proxy/list?protocol=${encodeURIComponent(protocol)}`);
            const data = await r.json();
            const proxies = data.proxies || [];
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sync-alt"></i> Buscar Proxies';
            if (!proxies.length) {
                listArea.innerHTML = `<div class="vpn-empty-state"><i class="fas fa-exclamation-triangle" style="font-size:28px;color:rgba(239,68,68,0.5);display:block;margin-bottom:8px;"></i><span>Não foi possível carregar proxies. Use a aba <strong>Personalizado</strong>.</span></div>`;
                return;
            }
            listArea.innerHTML = '';
            proxies.forEach(p => {
                const proto = (p.protocols[0] || 'http').toLowerCase();
                const flag  = countryFlag(p.country);
                const name  = p.country ? countryName(p.country) : 'Desconhecido';
                const item  = document.createElement('div');
                item.className = 'vpn-proxy-item';
                item.innerHTML = `<div class="vpn-proxy-info"><span class="vpn-proxy-flag">${flag}</span><div class="vpn-proxy-details"><div class="vpn-proxy-name">${escapeHtml(name)}</div><div class="vpn-proxy-addr">${escapeHtml(p.ip)}:${escapeHtml(String(p.port))}</div></div><span class="vpn-proto-badge proto-${proto}">${proto}</span></div><button class="vpn-connect-btn">Usar</button>`;
                item.querySelector('.vpn-connect-btn').addEventListener('click', () => {
                    applyProxy({ host: p.ip, port: String(p.port), type: proto }, item);
                });
                listArea.appendChild(item);
            });
        } catch {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sync-alt"></i> Buscar Proxies';
            listArea.innerHTML = `<div class="vpn-empty-state">Erro ao buscar proxies. Tente novamente.</div>`;
        }
    }
            } catch { /* falhou */ }
        }

        if (!proxies.length) {
            try {
                for (const proto of protos) {
                    const p = await tryProxyListTxt(proto).catch(() => []);
                    proxies.push(...p);
                }
            } catch { /* falhou */ }
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sync-alt"></i> Buscar Proxies';

        if (!proxies.length) {
            listArea.innerHTML = `<div class="vpn-empty-state">
                <i class="fas fa-exclamation-triangle" style="font-size:28px;color:rgba(239,68,68,0.5);display:block;margin-bottom:8px;"></i>
                <span>Não foi possível carregar proxies. Verifique sua conexão ou use a aba <strong>Personalizado</strong>.</span>
            </div>`;
            return;
        }

        // Limita a 15 proxies e renderiza
        proxies = proxies.slice(0, 15);
        listArea.innerHTML = '';

        proxies.forEach(p => {
            const proto = (p.protocols[0] || 'http').toLowerCase();
            const flag  = countryFlag(p.country);
            const name  = p.country ? countryName(p.country) : 'Desconhecido';

            const item  = document.createElement('div');
            item.className = 'vpn-proxy-item';
            item.innerHTML = `
                <div class="vpn-proxy-info">
                    <span class="vpn-proxy-flag">${flag}</span>
                    <div class="vpn-proxy-details">
                        <div class="vpn-proxy-name">${escapeHtml(name)}</div>
                        <div class="vpn-proxy-addr">${escapeHtml(p.ip)}:${escapeHtml(String(p.port))}</div>
                    </div>
                    <span class="vpn-proto-badge proto-${proto}">${proto}</span>
                </div>
                <button class="vpn-connect-btn">Usar</button>`;

            item.querySelector('.vpn-connect-btn').addEventListener('click', () => {
                applyProxy({ host: p.ip, port: String(p.port), type: proto }, item);
            });

            listArea.appendChild(item);
        });
    }

    async function initVPN() {
        if (vpnInitialized) return;
        vpnInitialized = true;

        // Carrega estado atual
        const data = await sendVpn('getProxyStatus');
        if (data) {
            setVpnStatus(data.proxyEnabled || false);
            if (data.proxyEnabled && data.proxyConfig) activeVpnConfig = data.proxyConfig;
        }
        fetchCurrentIp();

        // Toggle ligar/desligar
        document.getElementById('proxyToggle').addEventListener('change', (ev) => {
            if (ev.target.checked) {
                if (activeVpnConfig) applyProxy(activeVpnConfig, connectedItemEl);
                else { ev.target.checked = false; showStatus('Selecione um proxy primeiro.', 'error'); }
            } else {
                disableProxy();
            }
        });

        // Atualizar IP
        document.getElementById('refreshIpBtn').addEventListener('click', fetchCurrentIp);

        // Trocar abas
        document.querySelectorAll('.vpn-tab').forEach(tab => tab.addEventListener('click', () => {
            document.querySelectorAll('.vpn-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.vpn-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('vpntab-' + tab.dataset.vpntab).classList.add('active');
        }));

        // Botão buscar proxies
        document.getElementById('fetchProxiesBtn').addEventListener('click', fetchLiveProxies);

        // Proxy personalizado
        document.getElementById('saveCustomBtn').addEventListener('click', () => {
            const h = document.getElementById('proxyHost').value.trim();
            const p = document.getElementById('proxyPort').value.trim();
            const t = document.getElementById('proxyType').value;
            if (!h || !p) { showStatus('Preencha endereço e porta.', 'error'); return; }
            activeVpnConfig = null;
            connectedItemEl = null;
            applyProxy({ host: h, port: p, type: t }, null);
        });
    }

    // ── Init ──
    await loadAccounts();

    // Sincroniza senha se mudou em background enquanto o popup estava fechado
    (async () => {
        const syncData = await chrome.storage.local.get(['currentPassword','lastLoggedUserId']);
        if (syncData.currentPassword && syncData.lastLoggedUserId) {
            const acc = findAccount(syncData.lastLoggedUserId);
            if (acc && acc.password !== syncData.currentPassword) {
                await upsertAccount({ userId: syncData.lastLoggedUserId, password: syncData.currentPassword });
                renderAccounts();
            }
        }
    })();

    // Reinicia monitoramento popup (4s) para contas com tempToken pendente
    // O alarme de background (1min) já está ativo, mas isso dá resposta mais rápida
    savedAccounts.forEach(acc => {
        if (acc.tempToken && (!acc.tempLastNotif || acc.tempLastNotif.type !== 'verify')) {
            const uid = String(acc.userId);
            if (!accountInboxIntervals[uid]) {
                setTimeout(() => startAccountInboxMonitoring(uid, acc.tempToken), 500);
            }
        }
    });
});
