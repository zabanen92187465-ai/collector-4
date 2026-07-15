const CollectorParser = {
  normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  },

  makeAbsoluteUrl(href) {
    try {
      const url = new URL(
        href,
        window.location.origin
      );

      url.search = "";
      url.hash = "";

      return url.href;
    } catch {
      return "";
    }
  },

  getAdId(url) {
    const match = String(url).match(
      /_(\d{7,})(?:\/)?$/
    );

    return match ? match[1] : "";
  },

  isRealAdUrl(url) {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      const path = decodeURIComponent(
        parsed.pathname
      );

      return (
        parsed.hostname.endsWith("avito.ru") &&
        path.includes(
          "/predlozheniya_uslug/"
        ) &&
        /_\d{7,}\/?$/.test(path)
      );
    } catch {
      return false;
    }
  },

  findCardContainer(link) {
    let current = link;
    let best = link;
    let bestScore = -1;

    for (
      let level = 0;
      level < 8 && current;
      level += 1
    ) {
      const text = this.normalizeText(
        current.innerText
      );

      let score = 0;

      if (
        text.length >= 20 &&
        text.length <= 2200
      ) {
        score += 3;
      }

      if (
        current.querySelector?.(
          "img, picture"
        )
      ) {
        score += 2;
      }

      if (
        /\d[\d\s.,]*\s*(?:₽|руб)/i.test(
          text
        )
      ) {
        score += 2;
      }

      if (
        /[1-5][,.]\d\s*\(\d+\)/.test(
          text
        )
      ) {
        score += 2;
      }

      if (
        /частный исполнитель|частный мастер|команда|компания/i.test(
          text
        )
      ) {
        score += 1;
      }

      if (text.length > 2600) {
        score -= 8;
      }

      if (score > bestScore) {
        best = current;
        bestScore = score;
      }

      current = current.parentElement;
    }

    return best;
  },

  getTitle(card, link) {
    const selectors = [
      '[data-marker="item-title"]',
      '[itemprop="name"]',
      "h3",
      "h2",
    ];

    for (const selector of selectors) {
      const value = this.normalizeText(
        card.querySelector?.(selector)
          ?.textContent
      );

      if (
        value.length >= 4 &&
        value.length <= 180
      ) {
        return value;
      }
    }

    const linkText = this.normalizeText(
      link.textContent
    );

    if (
      linkText.length >= 4 &&
      linkText.length <= 180
    ) {
      return linkText;
    }

    const lines = String(
      card.innerText || ""
    )
      .split("\n")
      .map((line) =>
        this.normalizeText(line)
      )
      .filter(Boolean);

    return (
      lines.find(
        (line) =>
          line.length >= 4 &&
          line.length <= 180 &&
          !/^\d+\s*\/\s*\d+$/.test(line)
      ) || ""
    );
  },

  getPrice(text) {
    const matches = [
      ...text.matchAll(
        /(?:от\s*)?\d[\d\s.,]*\s*(?:₽|руб\.?)(?:\s*за\s*(?:час|день|сутки|м²))?/gi
      ),
    ]
      .map((match) => match[0])
      .sort(
        (first, second) =>
          first.length - second.length
      );

    return matches[0] || "";
  },

  getRating(text) {
    const match = text.match(
      /([1-5][,.]\d)\s*\((\d+)\)/
    );

    return {
      rating: match
        ? Number(
            match[1].replace(",", ".")
          )
        : null,

      reviews: match
        ? Number(match[2])
        : null,
    };
  },

  getSellerType(text) {
    const match = text.match(
      /частный исполнитель|частный мастер|команда|компания/i
    );

    return match ? match[0] : "";
  },

  getPerson(text, sellerType) {
    const ratingPattern =
      /(?:надёжный исполнитель\s+|может сегодня\s+|может завтра\s+)?([А-ЯЁA-Z][а-яёa-z-]+(?:\s+[А-ЯЁA-Z][а-яёa-z-]+){0,2})\s+[1-5][,.]\d\s*\(\d+\)/;

    const ratingMatch =
      text.match(ratingPattern);

    if (ratingMatch?.[1]) {
      return ratingMatch[1];
    }

    if (sellerType) {
      const escapedType =
        sellerType.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      const typePattern = new RegExp(
        `([А-ЯЁA-Z][а-яёa-z-]+(?:\\s+[А-ЯЁA-Z][а-яёa-z-]+){0,2})\\s+${escapedType}`,
        "i"
      );

      const typeMatch =
        text.match(typePattern);

      if (typeMatch?.[1]) {
        return typeMatch[1];
      }
    }

    return "";
  },

  getLocation(text) {
    const patterns = [
      /(?:Липецкая область|Липецкая обл\.),?\s*Елец(?:\s*·\s*выезжает по городу)?/i,

      /(?:ул\.|улица|мкр-н|мкр\.|микрорайон|пер\.|переулок|шоссе)\s*[А-ЯЁA-Zа-яёa-z0-9 .-]+(?:,\s*\d+[А-Яа-я]?)?(?:\s*·\s*выезжает по городу)?/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (match) {
        return this.normalizeText(
          match[0]
        );
      }
    }

    return "";
  },

  parsePage() {
    const cards = [];
    const seenIds = new Set();

    const links = [
      ...document.querySelectorAll(
        "a[href]"
      ),
    ];

    for (const link of links) {
      const url = this.makeAbsoluteUrl(
        link.getAttribute("href")
      );

      if (!this.isRealAdUrl(url)) {
        continue;
      }

      const adId = this.getAdId(url);

      if (
        !adId ||
        seenIds.has(adId)
      ) {
        continue;
      }

      const card =
        this.findCardContainer(link);

      const text = this.normalizeText(
        card?.innerText ||
          link.innerText
      );

      if (
        text.length < 15 ||
        text.length > 2400
      ) {
        continue;
      }

      const title = this.getTitle(
        card,
        link
      );

      if (!title) {
        continue;
      }

      const ignoredTitles = [
        "перевозки",
        "ремонт",
        "услуги",
        "все категории",
        "деловые услуги",
      ];

      if (
        ignoredTitles.includes(
          title.toLowerCase()
        )
      ) {
        continue;
      }

      const sellerType =
        this.getSellerType(text);

      const ratingData =
        this.getRating(text);

      cards.push({
        adId,
        title,

        person: this.getPerson(
          text,
          sellerType
        ),

        sellerType,
        price: this.getPrice(text),

        rating: ratingData.rating,
        reviews: ratingData.reviews,

        location:
          this.getLocation(text),

        description:
          text.slice(0, 1800),

        url,

        pageUrl:
          window.location.href,

        collectedAt:
          new Date().toISOString(),
      });

      seenIds.add(adId);
    }

    return cards;
  },

  sleep(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(
        resolve,
        milliseconds
      );
    });
  },

  addCardsToMap(cardMap, cards) {
    for (const card of cards) {
      if (card?.adId) {
        cardMap.set(
          card.adId,
          card
        );
      }
    }
  },

  getLoadedAdCount() {
    const adIds = new Set();

    const links = [
      ...document.querySelectorAll(
        "a[href]"
      ),
    ];

    for (const link of links) {
      const url =
        this.makeAbsoluteUrl(
          link.getAttribute("href")
        );

      if (!this.isRealAdUrl(url)) {
        continue;
      }

      const adId = this.getAdId(url);

      if (adId) {
        adIds.add(adId);
      }
    }

    return adIds.size;
  },

  isElementVisible(element) {
    if (!element?.isConnected) {
      return false;
    }

    const style =
      window.getComputedStyle(element);

    const rect =
      element.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  },

  findLoadMoreButton() {
    const selectors = [
      '[data-marker*="load-more"]',
      '[data-marker*="show-more"]',
      'button[data-marker*="more"]',
      "button",
      '[role="button"]',
      "a[href]",
    ];

    const candidates = [
      ...document.querySelectorAll(
        selectors.join(",")
      ),
    ];

    const matches =
      candidates.filter((element) => {
        const text =
          this.normalizeText(
            element.textContent ||
              element.innerText
          );

        const isLoadMoreText =
          text.length <= 80 &&
          /^(?:загрузить|показать)\s+ещ[её](?:\s+.*)?$/i.test(
            text
          );

        const isDisabled =
          element.disabled === true ||
          element.getAttribute(
            "aria-disabled"
          ) === "true" ||
          element.hasAttribute(
            "disabled"
          );

        return (
          isLoadMoreText &&
          !isDisabled &&
          this.isElementVisible(
            element
          )
        );
      });

    matches.sort(
      (first, second) => {
        const firstText =
          this.normalizeText(
            first.textContent
          );

        const secondText =
          this.normalizeText(
            second.textContent
          );

        return (
          firstText.length -
          secondText.length
        );
      }
    );

    return matches[0] || null;
  },

  async waitForMoreAds(
    previousCount,
    timeoutMilliseconds = 15000
  ) {
    const startedAt = Date.now();

    while (
      Date.now() - startedAt <
      timeoutMilliseconds
    ) {
      await this.sleep(400);

      const currentCount =
        this.getLoadedAdCount();

      if (
        currentCount >
        previousCount
      ) {
        return true;
      }
    }

    return false;
  },

  async scrollToLoadMoreButton() {
    let button =
      this.findLoadMoreButton();

    if (button) {
      return button;
    }

    window.scrollTo({
      top:
        document.documentElement
          .scrollHeight,

      behavior: "smooth",
    });

    await this.sleep(1200);

    return this.findLoadMoreButton();
  },

  async loadAllAds(
    maxClicks = 100
  ) {
    const collectedCards =
      new Map();

    let clicks = 0;
    let stalledAttempts = 0;

    this.addCardsToMap(
      collectedCards,
      this.parsePage()
    );

    while (clicks < maxClicks) {
      let button =
        await this.scrollToLoadMoreButton();

      if (!button) {
        break;
      }

      const previousDomCount =
        this.getLoadedAdCount();

      const previousCollectedCount =
        collectedCards.size;

      button.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      await this.sleep(500);

      button =
        this.findLoadMoreButton() ||
        button;

      if (!button?.isConnected) {
        stalledAttempts += 1;

        if (
          stalledAttempts >= 2
        ) {
          break;
        }

        continue;
      }

      button.click();
      clicks += 1;

      const domCountIncreased =
        await this.waitForMoreAds(
          previousDomCount
        );

      await this.sleep(800);

      this.addCardsToMap(
        collectedCards,
        this.parsePage()
      );

      const collectedCountIncreased =
        collectedCards.size >
        previousCollectedCount;

      if (
        domCountIncreased ||
        collectedCountIncreased
      ) {
        stalledAttempts = 0;
      } else {
        stalledAttempts += 1;

        if (
          stalledAttempts >= 2
        ) {
          break;
        }
      }
    }

    this.addCardsToMap(
      collectedCards,
      this.parsePage()
    );

    return {
      cards: [
        ...collectedCards.values(),
      ],

      loadResult: {
        clicks,
        loadedAds:
          collectedCards.size,

        reachedLimit:
          clicks >= maxClicks,
      },
    };
  },
};

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {
    if (
      message?.type !==
      "COLLECTOR_SCAN_PAGE"
    ) {
      return;
    }

    (async () => {
      const result =
        await CollectorParser
          .loadAllAds();

      sendResponse({
        success: true,
        cards: result.cards,

        loadResult:
          result.loadResult,
      });
    })().catch((error) => {
      sendResponse({
        success: false,

        error:
          error?.message ||
          "Ошибка чтения страницы Авито.",
      });
    });

    return true;
  }
);
