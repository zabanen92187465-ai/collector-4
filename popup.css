const elements = {
  pageStatus: document.getElementById("pageStatus"),
  foundCount: document.getElementById("foundCount"),
  newCount: document.getElementById("newCount"),
  updatedCount: document.getElementById("updatedCount"),
  totalCount: document.getElementById("totalCount"),
  progressBlock: document.getElementById("progressBlock"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  scanButton: document.getElementById("scanButton"),
  exportJsonButton: document.getElementById("exportJsonButton"),
  exportCsvButton: document.getElementById("exportCsvButton"),
  message: document.getElementById("message"),
};

let currentPageIsAvito = false;
let isBusy = false;

function setMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.style.color = isError ? "#ff7777" : "#aeb6c2";
}

function updateButtons() {
  elements.scanButton.disabled = isBusy || !currentPageIsAvito;
  elements.exportJsonButton.disabled = isBusy;
  elements.exportCsvButton.disabled = isBusy;
}

function setBusy(value) {
  isBusy = value;
  updateButtons();
}

function showProgress(percent, text) {
  elements.progressBlock.classList.remove("hidden");
  elements.progressBar.style.width =
    `${Math.max(0, Math.min(percent, 100))}%`;
  elements.progressText.textContent = text;
}

function hideProgress() {
  elements.progressBlock.classList.add("hidden");
  elements.progressBar.style.width = "0%";
}

function isAvitoUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    return (
      parsedUrl.protocol === "https:" &&
      (
        hostname === "avito.ru" ||
        hostname.endsWith(".avito.ru")
      )
    );
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tab;
}

async function loadStats() {
  const result = await chrome.storage.local.get([
    "collectorDatabase",
    "collectorLastScan",
  ]);

  const database = result.collectorDatabase || {};
  const lastScan = result.collectorLastScan || {};

  elements.totalCount.textContent =
    Object.keys(database).length;

  elements.foundCount.textContent =
    lastScan.found || 0;

  elements.newCount.textContent =
    lastScan.added || 0;

  elements.updatedCount.textContent =
    lastScan.updated || 0;
}

async function checkCurrentPage() {
  try {
    const tab = await getActiveTab();

    currentPageIsAvito = Boolean(
      tab?.url && isAvitoUrl(tab.url)
    );

    elements.pageStatus.textContent =
      currentPageIsAvito
        ? "Авито открыто"
        : "Откройте страницу Авито";
  } catch {
    currentPageIsAvito = false;
    elements.pageStatus.textContent =
      "Не удалось проверить страницу";
  }

  updateButtons();
}

async function requestPageScan(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "COLLECTOR_SCAN_PAGE",
    });
  } catch {
    await chrome.scripting.executeScript({
      target: {
        tabId,
      },
      files: [
        "content.js",
      ],
    });

    return await chrome.tabs.sendMessage(tabId, {
      type: "COLLECTOR_SCAN_PAGE",
    });
  }
}

async function scanPage() {
  setBusy(true);

  showProgress(
    15,
    "Подключаюсь к странице…"
  );

  setMessage(
    "Сканирование началось."
  );

  try {
    const tab = await getActiveTab();

    if (
      !tab?.id ||
      !isAvitoUrl(tab.url || "")
    ) {
      currentPageIsAvito = false;
      updateButtons();

      throw new Error(
        "Сначала откройте страницу Авито."
      );
    }

    showProgress(
      35,
      "Ищу объявления…"
    );

    const response =
      await requestPageScan(tab.id);

    if (!response?.success) {
      throw new Error(
        response?.error ||
        "Страница не вернула данные."
      );
    }

    showProgress(
      75,
      "Обновляю накопительную базу…"
    );

    const saveResult =
      await chrome.runtime.sendMessage({
        type: "COLLECTOR_SAVE_CARDS",
        cards: response.cards,
        pageUrl: tab.url,
      });

    if (!saveResult?.success) {
      throw new Error(
        saveResult?.error ||
        "Не удалось сохранить данные."
      );
    }

    showProgress(
      100,
      "Готово."
    );

    elements.foundCount.textContent =
      saveResult.stats.found;

    elements.newCount.textContent =
      saveResult.stats.added;

    elements.updatedCount.textContent =
      saveResult.stats.updated;

    elements.totalCount.textContent =
      saveResult.stats.total;

    setMessage(
      `Найдено: ${saveResult.stats.found}. ` +
      `Новых: ${saveResult.stats.added}. ` +
      `Обновлено: ${saveResult.stats.updated}.`
    );
  } catch (error) {
    setMessage(
      error?.message ||
      "Ошибка сканирования.",
      true
    );
  } finally {
    setBusy(false);
    setTimeout(hideProgress, 900);
  }
}

async function exportDatabase(format) {
  setBusy(true);

  setMessage(
    `Подготавливаю экспорт ` +
    `${format.toUpperCase()}…`
  );

  try {
    const response =
      await chrome.runtime.sendMessage({
        type: "COLLECTOR_EXPORT",
        format,
      });

    if (!response?.success) {
      throw new Error(
        response?.error ||
        "Не удалось экспортировать базу."
      );
    }

    setMessage(
      `Файл ${response.filename} сохранён.`
    );
  } catch (error) {
    setMessage(
      error?.message ||
      "Ошибка экспорта.",
      true
    );
  } finally {
    setBusy(false);
  }
}

elements.scanButton.addEventListener(
  "click",
  scanPage
);

elements.exportJsonButton.addEventListener(
  "click",
  () => exportDatabase("json")
);

elements.exportCsvButton.addEventListener(
  "click",
  () => exportDatabase("csv")
);

Promise.all([
  checkCurrentPage(),
  loadStats(),
]).catch((error) => {
  setMessage(
    error?.message ||
    "Ошибка инициализации.",
    true
  );
});
