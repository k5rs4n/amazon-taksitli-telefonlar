(() => {
  'use strict';

  const ALERT_VERSION = 1;

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeAlert(input = {}) {
    const targetPrice = finiteOrNull(input.targetPrice);
    const dropPercent = finiteOrNull(input.dropPercent);
    if (targetPrice !== null && targetPrice <= 0) throw new Error('targetPrice pozitif olmalı');
    if (dropPercent !== null && (dropPercent <= 0 || dropPercent > 100)) {
      throw new Error('dropPercent 0 ile 100 arasında olmalı');
    }
    if (!input.productId) throw new Error('productId gerekli');
    return {
      version: ALERT_VERSION,
      productId: String(input.productId),
      targetPrice,
      dropPercent,
      restock: Boolean(input.restock),
      enabled: input.enabled !== false,
      updatedAt: input.updatedAt || new Date().toISOString(),
      lastNotified: input.lastNotified && typeof input.lastNotified === 'object' ? { ...input.lastNotified } : {},
    };
  }

  function normalizePoints(points) {
    return (Array.isArray(points) ? points : [])
      .filter((point) => point && point.observedAt && Number.isFinite(Number(point.price)))
      .map((point) => ({ ...point, price: Number(point.price) }))
      .sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
  }

  function makeEvent(alert, type, latest, previous, details = {}) {
    const conditionKey = type === 'target_price'
      ? `${alert.productId}:${type}:${alert.targetPrice}`
      : `${alert.productId}:${type}:${latest.observedAt}`;
    return {
      key: conditionKey,
      type,
      productId: alert.productId,
      observedAt: latest.observedAt,
      currentPrice: latest.price,
      previousPrice: previous?.price ?? null,
      ...details,
    };
  }

  function evaluateAlert(input, points) {
    const alert = normalizeAlert(input);
    const normalized = normalizePoints(points);
    if (!alert.enabled || !normalized.length) return { alert, events: [] };
    const latest = normalized[normalized.length - 1];
    const previous = normalized[normalized.length - 2];
    const events = [];

    if (alert.targetPrice !== null && latest.price <= alert.targetPrice) {
      events.push(makeEvent(alert, 'target_price', latest, previous, {
        targetPrice: alert.targetPrice,
      }));
    }

    if (alert.dropPercent !== null && previous && previous.price > 0 && latest.price < previous.price) {
      const changePercent = Math.round(((latest.price - previous.price) / previous.price) * 10000) / 100;
      if (Math.abs(changePercent) >= alert.dropPercent) {
        events.push(makeEvent(alert, 'price_drop', latest, previous, {
          changePercent,
          dropPercent: alert.dropPercent,
        }));
      }
    }

    if (alert.restock && previous && previous.availability !== 'in_stock' && latest.availability === 'in_stock') {
      events.push(makeEvent(alert, 'restock', latest, previous));
    }

    return { alert, events };
  }

  function filterUnnotifiedEvents(events, notificationState = {}) {
    return (Array.isArray(events) ? events : []).filter((event) => !notificationState[event.key]);
  }

  function markNotified(notificationState = {}, events = []) {
    const next = { ...notificationState };
    const notifiedAt = new Date().toISOString();
    events.forEach((event) => {
      if (event?.key) next[event.key] = notifiedAt;
    });
    return next;
  }

  function eventMessage(event, productTitle = 'Ürün') {
    if (event.type === 'target_price') {
      return `${productTitle} hedef fiyatınıza ulaştı: ${formatPrice(event.currentPrice)}.`;
    }
    if (event.type === 'price_drop') {
      return `${productTitle} fiyatı ${formatPrice(event.currentPrice)} oldu (${formatSignedPercent(event.changePercent)}).`;
    }
    if (event.type === 'restock') {
      return `${productTitle} yeniden stokta: ${formatPrice(event.currentPrice)}.`;
    }
    return `${productTitle} için fiyat alarmı oluştu.`;
  }

  function formatPrice(value) {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(value);
  }

  function formatSignedPercent(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(value)}%`;
  }

  const api = {
    ALERT_VERSION,
    normalizeAlert,
    evaluateAlert,
    filterUnnotifiedEvents,
    markNotified,
    eventMessage,
  };
  if (typeof window !== 'undefined') window.AmazonPriceAlerts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
