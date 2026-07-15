const DB_KEY = "collectorDatabase";
const SCAN_KEY = "collectorLastScan";
const HISTORY_KEY = "collectorScanHistory";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([
    DB_KEY,
    SCAN_KEY,
    HISTORY_KEY,
  ]);

  await chrome.storage.local.set({
    [DB_KEY]: stored[DB_KEY] || {},
    [SCAN_KEY]: stored[SCAN_KEY] || {},
    [HISTORY_KEY]: stored[HISTORY_KEY] || [],
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "COLLECTOR_SAVE_CARDS") {
    saveCards(message.cards || [], message.pageUrl || "")
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error?.message || "Ошибка сохранения данных.",
        });
      });

    return true;
  }

  if (message?.type === "COLLECTOR_EXPORT") {
    exportDatabase(message.format)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error?.message || "Ошибка экспорта.",
        });
      });

    return true;
  }
});

function comparableCard(card) {
  return {
    title: card.title || "",
    person: card.person || "",
    sellerType: card.sellerType || "",
    price: card.price || "",
    rating: card.rating ?? null,
    reviews: card.reviews ?? null,
    location: card.location || "",
    description: card.description || "",
    url: card.url || "",
  };
}

function cardsAreDifferent(oldCard, newCard) {
  return (
    JSON.stringify(comparableCard(oldCard)) !==
    JSON.stringify(comparableCard(newCard))
  );
}

async function saveCards(cards, pageUrl) {
  const storage = await chrome.storage.local.get([
    DB_KEY,
    HISTORY_KEY,
  ]);

  const database = storage[DB_KEY] || {};
  const history = storage[HISTORY_KEY] || [];

  const now = new Date().toISOString();

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  const uniqueCards = new Map();

  for (const card of cards) {
    if (!card?.adId || !card?.url || !card?.title) {
      skipped += 1;
      continue;
    }

    uniqueCards.set(String(card.adId), card);
  }

  for (const [adId, card] of uniqueCards.entries()) {
    const existing = database[adId];

    if (!existing) {
      database[adId] = {
        ...card,
        adId,
        status: "new",
        firstSeen: now,
        lastSeen: now,
        lastChanged: now,
      };

      added += 1;
      continue;
    }

    if (cardsAreDifferent(existing, card)) {
      database[adId] = {
        ...existing,
        ...card,
        adId,
        status: "updated",
        firstSeen: existing.firstSeen || now,
        lastSeen: now,
        lastChanged: now,
      };

      updated += 1;
    } else {
      database[adId] = {
        ...existing,
        lastSeen: now,
        status: "active",
      };

      unchanged += 1;
    }
  }

  const scanStats = {
    scannedAt: now,
    pageUrl,
    found: uniqueCards.size,
    added,
    updated,
    unchanged,
    skipped,
    total: Object.keys(database).length,
  };

  history.unshift(scanStats);

  if (history.length > 100) {
    history.length = 100;
  }

  await chrome.storage.local.set({
    [DB_KEY]: database,
    [SCAN_KEY]: scanStats,
    [HISTORY_KEY]: history,
  });

  return {
    success: true,
    stats: scanStats,
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function createCsv(records) {
  const columns = [
    "adId",
    "title",
    "person",
    "sellerType",
    "price",
    "rating",
    "reviews",
    "location",
    "url",
    "pageUrl",
    "firstSeen",
    "lastSeen",
    "lastChanged",
    "status",
    "description",
  ];

  const lines = [
    columns.map(csvEscape).join(","),
  ];

  for (const record of records) {
    lines.push(
      columns.map((column) => csvEscape(record[column])).join(",")
    );
  }

  return `\uFEFF${lines.join("\n")}`;
}

function makeDataUrl(content, mimeType) {
  const bytes = new TextEncoder().encode(content);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function exportDatabase(format) {
  const storage = await chrome.storage.local.get(DB_KEY);
  const database = storage[DB_KEY] || {};
  const records = Object.values(database);

  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");

  let content;
  let filename;
  let mimeType;

  if (format === "json") {
    content = JSON.stringify(records, null, 2);
    filename = `collector_avito_${stamp}.json`;
    mimeType = "application/json;charset=utf-8";
  } else if (format === "csv") {
    content = createCsv(records);
    filename = `collector_avito_${stamp}.csv`;
    mimeType = "text/csv;charset=utf-8";
  } else {
    throw new Error("Неизвестный формат экспорта.");
  }

  const downloadUrl = makeDataUrl(content, mimeType);

  await chrome.downloads.download({
    url: downloadUrl,
    filename,
    saveAs: true,
  });

  return {
    success: true,
    filename,
    count: records.length,
  };
}
