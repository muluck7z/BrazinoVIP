(function() {
  // BRAZINO_API vem de config.js (injetado antes via manifest)

  const SELECTORS = {
    LOGIN_USER:  ['#login-username', 'input[name="username"]'],
    LOGIN_PASS:  ['#login-password', 'input[name="password"]'],
    LOGIN_BTN:   ['#login-button', 'button[data-testid="login-button"]'],
    EMAIL:       ['input[name="email"]', 'input[type="email"]', '#email-input',
                  '.modal-body input[placeholder*="Email"]', '.modal-body input[placeholder*="E-mail"]'],
    OLD_PWD:     ['#old-password-text-box', 'input[name="oldPassword"]', 'input[autocomplete="current-password"]',
                  'input[placeholder*="Senha Atual"]', 'input[placeholder*="Current Password"]'],
    NEW_PWD:     ['#new-password-text-box', 'input[name="newPassword"]', 'input[autocomplete="new-password"]',
                  'input[placeholder*="Nova Senha"]', 'input[placeholder*="New Password"]'],
    CONFIRM_PWD: ['#confirm-password-text-box', 'input[name="confirmPassword"]',
                  'input[placeholder*="Confirmar"]', 'input[placeholder*="Confirm"]'],
    TWO_STEP:    ['#two-step-verification-code-input', 'input[name="code"]', 'input[inputmode="numeric"]',
                  'input[placeholder*="6"]', '.modal-body input[type="text"]', '.modal-body input[type="number"]'],
    VERIFY_BTN:  ['button.modal-button.btn-primary-md', 'button.btn-cta-md',
                  '.modal-footer button.btn-primary-md', '#confirm-btn', '.modal-body button.btn-primary-md']
  };

  function findEl(list) {
    for (const s of list) {
      let el;
      if (s.includes(':contains')) {
        const text = s.match(/"(.*?)"/)?.[1];
        const tag  = s.split(':')[0] || '*';
        el = Array.from(document.querySelectorAll(tag)).find(e => e.textContent.includes(text) && isVisible(e));
      } else {
        el = document.querySelector(s);
      }
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      && s.display !== 'none' && s.visibility !== 'hidden';
  }

  function setVal(input, value) {
    if (!input || !value) return;
    try {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      (setter || { call: () => {} }).call(input, value);
      input.value = value;
      const opts = { bubbles: true, cancelable: true };
      input.dispatchEvent(new Event('input',  opts));
      input.dispatchEvent(new Event('change', opts));
      setTimeout(() => input.dispatchEvent(new Event('blur', opts)), 100);
    } catch { input.value = value; }
  }

  let lastFilledCode  = '';
  let lastFillTime    = 0;
  let isProcessing    = false;
  let loginDone       = false;
  let lastHashCheck   = '';

  const scannedSecrets  = new Set();
  const scannedElements = new WeakSet();
  const attachedButtons = new WeakSet();
  const listenedButtons = new WeakSet();

  async function tryLoginPage() {
    if (loginDone || !window.location.pathname.includes('/login')) return;
    const data = await chrome.storage.local.get(['pendingLogin']);
    if (!data.pendingLogin?.username || !data.pendingLogin?.password) return;
    const userIn = findEl(SELECTORS.LOGIN_USER);
    const passIn = findEl(SELECTORS.LOGIN_PASS);
    if (!userIn || !passIn) return;
    loginDone = true;
    setVal(userIn, data.pendingLogin.username);
    await new Promise(r => setTimeout(r, 300));
    setVal(passIn, data.pendingLogin.password);
    await chrome.storage.local.remove(['pendingLogin']);
    setTimeout(() => { const btn = findEl(SELECTORS.LOGIN_BTN); if (btn) btn.click(); }, 600);
  }

  async function processCode(code) {
    if (isProcessing || code === lastFilledCode) return;
    const input = findEl(SELECTORS.TWO_STEP);
    if (!input) return;
    isProcessing = true;
    setVal(input, code);
    lastFilledCode = code;
    lastFillTime = Date.now();
    setTimeout(() => {
      const btn = findEl(SELECTORS.VERIFY_BTN);
      if (btn) btn.click();
      setTimeout(() => { isProcessing = false; }, 3000);
    }, 800);
  }

  function isRealTotpSecret(s) {
    const c = (s || '').replace(/[\s=]/g, '').toUpperCase();
    if (![16, 24, 32].includes(c.length)) return false;
    if (!/^[A-Z2-7]+$/.test(c)) return false;
    const d = (c.match(/[2-7]/g) || []).length;
    return d >= 2 && (d / c.length) >= 0.10;
  }

  async function generateTotpViaApi(secret) {
    try {
      const r = await fetch(`${BRAZINO_API}/api/totp/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret })
      });
      const d = await r.json();
      return d.code || null;
    } catch { return null; }
  }

  async function monitorAuthenticatorApp() {
    const href = window.location.href;
    if (!href.includes('roblox.com/my/account')) return;
    const hash = window.location.hash.toLowerCase();
    if (hash && !hash.includes('security') && !hash.includes('privacy') && !hash.includes('auth')) return;
    const data = await chrome.storage.local.get(['lastLoggedUserId', 'brazinoAccounts']);
    const uid  = data.lastLoggedUserId;
    if (!uid) return;
    const account = (data.brazinoAccounts || []).find(a => String(a.userId) === String(uid));
    if (!account) return;
    captureManualKey(uid);
    document.querySelectorAll('a[href*="otpauth"],img[src*="otpauth"]').forEach(el => {
      if (scannedElements.has(el)) return;
      scannedElements.add(el);
      const uri = el.href || el.src || '';
      const m = uri.match(/secret=([A-Z2-7]{16,32})/i);
      if (m && isRealTotpSecret(m[1]) && !scannedSecrets.has(m[1].toUpperCase())) {
        scannedSecrets.add(m[1].toUpperCase());
        chrome.runtime.sendMessage({ action: 'newAuthKeyDetected', secret: m[1].toUpperCase(), userId: uid });
      }
    });
    attachDisableListener(uid, account);
  }

  function captureManualKey(uid) {
    document.querySelectorAll('input[readonly], input[disabled][type="text"]').forEach(el => {
      if (scannedElements.has(el)) return;
      scannedElements.add(el);
      const val = el.value.trim().replace(/\s/g, '');
      if (isRealTotpSecret(val) && !scannedSecrets.has(val.toUpperCase())) {
        scannedSecrets.add(val.toUpperCase());
        chrome.runtime.sendMessage({ action: 'newAuthKeyDetected', secret: val.toUpperCase(), userId: uid });
      }
    });
    document.querySelectorAll('code, pre, kbd, [class*="secret"], [class*="manual-key"], [class*="setup-key"], [class*="authenticator-key"], [data-testid*="secret"], [data-testid*="key"]').forEach(el => {
      if (scannedElements.has(el)) return;
      scannedElements.add(el);
      const txt = el.textContent.trim().replace(/\s/g, '');
      if (isRealTotpSecret(txt) && !scannedSecrets.has(txt.toUpperCase())) {
        scannedSecrets.add(txt.toUpperCase());
        chrome.runtime.sendMessage({ action: 'newAuthKeyDetected', secret: txt.toUpperCase(), userId: uid });
      }
    });
    document.querySelectorAll('p, span, div, li').forEach(el => {
      if (scannedElements.has(el) || el.children.length > 3) return;
      const txt = el.textContent.trim();
      if (!/(can't scan|manual|enter.*code|chave|secret key)/i.test(txt)) return;
      scannedElements.add(el);
      const m = txt.match(/\b([A-Z2-7]{16,32})\b/i);
      if (m && isRealTotpSecret(m[1]) && !scannedSecrets.has(m[1].toUpperCase())) {
        scannedSecrets.add(m[1].toUpperCase());
        chrome.runtime.sendMessage({ action: 'newAuthKeyDetected', secret: m[1].toUpperCase(), userId: uid });
      }
    });
  }

  function attachDisableListener(uid, account) {
    if (!account.authKey) return;
    document.querySelectorAll('button, .btn, [role="button"]').forEach(btn => {
      if (attachedButtons.has(btn)) return;
      const txt = btn.textContent.trim();
      if (txt !== 'Disable' && txt !== 'Remove' && txt !== 'Desativar' && txt !== 'Remover') return;
      const section = btn.closest('[class*="section"],[class*="tile"],[class*="row"],li,article,.container');
      if (!section) return;
      if (!section.textContent.includes('Authenticator') && !section.textContent.includes('authenticator')) return;
      attachedButtons.add(btn);
      btn.addEventListener('click', () => {
        setTimeout(() => chrome.runtime.sendMessage({ action: 'authKeyRemoved', userId: uid }), 3000);
      });
    });
  }

  chrome.runtime.onMessage.addListener((req) => {
    if (req.action === 'codeCaptured' && req.code) processCode(req.code);
  });

  async function runAutoFill() {
    if (!window.location.hostname.includes('roblox.com') || isProcessing) return;
    await tryLoginPage();
    const currentHash = window.location.hash;
    if (currentHash !== lastHashCheck) {
      lastHashCheck = currentHash;
      scannedSecrets.clear();
    }
    await monitorAuthenticatorApp();

    const d = await chrome.storage.local.get([
      'brazinoTotpSecret', 'email', 'currentPassword', 'newPassword',
      'tempEmail', 'lastTempCode', 'lastTempCodeTime'
    ]);

    const emailIn = findEl(SELECTORS.EMAIL);
    if (emailIn && !emailIn.value && !emailIn.matches(':focus')) {
      if (d.tempEmail && (location.href.includes('signup') || document.body.textContent.includes('Verify Email')))
        setVal(emailIn, d.tempEmail);
      else if (d.email?.includes('@'))
        setVal(emailIn, d.email);
    }

    const oldIn = findEl(SELECTORS.OLD_PWD);
    if (oldIn && d.currentPassword && !oldIn.value) setVal(oldIn, d.currentPassword);
    const newIn = findEl(SELECTORS.NEW_PWD);
    if (newIn && d.newPassword && !newIn.value) setVal(newIn, d.newPassword);
    const confIn = findEl(SELECTORS.CONFIRM_PWD);
    if (confIn && d.newPassword && !confIn.value) {
      setVal(confIn, d.newPassword);
      const vBtn = findEl(SELECTORS.VERIFY_BTN);
      if (vBtn && !listenedButtons.has(vBtn)) {
        listenedButtons.add(vBtn);
        vBtn.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'passwordChanged' }));
      }
    }

    const twoIn = findEl(SELECTORS.TWO_STEP);
    if (twoIn) {
      const now           = Date.now();
      const ctx           = getCodeFieldContext(twoIn);
      const hasEmailCode  = d.lastTempCode && d.lastTempCodeTime && now - d.lastTempCodeTime < 120000;
      const hasTotp       = !!d.brazinoTotpSecret;

      if (ctx === 'email') {
        if (hasEmailCode && d.lastTempCode !== lastFilledCode) processCode(d.lastTempCode);
      } else if (ctx === 'totp') {
        if (hasTotp) {
          const isNumeric = twoIn.getAttribute('inputmode') === 'numeric' || twoIn.type === 'number'
            || (twoIn.placeholder && /[0-9]/.test(twoIn.placeholder));
          if (isNumeric) {
            const code = await generateTotpViaApi(d.brazinoTotpSecret);
            if (code && code !== lastFilledCode && now - lastFillTime > 5000) processCode(code);
          }
        }
      } else {
        if (hasEmailCode && d.lastTempCode !== lastFilledCode) {
          processCode(d.lastTempCode);
        } else if (hasTotp) {
          const isNumeric = twoIn.getAttribute('inputmode') === 'numeric' || twoIn.type === 'number'
            || (twoIn.placeholder && /[0-9]/.test(twoIn.placeholder));
          if (isNumeric) {
            const code = await generateTotpViaApi(d.brazinoTotpSecret);
            if (code && code !== lastFilledCode && now - lastFillTime > 5000) processCode(code);
          }
        }
      }
    }
  }

  function getCodeFieldContext(input) {
    const container = input.closest('[class*="modal"],[class*="dialog"],[class*="verification"],[role="dialog"],form,section,article') || document.body;
    const text       = (container.textContent || '').toLowerCase();
    const totpSigs   = ['authenticator','autenticador','verification app','google auth','totp','2fa app'];
    const emailSigs  = ['email','e-mail','inbox','your email','we sent','enviamos','check your'];
    const hasTotp    = totpSigs.some(s => text.includes(s));
    const hasEmail   = emailSigs.some(s => text.includes(s));
    const activeTab  = container.querySelector('[class*="tab"][class*="active"],[class*="tab"][aria-selected="true"],[role="tab"][aria-selected="true"]');
    if (activeTab) {
      const t = (activeTab.textContent || '').toLowerCase();
      if (t.includes('authenticator') || t.includes('autenticador')) return 'totp';
      if (t.includes('email'))                                        return 'email';
    }
    if (hasTotp  && !hasEmail) return 'totp';
    if (hasEmail && !hasTotp)  return 'email';
    if (hasTotp  &&  hasEmail) {
      const td = Math.min(...totpSigs.map(s  => text.indexOf(s)).filter(i => i >= 0), Infinity);
      const ed = Math.min(...emailSigs.map(s => text.indexOf(s)).filter(i => i >= 0), Infinity);
      return td < ed ? 'totp' : 'email';
    }
    return 'unknown';
  }

  const observer = new MutationObserver(() => runAutoFill());
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(runAutoFill, 2000);
  runAutoFill();

  setInterval(() => {
    chrome.runtime.sendMessage({ action: 'pingInboxCheck' }).catch(() => {});
  }, 15000);
})();
