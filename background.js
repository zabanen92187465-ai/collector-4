const DB_KEY = "collectorDatabase";
const SCAN_KEY = "collectorLastScan";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Collector 4.0 started");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "COLLECTOR_SAVE_CARDS") {
    saveCards(message.cards || []).then(sendResponse);
    return true;
  }

  if (message.type === "COLLECTOR_EXPORT") {
    exportDatabase(message.format).then(sendResponse);
    return true;
  }

});

async function saveCards(cards) {

  const storage = await chrome.storage.local.get(DB_KEY);

  const database = storage[DB_KEY] || {};

  let added = 0;
  let updated = 0;

  for (const card of cards) {

    if (!card.adId) continue;

    if (database[card.adId]) {

      database[card.adId] = {
        ...database[card.adId],
        ...card,
        lastSeen: new Date().toISOString()
      };

      updated++;

    } else {

      database[card.adId] = {
        ...card,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };

      added++;

    }

  }

  await chrome.storage.local.set({
    [DB_KEY]: database,
    [SCAN_KEY]: {
      found: cards.length,
      added,
      updated
    }
  });

  return {
    success: true,
    stats: {
      found: cards.length,
      added,
      updated,
      total: Object.keys(database).length
    }
  };

}

async function exportDatabase(format) {

  const storage = await chrome.storage.local.get(DB_KEY);

  const database = storage[DB_KEY] || {};

  let text = "";

  let filename = "";

  if (format === "json") {

    filename = "database.json";

    text = JSON.stringify(database, null, 2);

  } else {

    filename = "database.csv";

    text = "id,title,price,url\n";

    Object.values(database).forEach(item => {

      text += `"${item.adId}","${item.title}","${item.price}","${item.url}"\n`;

    });

  }

  const blob = new Blob([text], {
    type: "text/plain"
  });

  const url = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url,
    filename,
    saveAs: true
  });

  return {
    success: true,
    filename
  };

}
