const STORAGE_KEYS = {
  database: "collectorDatabase",
  history: "collectorHistory",
  lastScan: "collectorLastScan",
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));

  await chrome.storage.local.set({
    [STORAGE_KEYS.database]: stored[STORAGE_KEYS.database] || {},
    [STORAGE_KEYS.history]: stored[STORAGE_KEYS.history] || [],
    [STORAGE_KEYS.lastScan]: stored[STORAGE_KEYS.lastScan] || {
      found: 0,
      added: 0,
      updated: 0,
      unchanged: 0,
      total: 0,
      scannedAt: null,
    },
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "COLLECTOR_SAVE_CARDS") {
    saveCards(message.cards || [], message.pageUrl || "")
      .then((stats) => sendResponse({ success: true, stats }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message || "Ошибка сохранения.",
        })
      );

    return true;
  }

  if (message?.type === "COLLECTOR_EXPORT") {
    exportDatabase(message.format)
      .then((filename) => sendResponse({ success: true, filename }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message || "Ошибка экспорта.",
        })
      );

    return true;
  }

  return false;
});

async function saveCards(cards, pageUrl) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.database,
    STORAGE_KEYS.history,
  ]);

  const database = stored[STORAGE_KEYS.database] || {};
  const history = stored[STORAGE_KEYS.history] || [];

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const now = new Date().toISOString();
  const uniqueCards = deduplicateCards(cards);

  for (const incomingCard of uniqueCards) {
    const card = normalizeCard(incomingCard, pageUrl, now);

    if (!card.ad_id || !card.url || !card.title) {
      continue;
    }

    const existing = database[card.ad_id];

    if (!existing) {
      database[card.ad_id] = {
        ...card,
        first_seen_at: now,
        last_seen_at: now,
        last_changed_at: now,
        status: "new",
      };

      history.push({
        ad_id: card.ad_id,
        event: "created",
        detected_at: now,
        card: database[card.ad_id],
      });

      added += 1;
      continue;
    }

    const changes = compareCards(existing, card);

    if (changes.length > 0) {
      database[card.ad_id] = {
        ...existing,
        ...card,
        first_seen_at: existing.first_seen_at || now,
        last_seen_at: now,
        last_changed_at: now,
        status: "updated",
      };

      history.push({
        ad_id: card.ad_id,
        event: "updated",
        detected_at: now,
        changes,
      });

      updated += 1;
    } else {
      database[card.ad_id] = {
        ...existing,
        last_seen_at: now,
        status: "active",
      };

      unchanged += 1;
    }
  }

  const stats = {
    found: uniqueCards.length,
    added,
    updated,
    unchanged,
    total: Object.keys(database).length,
    scannedAt: now,
    pageUrl,
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.database]: database,
    [STORAGE_KEYS.history]: history.slice(-5000),
    [STORAGE_KEYS.lastScan]: stats,
  });

  return stats;
}

function deduplicateCards(cards) {
  const result = new Map();

  for (const card of cards) {
    const id =
      String(card?.ad_id || "").trim() ||
      extractAdId(String(card?.url || ""));

    if (!id) {
      continue;
    }

    result.set(id, {
      ...card,
      ad_id: id,
    });
  }

  return [...result.values()];
}

function normalizeCard(card, pageUrl, now) {
  const url = cleanUrl(card.url || "");
  const rating = parseNumber(card.rating);
  const reviews = parseInteger(card.reviews);

  return {
    ad_id: String(card.ad_id || extractAdId(url)).trim(),
    title: cleanText(card.title),
    person: cleanText(card.person),
    seller_type: cleanText(card.seller_type),
    price: cleanText(card.price),
    rating,
    reviews,
    location: cleanText(card.location),
    url,
    text: cleanText(card.text).slice(0, 3000),
    source: "Avito",
    source_page: cleanUrl(pageUrl),
    collected_at: now,
  };
}

function compareCards(oldCard, newCard) {
  const trackedFields = [
    "title",
    "person",
    "seller_type",
    "price",
    "rating",
    "reviews",
    "location",
    "text",
  ];

  const changes = [];

  for (const field of trackedFields) {
    const oldValue = oldCard[field] ?? "";
    const newValue = newCard[field] ?? "";

    if (String(oldValue) !== String(newValue)) {
      changes.push({
        field,
        old_value: oldValue,
        new_value: newValue,
      });
    }
  }

  return changes;
}

async function exportDatabase(format) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.database,
    STORAGE_KEYS.history,
    STORAGE_KEYS.lastScan,
  ]);

  const database = stored[STORAGE_KEYS.database] || {};
  const history = stored[STORAGE_KEYS.history] || [];
  const lastScan = stored[STORAGE_KEYS.lastScan] || {};

  const rows = Object.values(database);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  let content;
  let mimeType;
  let filename;

  if (format === "csv") {
    content = createCsv(rows);
    mimeType = "text/csv;charset=utf-8";
    filename = `collector_avito_${stamp}.csv`;
  } else {
    content = JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        stats: lastScan,
        database: rows,
        history,
      },
      null,
      2
    );

    mimeType = "application/json;charset=utf-8";
    filename = `collector_avito_${stamp}.json`;
  }

  const dataUrl =
    `data:${mimeType},` +
    encodeURIComponent(format === "csv" ? `\uFEFF${content}` : content);

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true,
  });

  return filename;
}

function createCsv(rows) {
  const columns = [
    "ad_id",
    "title",
    "person",
    "seller_type",
    "price",
    "rating",
    "reviews",
    "location",
    "url",
    "source",
    "first_seen_at",
    "last_seen_at",
    "last_changed_at",
    "status",
    "text",
  ];

  const lines = [columns.map(csvEscape).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }

  return lines.join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function extractAdId(url) {
  return url.match(/_(\d{7,})(?:[/?#]|$)/)?.[1] || "";
}

function cleanUrl(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return String(value || "").trim();
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInteger(value) {
  const number = Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(number) ? number : null;
}

function parseNumber(value) {
  const number = Number.parseFloat(
    String(value ?? "").replace(",", ".").replace(/[^\d.]/g, "")
  );

  return Number.isFinite(number) ? number : null;
}
