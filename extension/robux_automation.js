(function() {
  async function runAutomation() {
    const data = await chrome.storage.local.get(['automationInProgress', 'targetPrice', 'targetPassId']);

    if (!data.automationInProgress) return;

    const targetPrice = data.targetPrice;
    const passId = data.targetPassId;

    const interval = setInterval(() => {
      const priceInput = document.querySelector('input[id="priceTextField"], input[name="price"]');

      if (priceInput) {
        if (priceInput.value === targetPrice) {
          const saveBtn = Array.from(document.querySelectorAll('button')).find(b =>
            b.textContent.toLowerCase().includes('save') ||
            b.textContent.toLowerCase().includes('salvar')
          );

          if (saveBtn && !saveBtn.disabled) {
            clearInterval(interval);
            saveBtn.click();
            setTimeout(() => {
              chrome.runtime.sendMessage({ action: "automationFinished", passId: passId });
            }, 2000);
          }
        } else {
          priceInput.focus();
          priceInput.value = targetPrice;
          priceInput.dispatchEvent(new Event('input', { bubbles: true }));
          priceInput.dispatchEvent(new Event('change', { bubbles: true }));
          setTimeout(() => {
            priceInput.dispatchEvent(new Event('blur', { bubbles: true }));
          }, 100);
        }
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(interval);
      chrome.runtime.sendMessage({ action: "automationFinished", passId: passId });
    }, 20000);
  }

  if (document.readyState === 'complete') {
    runAutomation();
  } else {
    window.addEventListener('load', runAutomation);
  }
})();
