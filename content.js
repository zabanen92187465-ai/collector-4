(() => {
  "use strict";

  const CONTENT_VERSION = "0.2.2-load-more-fix";
  const GLOBAL_KEY = "__collectorAvitoContentState__";

  const previousState = globalThis[GLOBAL_KEY];

  if (previousState?.messageListener) {
    try {
      chrome.runtime.onMessage.removeListener(
        previousState.messageListener
      );
    } catch {
      // После обновления страницы старый обработчик уже может отсутствовать.
    }
  }

  const state = {
    version: CONTENT_VERSION,
    isScanning: false,
    messageListener: null,
  };

  globalThis[GLOBAL_KEY] = state;

  const CollectorParser = {
    normalizeText(value) {
      return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    },

    sleep(milliseconds) {
      return new Promise((resolve) =>
        setTimeout(resolve, milliseconds)
      );
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
          parsed.hostname.endsWith(
            "avito.ru"
          ) &&
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

      const linkText =
        this.normalizeText(
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
      ].map((match) => match[0]);

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

        const typePattern =
          new RegExp(
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

        /(?:Липецкая область,?\s*)?городской округ Елец(?:\s*·\s*выезжает по городу)?/i,

        /(?:ул\.|улица|мкр-н|мкр\.|микрорайон|пер\.|переулок|ш\.|шоссе)\s*[А-ЯЁA-Zа-яёa-z0-9 .-]+(?:,\s*\d+[А-Яа-я0-9]*)?(?:\s*·\s*выезжает по городу)?/i,

        /[А-ЯЁA-Zа-яёa-z0-9 .-]+\s+(?:ул\.|улица|ш\.|шоссе),?\s*\d+[А-Яа-я0-9]*(?:\s*·\s*выезжает по городу)?/i,
      ];

      for (const pattern of patterns) {
        const match =
          text.match(pattern);

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
        const url =
          this.makeAbsoluteUrl(
            link.getAttribute("href")
          );

        if (!this.isRealAdUrl(url)) {
          continue;
        }

        const adId =
          this.getAdId(url);

        if (
          !adId ||
          seenIds.has(adId)
        ) {
          continue;
        }

        const card =
          this.findCardContainer(link);

        const text =
          this.normalizeText(
            card?.innerText ||
              link.innerText
          );

        if (
          text.length < 15 ||
          text.length > 2400
        ) {
          continue;
        }

        const title =
          this.getTitle(
            card,
            link
          );

        if (!title) {
          continue;
        }

        const ignoredTitles =
          new Set([
            "перевозки",
            "ремонт",
            "услуги",
            "все категории",
            "деловые услуги",
          ]);

        if (
          ignoredTitles.has(
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

          price:
            this.getPrice(text),

          rating:
            ratingData.rating,

          reviews:
            ratingData.reviews,

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

    addCardsToMap(
      cardMap,
      cards
    ) {
      for (const card of cards) {
        if (card?.adId) {
          cardMap.set(
            card.adId,
            card
          );
        }
      }
    },

    collectVisibleCards(
      cardMap
    ) {
      const cards =
        this.parsePage();

      this.addCardsToMap(
        cardMap,
        cards
      );

      return cards;
    },

    getLoadedAdIds() {
      const adIds =
        new Set();

      for (
        const link of
          document.querySelectorAll(
            "a[href]"
          )
      ) {
        const url =
          this.makeAbsoluteUrl(
            link.getAttribute("href")
          );

        if (!this.isRealAdUrl(url)) {
          continue;
        }

        const adId =
          this.getAdId(url);

        if (adId) {
          adIds.add(adId);
        }
      }

      return adIds;
    },

    hasNewIds(
      currentIds,
      previousIds
    ) {
      for (const adId of currentIds) {
        if (!previousIds.has(adId)) {
          return true;
        }
      }

      return false;
    },

    isElementVisible(element) {
      if (!element?.isConnected) {
        return false;
      }

      const style =
        window.getComputedStyle(
          element
        );

      const rect =
        element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(
          style.opacity || "1"
        ) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    },

    isDisabled(element) {
      return (
        element?.disabled === true ||
        element?.hasAttribute?.(
          "disabled"
        ) ||
        element?.getAttribute?.(
          "aria-disabled"
        ) === "true"
      );
    },

    isLoadMoreText(value) {
      const text =
        this.normalizeText(value);

      return (
        text.length > 0 &&
        text.length <= 120 &&
        /^(?:загрузить|показать)\s+ещ[её](?:\s+.*)?$/i.test(
          text
        )
      );
    },

    getClickableAncestor(element) {
      if (!element) {
        return null;
      }

      const selector = [
        "button",
        "a[href]",
        '[role="button"]',
        "[onclick]",
        '[tabindex]:not([tabindex="-1"])',
        '[data-marker*="load-more"]',
        '[data-marker*="show-more"]',
        '[data-marker*="more"]',
      ].join(",");

      const clickable =
        element.closest?.(
          selector
        );

      if (clickable) {
        return clickable;
      }

      let current = element;

      for (
        let level = 0;
        level < 6 && current;
        level += 1
      ) {
        const style =
          window.getComputedStyle(
            current
          );

        if (
          style.cursor === "pointer"
        ) {
          return current;
        }

        current =
          current.parentElement;
      }

      return element;
    },

    hasLoadMoreTextWithin(
      element
    ) {
      if (!element) {
        return false;
      }

      const ownText =
        this.normalizeText(
          element.textContent ||
            element.innerText
        );

      if (
        this.isLoadMoreText(ownText)
      ) {
        return true;
      }

      const descendants = [
        ...(
          element.querySelectorAll?.(
            "span, div, p"
          ) || []
        ),
      ];

      return descendants.some(
        (node) =>
          this.isLoadMoreText(
            node.textContent ||
              node.innerText
          )
      );
    },

    scoreLoadMoreCandidate(
      element
    ) {
      if (
        !element ||
        !this.hasLoadMoreTextWithin(
          element
        )
      ) {
        return -Infinity;
      }

      if (
        this.isDisabled(element) ||
        !this.isElementVisible(
          element
        )
      ) {
        return -Infinity;
      }

      let score = 0;

      const tagName =
        element.tagName
          ?.toLowerCase() || "";

      const marker =
        element.getAttribute?.(
          "data-marker"
        ) || "";

      const role =
        element.getAttribute?.(
          "role"
        ) || "";

      const text =
        this.normalizeText(
          element.textContent ||
            element.innerText
        );

      if (tagName === "button") {
        score += 8;
      }

      if (tagName === "a") {
        score += 5;
      }

      if (role === "button") {
        score += 5;
      }

      if (
        /load-more|show-more|more/i.test(
          marker
        )
      ) {
        score += 10;
      }

      if (
        /^загрузить\s+ещ[её]$/i.test(
          text
        )
      ) {
        score += 6;
      }

      if (text.length <= 30) {
        score += 2;
      }

      const rect =
        element.getBoundingClientRect();

      const centerDistance =
        Math.abs(
          rect.top +
            rect.height / 2 -
            window.innerHeight / 2
        );

      score -= Math.min(
        centerDistance / 1000,
        3
      );

      return score;
    },

    findLoadMoreButton() {
      const selectors = [
        '[data-marker*="load-more"]',
        '[data-marker*="show-more"]',
        'button[data-marker*="more"]',
        "button",
        '[role="button"]',
        "a[href]",
        "span",
        "div",
        "p",
      ];

      const rawCandidates = [
        ...document.querySelectorAll(
          selectors.join(",")
        ),
      ];

      const candidates =
        new Set();

      for (
        const rawCandidate of
          rawCandidates
      ) {
        const rawText =
          this.normalizeText(
            rawCandidate.textContent ||
              rawCandidate.innerText
          );

        if (
          !this.isLoadMoreText(
            rawText
          )
        ) {
          continue;
        }

        const clickable =
          this.getClickableAncestor(
            rawCandidate
          );

        if (clickable) {
          candidates.add(clickable);
        }
      }

      const ranked = [
        ...candidates,
      ]
        .map((element) => ({
          element,

          score:
            this.scoreLoadMoreCandidate(
              element
            ),
        }))
        .filter((candidate) =>
          Number.isFinite(
            candidate.score
          )
        )
        .sort(
          (first, second) =>
            second.score -
            first.score
        );

      return (
        ranked[0]?.element ||
        null
      );
    },

    getDocumentHeight() {
      return Math.max(
        document.body
          ?.scrollHeight || 0,

        document.documentElement
          ?.scrollHeight || 0
      );
    },

    async findLoadMoreWithRetries(
      attempts = 10
    ) {
      for (
        let attempt = 0;
        attempt < attempts;
        attempt += 1
      ) {
        const button =
          this.findLoadMoreButton();

        if (button) {
          return button;
        }

        window.scrollTo({
          top:
            this.getDocumentHeight(),

          behavior: "auto",
        });

        await this.sleep(
          attempt < 4
            ? 700
            : 1200
        );
      }

      return null;
    },

    resolveClickTarget(element) {
      if (!element?.isConnected) {
        return null;
      }

      const rect =
        element.getBoundingClientRect();

      const clientX =
        Math.max(
          0,
          Math.min(
            window.innerWidth - 1,
            rect.left +
              rect.width / 2
          )
        );

      const clientY =
        Math.max(
          0,
          Math.min(
            window.innerHeight - 1,
            rect.top +
              rect.height / 2
          )
        );

      const pointElement =
        document.elementFromPoint(
          clientX,
          clientY
        );

      if (
        pointElement &&
        (
          element.contains(
            pointElement
          ) ||
          pointElement.contains(
            element
          )
        )
      ) {
        return pointElement;
      }

      return element;
    },

    dispatchClickSequence(
      element
    ) {
      if (!element?.isConnected) {
        return false;
      }

      const eventTarget =
        this.resolveClickTarget(
          element
        ) || element;

      const rect =
        element.getBoundingClientRect();

      const clientX =
        Math.max(
          0,
          rect.left +
            rect.width / 2
        );

      const clientY =
        Math.max(
          0,
          rect.top +
            rect.height / 2
        );

      const commonOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons: 1,
      };

      try {
        element.focus?.({
          preventScroll: true,
        });
      } catch {
        element.focus?.();
      }

      try {
        if (
          typeof PointerEvent ===
          "function"
        ) {
          eventTarget.dispatchEvent(
            new PointerEvent(
              "pointerdown",
              {
                ...commonOptions,
                pointerId: 1,
                pointerType: "touch",
                isPrimary: true,
              }
            )
          );
        }

        eventTarget.dispatchEvent(
          new MouseEvent(
            "mousedown",
            commonOptions
          )
        );

        if (
          typeof PointerEvent ===
          "function"
        ) {
          eventTarget.dispatchEvent(
            new PointerEvent(
              "pointerup",
              {
                ...commonOptions,
                buttons: 0,
                pointerId: 1,
                pointerType: "touch",
                isPrimary: true,
              }
            )
          );
        }

        eventTarget.dispatchEvent(
          new MouseEvent(
            "mouseup",
            {
              ...commonOptions,
              buttons: 0,
            }
          )
        );

        element.click();

        return true;
      } catch {
        try {
          element.click();

          return true;
        } catch {
          return false;
        }
      }
    },

    async waitForNewAds({
      previousIds,
      previousCollectedCount,
      collectedCards,
      timeoutMilliseconds = 25000,
    }) {
      const startedAt =
        Date.now();

      let lastMutationAt =
        Date.now();

      const observer =
        new MutationObserver(() => {
          lastMutationAt =
            Date.now();
        });

      observer.observe(
        document.documentElement,
        {
          childList: true,
          subtree: true,
        }
      );

      try {
        while (
          Date.now() -
            startedAt <
          timeoutMilliseconds
        ) {
          await this.sleep(350);

          this.collectVisibleCards(
            collectedCards
          );

          const currentIds =
            this.getLoadedAdIds();

          const collectedCountIncreased =
            collectedCards.size >
            previousCollectedCount;

          const newDomIdsAppeared =
            this.hasNewIds(
              currentIds,
              previousIds
            );

          if (
            collectedCountIncreased ||
            newDomIdsAppeared
          ) {
            await this.sleep(900);

            this.collectVisibleCards(
              collectedCards
            );

            return true;
          }

          const noRecentMutations =
            Date.now() -
              lastMutationAt >
            6000;

          const minimumWaitPassed =
            Date.now() -
              startedAt >
            10000;

          if (
            noRecentMutations &&
            minimumWaitPassed
          ) {
            break;
          }
        }
      } finally {
        observer.disconnect();
      }

      return false;
    },

    async clickLoadMoreAndWait(
      collectedCards
    ) {
      let button =
        await this
          .findLoadMoreWithRetries();

      if (!button) {
        return {
          buttonFound: false,
          clicked: false,
          newAdsLoaded: false,
        };
      }

      const previousIds =
        this.getLoadedAdIds();

      const previousCollectedCount =
        collectedCards.size;

      button.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "nearest",
      });

      await this.sleep(650);

      button =
        this.findLoadMoreButton() ||
        button;

      if (
        !button?.isConnected ||
        this.isDisabled(button)
      ) {
        return {
          buttonFound: true,
          clicked: false,
          newAdsLoaded: false,
        };
      }

      const clicked =
        this.dispatchClickSequence(
          button
        );

      if (!clicked) {
        return {
          buttonFound: true,
          clicked: false,
          newAdsLoaded: false,
        };
      }

      const newAdsLoaded =
        await this.waitForNewAds({
          previousIds,
          previousCollectedCount,
          collectedCards,
        });

      return {
        buttonFound: true,
        clicked: true,
        newAdsLoaded,
      };
    },

    async recoverScrollPosition() {
      window.scrollBy({
        top:
          -Math.max(
            350,
            Math.floor(
              window.innerHeight *
                0.4
            )
          ),

        behavior: "auto",
      });

      await this.sleep(700);

      window.scrollTo({
        top:
          this.getDocumentHeight(),

        behavior: "auto",
      });

      await this.sleep(1300);
    },

    async loadAllAds(
      maxClicks = 100
    ) {
      const collectedCards =
        new Map();

      let clicks = 0;
      let successfulLoads = 0;
      let stalledAttempts = 0;
      let missingButtonAttempts = 0;

      this.collectVisibleCards(
        collectedCards
      );

      while (
        clicks < maxClicks
      ) {
        const result =
          await this
            .clickLoadMoreAndWait(
              collectedCards
            );

        if (
          !result.buttonFound
        ) {
          missingButtonAttempts += 1;

          if (
            missingButtonAttempts >= 3
          ) {
            break;
          }

          await this
            .recoverScrollPosition();

          continue;
        }

        missingButtonAttempts = 0;

        if (result.clicked) {
          clicks += 1;
        }

        if (
          result.newAdsLoaded
        ) {
          successfulLoads += 1;
          stalledAttempts = 0;

          await this.sleep(1000);

          continue;
        }

        stalledAttempts += 1;

        if (
          stalledAttempts >= 3
        ) {
          break;
        }

        await this
          .recoverScrollPosition();
      }

      this.collectVisibleCards(
        collectedCards
      );

      return {
        cards: [
          ...collectedCards.values(),
        ],

        loadResult: {
          clicks,
          successfulLoads,

          loadedAds:
            collectedCards.size,

          reachedLimit:
            clicks >= maxClicks,

          stalledAttempts,

          contentVersion:
            CONTENT_VERSION,
        },
      };
    },
  };

  state.messageListener = (
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

    if (state.isScanning) {
      sendResponse({
        success: false,

        error:
          "Сканирование уже выполняется. Дождитесь завершения.",
      });

      return;
    }

    state.isScanning = true;

    (async () => {
      const result =
        await CollectorParser
          .loadAllAds();

      sendResponse({
        success: true,

        cards:
          result.cards,

        loadResult:
          result.loadResult,
      });
    })()
      .catch((error) => {
        sendResponse({
          success: false,

          error:
            error?.message ||
            "Ошибка чтения страницы Авито.",
        });
      })
      .finally(() => {
        state.isScanning = false;
      });

    return true;
  };

  chrome.runtime.onMessage.addListener(
    state.messageListener
  );
})();
