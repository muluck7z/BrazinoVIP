// ─── Brazino Background Service Worker ───
// Toda a lógica roda via API. Este arquivo apenas executa ações do Chrome.

const BRAZINO_API = 'https://SEU-PROJETO.vercel.app';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ proxyEnabled: false, proxyConfig: null });
});

// ══════════════════════════════════════════════════════════════
//  EMAIL INBOX — polling via API
// ══════════════════════════════════════════════════════════════
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'brazinoGlobalInbox') {
    await checkGlobalInbox();
  } else if (alarm.name.startsWith('brazinoAccInbox_')) {
    await checkAccountInbox(alarm.name.slice('brazinoAccInbox_'.length));
  }
});

async function checkGlobalInbox() {
  const data = await chrome.storage.local.get(['tempToken', 'tempLastMsgId', 'tempVerifyDone']);
  if (!data.tempToken) { chrome.alarms.clear('brazinoGlobalInbox'); return; }
  try {
    const result = await fetch(`${BRAZINO_API}/api/email/check-inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.tempToken, lastMsgId: data.tempLastMsgId || null })
    }).then(r => r.json());

    if (result.action === 'none') return;

    if (result.action === 'verify' && !data.tempVerifyDone) {
      const notif = { type: 'verify', content: 'Clique para verificar a conta Roblox', link: result.link };
      await chrome.storage.local.set({ lastNotif: notif, tempLastMsgId: result.msgId, tempVerifyDone: true });
      const st = await chrome.storage.local.get(['lastLoggedUserId', 'email', 'brazinoAccounts']);
      if (st.lastLoggedUserId && st.email) {
        const accs = st.brazinoAccounts || [];
        const idx  = accs.findIndex(a => String(a.userId) === String(st.lastLoggedUserId));
        if (idx >= 0) {
          accs[idx] = { ...accs[idx], email: st.email, updatedAt: Date.now() };
          await chrome.storage.local.set({ brazinoAccounts: accs });
        }
      }
      chrome.tabs.create({ url: result.link });
    } else if (result.action === 'revert') {
      const notif = { type: 'revert', content: 'Clique para reverter alterações', link: result.link };
      await chrome.storage.local.set({ lastNotif: notif, tempLastMsgId: result.msgId });
    } else if (result.action === 'code') {
      const notif = { type: 'code', content: `Código recebido: ${result.code}`, link: null };
      await chrome.storage.local.set({ lastNotif: notif, lastTempCode: result.code, lastTempCodeTime: Date.now(), tempLastMsgId: result.msgId });
      chrome.tabs.query({ url: '*://*.roblox.com/*' }, (tabs) => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'codeCaptured', code: result.code }).catch(() => {}));
      });
    }
  } catch { /* falha silenciosa */ }
}

async function checkAccountInbox(uid) {
  const data      = await chrome.storage.local.get(['brazinoAccounts']);
  const accs      = data.brazinoAccounts || [];
  const acc       = accs.find(a => String(a.userId) === uid);
  const alarmName = `brazinoAccInbox_${uid}`;

  if (!acc?.tempToken) { chrome.alarms.clear(alarmName); return; }

  try {
    const result = await fetch(`${BRAZINO_API}/api/email/check-inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: acc.tempToken, lastMsgId: acc.tempLastMsgId || null })
    }).then(r => r.json());

    if (result.action === 'none') return;

    const idx = accs.findIndex(a => String(a.userId) === uid);
    if (idx < 0) return;

    if (result.action === 'verify' && !acc.tempVerifyDone) {
      const notif = { type: 'verify', content: 'Clique para verificar conta Roblox', link: result.link };
      if (acc.tempEmail) accs[idx].email = acc.tempEmail;
      accs[idx].tempLastNotif  = notif;
      accs[idx].tempLastMsgId  = result.msgId;
      accs[idx].tempVerifyDone = true;
      accs[idx].updatedAt      = Date.now();
      await chrome.storage.local.set({ brazinoAccounts: accs });
      chrome.tabs.create({ url: result.link });
    } else if (result.action === 'revert') {
      const notif = { type: 'revert', content: 'Clique para reverter alterações', link: result.link };
      accs[idx].tempLastNotif = notif;
      accs[idx].tempLastMsgId = result.msgId;
      accs[idx].updatedAt     = Date.now();
      await chrome.storage.local.set({ brazinoAccounts: accs });
      chrome.tabs.create({ url: result.link });
    } else if (result.action === 'code') {
      const notif = { type: 'code', content: `Código: ${result.code}` };
      accs[idx].tempLastNotif = notif;
      accs[idx].tempLastMsgId = result.msgId;
      accs[idx].updatedAt     = Date.now();
      await chrome.storage.local.set({ brazinoAccounts: accs });
      await chrome.storage.local.set({ lastTempCode: result.code, lastTempCodeTime: Date.now() });
      chrome.tabs.query({ url: '*://*.roblox.com/*' }, (tabs) => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'codeCaptured', code: result.code }).catch(() => {}));
      });
    }
  } catch { /* falha silenciosa */ }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'closeTab') {
    if (sender.tab?.id) setTimeout(() => chrome.tabs.remove(sender.tab.id), 2000);
  }

  if (request.action === 'updateGamePass') {
    startRobuxAutomation(request.data)
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (request.action === 'automationFinished') finishRobuxAutomation(request.passId);

  if (request.action === 'passwordChanged') {
    chrome.storage.local.get(['newPassword'], (data) => {
      if (data.newPassword) chrome.storage.local.set({ currentPassword: data.newPassword, newPassword: '' });
    });
  }

  if (request.action === 'checkPublicIp') {
    fetch(`${BRAZINO_API}/api/ip/check`)
      .then(r => r.json())
      .then(d => sendResponse({ ip: d.ip || null }))
      .catch(() => sendResponse({ ip: null }));
    return true;
  }

  if (request.action === 'setProxy') {
    applyProxy(request.config)
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (request.action === 'clearProxy') {
    clearProxy()
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (request.action === 'getProxyStatus') {
    chrome.storage.local.get(['proxyEnabled', 'proxyConfig'], data => sendResponse(data));
    return true;
  }

  if (request.action === 'pingInboxCheck') {
    checkGlobalInbox().catch(() => {});
    chrome.storage.local.get(['brazinoAccounts'], (data) => {
      (data.brazinoAccounts || []).forEach(acc => {
        if (acc.tempToken) checkAccountInbox(String(acc.userId)).catch(() => {});
      });
    });
    sendResponse({ ok: true }); return true;
  }

  if (request.action === 'bgStartGlobalMonitor') {
    chrome.alarms.clear('brazinoGlobalInbox', () => {
      chrome.alarms.create('brazinoGlobalInbox', { periodInMinutes: 1 });
    });
    sendResponse({ ok: true }); return true;
  }

  if (request.action === 'bgStartAccMonitor') {
    const name = `brazinoAccInbox_${request.uid}`;
    chrome.alarms.clear(name, () => {
      chrome.alarms.create(name, { periodInMinutes: 1 });
    });
    sendResponse({ ok: true }); return true;
  }

  if (request.action === 'authKeyRemoved') {
    chrome.storage.local.get(['brazinoAlerts', 'brazinoAccounts', 'lastLoggedUserId'], (data) => {
      const alerts   = data.brazinoAlerts || [];
      const accounts = data.brazinoAccounts || [];
      const uid      = request.userId || data.lastLoggedUserId;
      if (!uid) return;
      const account = accounts.find(a => String(a.userId) === String(uid));
      if (!account) return;
      const idx = accounts.findIndex(a => String(a.userId) === String(uid));
      if (idx >= 0) accounts[idx] = { ...accounts[idx], authKey: '' };
      alerts.push({ type: 'authRemoved', userId: uid, username: account.username, timestamp: Date.now() });
      chrome.storage.local.set({ brazinoAccounts: accounts, brazinoAlerts: alerts });
    });
  }

  if (request.action === 'newAuthKeyDetected') {
    function isRealTotpSecret(s) {
      const c = (s || '').replace(/\s/g, '').toUpperCase();
      if (![16, 24, 32].includes(c.length)) return false;
      if (!/^[A-Z2-7]+$/.test(c)) return false;
      const d = (c.match(/[2-7]/g) || []).length;
      return d >= 2 && d / c.length >= 0.10;
    }
    if (!isRealTotpSecret(request.secret)) return;
    chrome.storage.local.get(['brazinoAlerts', 'brazinoAccounts', 'lastLoggedUserId'], (data) => {
      const alerts   = data.brazinoAlerts || [];
      const accounts = data.brazinoAccounts || [];
      const uid      = request.userId || data.lastLoggedUserId;
      const account  = uid ? accounts.find(a => String(a.userId) === String(uid)) : null;
      if (!uid || !account) return;
      const recent = alerts.find(a => a.type === 'newAuthKey' && a.userId === uid && a.secret === request.secret
        && (Date.now() - a.timestamp < 60000));
      if (recent) return;
      alerts.push({ type: 'newAuthKey', userId: uid, username: account.username, secret: request.secret, timestamp: Date.now() });
      chrome.storage.local.set({ brazinoAlerts: alerts });
    });
  }
});

// ── Robux Automation ──
async function getRobloxCookie() {
  return chrome.cookies.get({ url: 'https://www.roblox.com', name: '.ROBLOSECURITY' });
}
async function setRobloxCookie(value) {
  if (!value) return;
  await chrome.cookies.set({
    url: 'https://www.roblox.com', domain: '.roblox.com', name: '.ROBLOSECURITY',
    value: value.replace('.ROBLOSECURITY=', '').trim(),
    path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction'
  });
}
async function startRobuxAutomation(data) {
  const { cookie, value, gameId, passId } = data;
  const currentCookie = await getRobloxCookie();
  await chrome.storage.local.set({ originalCookie: currentCookie?.value || null, automationInProgress: true, targetPassId: passId, targetPrice: value });
  await setRobloxCookie(cookie);
  chrome.tabs.create({ url: `https://create.roblox.com/dashboard/creations/experiences/${gameId}/passes/${passId}/sales`, active: true });
}
async function finishRobuxAutomation(passId) {
  const data = await chrome.storage.local.get(['originalCookie']);
  if (data.originalCookie) await setRobloxCookie(data.originalCookie);
  await chrome.storage.local.remove(['originalCookie', 'automationInProgress', 'targetPassId', 'targetPrice']);
  const passLink = `https://www.roblox.com/game-pass/${passId}`;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.update(tabs[0].id, { url: passLink });
    else chrome.tabs.create({ url: passLink });
  });
}

// ── Proxy / VPN ──
async function applyProxy(config) {
  return new Promise((resolve, reject) => {
    const isSocks  = config.type === 'socks4' || config.type === 'socks5';
    const scheme   = isSocks
      ? (config.type === 'socks5' ? 'SOCKS5' : 'SOCKS4')
      : (config.type === 'https'  ? 'HTTPS'  : 'PROXY');
    const directDomains = ['api.ipify.org', 'api64.ipify.org', 'checkip.amazonaws.com', 'ipv4.icanhazip.com', 'api4.my-ip.io', 'freeipapi.com', 'ip4.seeip.org', 'api.mail.tm', 'proxylist.geonode.com', 'api.proxyscrape.com', 'www.proxy-list.download'];
    const directCheck = directDomains.map(d => `dnsDomainIs(host,"${d}")||host==="${d}"`).join('||');
    const pacScript = `function FindProxyForURL(url, host) { if (isPlainHostName(host)||host==="localhost"||host==="127.0.0.1"||${directCheck}) { return "DIRECT"; } return "${scheme} ${config.host}:${config.port}"; }`;
    chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data: pacScript } }, scope: 'regular' }, () => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      chrome.storage.local.set({ proxyEnabled: true, proxyConfig: config });
      chrome.action.setBadgeText({ text: 'VPN' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
      resolve();
    });
  });
}
async function clearProxy() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: 'regular' }, () => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      chrome.storage.local.set({ proxyEnabled: false });
      chrome.action.setBadgeText({ text: '' });
      resolve();
    });
  });
}
