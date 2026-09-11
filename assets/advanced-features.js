(() => {
  'use strict';

  const STORAGE_KEY = 'amazonTaksitliTelefonlar:favorites:v1';
  const ALERTS_STORAGE_KEY = 'amazonTaksitliTelefonlar:priceAlerts:v1';
  const HISTORY_URL = 'data/price-history.json';
  const LIVE_HISTORY_SOURCE = 'amazon-creators-api';
  const BROWSER_HISTORY_SOURCE = 'amazon-browser-visible';
  const DEFAULT_STALE_AFTER_HOURS = 24;
  const state = {
    favorites: new Set(),
    watchlist: new Set(),
    activeList: 'favorites',
    history: null,
    historyProductId: null,
    historyRange: 'all',
    alerts: {},
    alertNotifications: {},
    alertProductId: null,
    storage: null,
  };

  function getStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function loadState() {
    state.storage = getStorage();
    if (!state.storage) return;

    try {
      const saved = JSON.parse(state.storage.getItem(STORAGE_KEY) || '{}');
      state.favorites = new Set(Array.isArray(saved.favorites) ? saved.favorites.filter(Boolean) : []);
      state.watchlist = new Set(Array.isArray(saved.watchlist) ? saved.watchlist.filter(Boolean) : []);
    } catch (error) {
      state.favorites = new Set();
      state.watchlist = new Set();
    }

    try {
      const savedAlerts = JSON.parse(state.storage.getItem(ALERTS_STORAGE_KEY) || '{}');
      state.alerts = savedAlerts.alerts && typeof savedAlerts.alerts === 'object' ? savedAlerts.alerts : {};
      state.alertNotifications = savedAlerts.notifications && typeof savedAlerts.notifications === 'object'
        ? savedAlerts.notifications
        : {};
    } catch (error) {
      state.alerts = {};
      state.alertNotifications = {};
    }
  }

  function saveState() {
    if (!state.storage) return;
    try {
      state.storage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        favorites: [...state.favorites],
        watchlist: [...state.watchlist],
      }));
    } catch (error) {
      showToast('Favoriler bu tarayıcıda saklanamadı.');
    }
  }

  function saveAlerts() {
    if (!state.storage) return;
    try {
      state.storage.setItem(ALERTS_STORAGE_KEY, JSON.stringify({
        version: 1,
        alerts: state.alerts,
        notifications: state.alertNotifications,
      }));
    } catch (error) {
      showToast('Fiyat alarmı bu tarayıcıda saklanamadı.');
    }
  }

  function normalizeProduct(card) {
    const link = card.querySelector('a[href*="amazon.com.tr"]');
    const title = card.querySelector('.title')?.textContent.trim() || 'Ürün';
    const id = card.dataset.productId || extractProductId(link?.href || '') || slugify(title);
    return {
      id,
      card,
      title,
      price: Number(card.dataset.price || 0),
      brand: card.dataset.brand || '',
      url: link?.href || window.location.href,
      image: card.querySelector('img')?.src || '',
    };
  }

  function extractProductId(url) {
    const match = String(url).match(/\/dp\/([A-Z0-9]{8,})/i);
    return match ? match[1].toUpperCase() : '';
  }

  function slugify(value) {
    return String(value)
      .toLocaleLowerCase('tr-TR')
      .replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  }

  function getProducts() {
    return [...document.querySelectorAll('.list-group-numbered > li')]
      .map(normalizeProduct)
      .filter((product) => product.id);
  }

  function createButton(label, action, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn-sm btn-outline-secondary advanced-feature-button ${className}`.trim();
    button.dataset.featureAction = action;
    button.textContent = label;
    return button;
  }

  function createToolbar() {
    const toolbar = document.createElement('section');
    toolbar.className = 'advanced-feature-toolbar';
    toolbar.setAttribute('aria-label', 'Kişisel liste araçları');

    const favoritesButton = createButton('Favorilerim (0)', 'toggle-favorites-panel');
    const watchlistButton = createButton('İzleme listem (0)', 'toggle-watchlist-panel');
    const alertsButton = createButton('Fiyat alarmları (0)', 'toggle-alert-panel');
    const notificationButton = createButton('Bildirimleri aç', 'request-notification-permission');
    const shareButton = createButton('Sayfayı paylaş', 'share-page');
    const summary = document.createElement('p');
    summary.className = 'advanced-feature-summary';
    summary.dataset.featureRole = 'summary';
    summary.textContent = 'Favoriler bu tarayıcıda saklanır.';

    toolbar.append(favoritesButton, watchlistButton, alertsButton, notificationButton, shareButton, summary);
    return toolbar;
  }

  function createSavedPanel() {
    const panel = document.createElement('section');
    panel.id = 'advanced-saved-panel';
    panel.className = 'advanced-feature-panel';
    panel.hidden = true;
    panel.setAttribute('aria-live', 'polite');

    const header = document.createElement('div');
    header.className = 'advanced-feature-panel-header';
    const title = document.createElement('h2');
    title.dataset.featureRole = 'saved-title';
    const closeButton = createButton('Kapat', 'close-saved-panel');
    header.append(title, closeButton);

    const list = document.createElement('ul');
    list.id = 'advanced-saved-list';
    list.className = 'advanced-feature-list';

    panel.append(header, list);
    return panel;
  }

  function createAlertPanel() {
    const panel = document.createElement('section');
    panel.id = 'advanced-alert-panel';
    panel.className = 'advanced-feature-panel advanced-alert-panel price-alert';
    panel.hidden = true;
    panel.setAttribute('aria-live', 'polite');

    const header = document.createElement('div');
    header.className = 'advanced-feature-panel-header';
    const title = document.createElement('h2');
    title.dataset.featureRole = 'alert-title';
    const closeButton = createButton('Kapat', 'close-alert-panel');
    header.append(title, closeButton);

    const form = document.createElement('form');
    form.dataset.featureRole = 'alert-form';
    form.className = 'advanced-alert-form';

    const targetLabel = document.createElement('label');
    targetLabel.textContent = 'Hedef fiyat (TL)';
    const targetInput = document.createElement('input');
    targetInput.type = 'number';
    targetInput.min = '1';
    targetInput.step = '0.01';
    targetInput.inputMode = 'decimal';
    targetInput.dataset.alertField = 'targetPrice';
    targetInput.placeholder = 'Örn. 12999';
    targetLabel.appendChild(targetInput);

    const dropLabel = document.createElement('label');
    dropLabel.textContent = 'Düşüş alarmı (%)';
    const dropInput = document.createElement('input');
    dropInput.type = 'number';
    dropInput.min = '0.1';
    dropInput.max = '100';
    dropInput.step = '0.1';
    dropInput.inputMode = 'decimal';
    dropInput.dataset.alertField = 'dropPercent';
    dropInput.placeholder = 'Örn. 10';
    dropLabel.appendChild(dropInput);

    const restockLabel = document.createElement('label');
    restockLabel.className = 'advanced-alert-checkbox';
    const restockInput = document.createElement('input');
    restockInput.type = 'checkbox';
    restockInput.dataset.alertField = 'restock';
    restockLabel.append(restockInput, document.createTextNode(' Stok yeniden gelince bildir'));

    const saveButton = createButton('Alarmı kaydet', 'save-alert');
    saveButton.type = 'submit';
    const disableButton = createButton('Alarmı kapat', 'disable-alert');
    disableButton.dataset.featureRole = 'disable-alert';
    const permissionButton = createButton('Tarayıcı bildirimlerini aç', 'request-notification-permission');
    permissionButton.dataset.featureRole = 'alert-permission';
    const status = document.createElement('p');
    status.className = 'advanced-alert-status';
    status.dataset.featureRole = 'alert-status';

    form.append(targetLabel, dropLabel, restockLabel, saveButton, disableButton, permissionButton, status);
    panel.append(header, form);
    return panel;
  }

  function createHistoryPanel() {
    const panel = document.createElement('section');
    panel.id = 'advanced-history-panel';
    panel.className = 'advanced-feature-panel';
    panel.hidden = true;
    panel.setAttribute('aria-live', 'polite');

    const header = document.createElement('div');
    header.className = 'advanced-feature-panel-header';
    const title = document.createElement('h2');
    title.dataset.featureRole = 'history-title';
    const closeButton = createButton('Kapat', 'close-history-panel');
    header.append(title, closeButton);

    const meta = document.createElement('p');
    meta.className = 'advanced-history-meta';
    meta.dataset.featureRole = 'history-meta';

    const rangeControls = document.createElement('div');
    rangeControls.className = 'advanced-history-range-controls';
    rangeControls.setAttribute('role', 'group');
    rangeControls.setAttribute('aria-label', 'Grafik tarih aralığı');
    [
      ['7', '7 gün'],
      ['30', '30 gün'],
      ['all', 'Tümü'],
    ].forEach(([value, label]) => {
      const button = createButton(label, 'set-history-range');
      button.dataset.historyRange = value;
      button.dataset.historyRangeControl = value;
      rangeControls.appendChild(button);
    });

    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'advanced-history-summary-grid';
    summaryGrid.dataset.featureRole = 'history-summary';

    const chart = document.createElement('div');
    chart.dataset.featureRole = 'history-chart';

    const tooltip = document.createElement('div');
    tooltip.className = 'advanced-history-tooltip';
    tooltip.dataset.featureRole = 'history-tooltip';
    tooltip.hidden = true;
    tooltip.setAttribute('role', 'status');

    const note = document.createElement('p');
    note.className = 'advanced-history-note';
    note.dataset.featureRole = 'history-note';

    panel.append(header, meta, rangeControls, summaryGrid, chart, tooltip, note);
    return panel;
  }

  function createToast() {
    const toast = document.createElement('div');
    toast.className = 'advanced-feature-toast';
    toast.hidden = true;
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
    return toast;
  }

  let toast;
  let products = [];
  let savedPanel;
  let alertPanel;
  let historyPanel;

  function getHistoryAnalysis() {
    return window.AmazonHistoryAnalysis;
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => {
      toast.hidden = true;
    }, 2800);
  }

  function formatPrice(value) {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      maximumFractionDigits: 2,
    }).format(value);
  }

  function formatObservedAt(value) {
    if (!value) return 'bilinmeyen zaman';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'bilinmeyen zaman';
    return new Intl.DateTimeFormat('tr-TR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function formatSignedPrice(value) {
    if (value === null || value === undefined) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${formatPrice(value)}`;
  }

  function formatSignedPercent(value) {
    if (value === null || value === undefined) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(value)}%`;
  }

  function formatAvailability(value) {
    const labels = {
      in_stock: 'Stokta',
      out_of_stock: 'Stokta yok',
      preorder: 'Ön sipariş',
      unknown: 'Stok bilgisi yok',
    };
    return labels[value] || value || 'Stok bilgisi yok';
  }

  function trendClass(trend) {
    return trend === 'down' ? 'is-down' : trend === 'up' ? 'is-up' : trend === 'flat' ? 'is-flat' : 'is-insufficient';
  }

  function createHistorySummary(summary) {
    const grid = document.createElement('div');
    grid.className = 'advanced-history-summary-grid';
    const cards = [
      ['Güncel fiyat', summary.latest ? formatPrice(summary.latest.price) : '—', 'latest'],
      ['Değişim', summary.changePercent === null ? '—' : `${formatSignedPrice(summary.changeValue)} (${formatSignedPercent(summary.changePercent)})`, 'change'],
      ['Ortalama', summary.average === null ? '—' : formatPrice(summary.average), 'average'],
      ['En düşük', summary.minimum ? formatPrice(summary.minimum.price) : '—', 'minimum'],
      ['En yüksek', summary.maximum ? formatPrice(summary.maximum.price) : '—', 'maximum'],
      ['Gözlem', `${summary.count} kayıt`, 'count'],
    ];
    cards.forEach(([label, value, kind]) => {
      const card = document.createElement('div');
      card.className = `advanced-history-summary-card is-${kind}`;
      const labelElement = document.createElement('span');
      labelElement.className = 'advanced-history-summary-label';
      labelElement.textContent = label;
      const valueElement = document.createElement('strong');
      valueElement.className = 'advanced-history-summary-value';
      valueElement.textContent = value;
      card.append(labelElement, valueElement);
      grid.appendChild(card);
    });
    const trend = document.createElement('div');
    trend.className = `advanced-history-trend ${trendClass(summary.trend)}`;
    trend.dataset.featureRole = 'history-trend';
    trend.textContent = `${summary.trendLabel} · ${summary.confidenceLabel}`;
    grid.appendChild(trend);
    return grid;
  }

  function getHistoryStatus(history) {
    if (history?.source === 'fixture') {
      return { kind: 'fixture', fresh: true, ageHours: null, limitHours: null };
    }
    if (![LIVE_HISTORY_SOURCE, BROWSER_HISTORY_SOURCE].includes(history?.source) || !history.generatedAt) {
      return { kind: 'unverified', fresh: false, ageHours: null, limitHours: null };
    }
    const generatedAt = new Date(history.generatedAt);
    const ageHours = (Date.now() - generatedAt.getTime()) / 3600000;
    const limitHours = Number(history.staleAfterHours || DEFAULT_STALE_AFTER_HOURS);
    return {
      kind: 'live',
      fresh: Number.isFinite(ageHours) && ageHours >= -0.1 && ageHours <= limitHours,
      ageHours,
      limitHours,
    };
  }

  function updateDashboardStats() {
    const productCount = document.getElementById('dashboard-stat-products');
    const lowestPrice = document.getElementById('dashboard-stat-lowest');
    const alertCount = document.getElementById('dashboard-stat-alerts');
    const listCount = document.getElementById('dashboard-stat-lists');
    const resultSummary = document.getElementById('dashboard-result-summary');
    if (productCount) productCount.textContent = String(products.length);
    if (lowestPrice) {
      const prices = products.map((product) => product.price).filter((price) => Number.isFinite(price) && price > 0);
      lowestPrice.textContent = prices.length ? formatPrice(Math.min(...prices)) : '—';
    }
    if (alertCount) alertCount.textContent = String(Object.values(state.alerts).filter((alert) => alert?.enabled).length);
    if (listCount) listCount.textContent = String(state.favorites.size + state.watchlist.size);
    if (resultSummary) resultSummary.textContent = `${products.length} ürün · filtreleri kullanarak listeyi daralt`;
  }

  function updateToolbar() {
    const favoritesButton = document.querySelector('[data-feature-action="toggle-favorites-panel"]');
    const watchlistButton = document.querySelector('[data-feature-action="toggle-watchlist-panel"]');
    const alertsButton = document.querySelector('[data-feature-action="toggle-alert-panel"]');
    const notificationButton = document.querySelector('[data-feature-action="request-notification-permission"]');
    if (favoritesButton) favoritesButton.textContent = `Favorilerim (${state.favorites.size})`;
    if (watchlistButton) watchlistButton.textContent = `İzleme listem (${state.watchlist.size})`;
    if (alertsButton) alertsButton.textContent = `Fiyat alarmları (${Object.values(state.alerts).filter((alert) => alert?.enabled).length})`;
    if (notificationButton) {
      notificationButton.textContent = typeof Notification === 'undefined'
        ? 'Bildirim desteklenmiyor'
        : Notification.permission === 'granted' ? 'Bildirimler açık' : 'Bildirimleri aç';
      notificationButton.disabled = typeof Notification === 'undefined' || Notification.permission === 'granted';
    }
    updateDashboardStats();
  }

  function getPriceAlerts() {
    return window.AmazonPriceAlerts;
  }

  function renderAlertPanel() {
    if (!alertPanel || !state.alertProductId) return;
    const product = products.find((candidate) => candidate.id === state.alertProductId);
    if (!product) return;
    const alert = state.alerts[product.id] || {};
    const title = alertPanel.querySelector('[data-feature-role="alert-title"]');
    const target = alertPanel.querySelector('[data-alert-field="targetPrice"]');
    const drop = alertPanel.querySelector('[data-alert-field="dropPercent"]');
    const restock = alertPanel.querySelector('[data-alert-field="restock"]');
    const disable = alertPanel.querySelector('[data-feature-role="disable-alert"]');
    const permissionButton = alertPanel.querySelector('[data-feature-role="alert-permission"]');
    const status = alertPanel.querySelector('[data-feature-role="alert-status"]');
    title.textContent = `Fiyat alarmı: ${product.title}`;
    target.value = alert.targetPrice ?? '';
    drop.value = alert.dropPercent ?? '';
    restock.checked = Boolean(alert.restock);
    disable.disabled = !alert.enabled;
    if (permissionButton) {
      permissionButton.disabled = typeof Notification === 'undefined' || Notification.permission === 'granted';
    }
    status.textContent = alert.enabled
      ? 'Alarm bu tarayıcıda saklanır ve fiyat geçmişi yenilendiğinde kontrol edilir.'
      : 'Bu ürün için aktif alarm yok.';
  }

  function toggleAlertPanel(productId) {
    if (historyPanel) historyPanel.hidden = true;
    if (savedPanel) savedPanel.hidden = true;
    if (productId) state.alertProductId = productId;
    if (!state.alertProductId) {
      const firstAlert = Object.keys(state.alerts).find((id) => state.alerts[id]?.enabled);
      state.alertProductId = firstAlert || products[0]?.id;
    }
    if (!state.alertProductId || !alertPanel) return;
    alertPanel.hidden = false;
    renderAlertPanel();
    alertPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') {
      showToast('Bu tarayıcı bildirimleri desteklemiyor.');
      return;
    }
    if (Notification.permission === 'granted') {
      showToast('Tarayıcı bildirimleri zaten açık.');
      return;
    }
    if (Notification.permission === 'denied') {
      showToast('Bildirim izni tarayıcı ayarlarından engellenmiş.');
      return;
    }
    const permission = await Notification.requestPermission();
    updateToolbar();
    if (alertPanel) {
      const permissionButton = alertPanel.querySelector('[data-feature-role="alert-permission"]');
      if (permissionButton) permissionButton.disabled = permission === 'granted';
    }
    showToast(permission === 'granted' ? 'Tarayıcı bildirimleri açıldı.' : 'Bildirim izni verilmedi.');
  }

  function readAlertForm() {
    const target = alertPanel.querySelector('[data-alert-field="targetPrice"]').value;
    const drop = alertPanel.querySelector('[data-alert-field="dropPercent"]').value;
    return {
      productId: state.alertProductId,
      targetPrice: target === '' ? null : Number(target),
      dropPercent: drop === '' ? null : Number(drop),
      restock: alertPanel.querySelector('[data-alert-field="restock"]').checked,
      enabled: true,
    };
  }

  function saveAlertFromPanel() {
    const api = getPriceAlerts();
    if (!api || !alertPanel) return;
    const formData = readAlertForm();
    const status = alertPanel.querySelector('[data-feature-role="alert-status"]');
    if (formData.targetPrice === null && formData.dropPercent === null && !formData.restock) {
      status.textContent = 'En az bir alarm koşulu seçin.';
      return;
    }
    try {
      state.alerts[state.alertProductId] = api.normalizeAlert(formData);
      saveAlerts();
      updateToolbar();
      renderAlertPanel();
      showToast('Fiyat alarmı kaydedildi.');
    } catch (error) {
      status.textContent = `Alarm kaydedilemedi: ${error.message}`;
    }
  }

  function disableAlert() {
    if (!state.alertProductId) return;
    delete state.alerts[state.alertProductId];
    saveAlerts();
    updateToolbar();
    renderAlertPanel();
    showToast('Fiyat alarmı kapatıldı.');
  }

  function updateCardButtons() {
    products.forEach((product) => {
      const favoriteButton = product.card.querySelector('[data-feature-action="toggle-favorite"]');
      const watchButton = product.card.querySelector('[data-feature-action="toggle-watchlist"]');
      if (favoriteButton) {
        const active = state.favorites.has(product.id);
        favoriteButton.textContent = active ? 'Favoriden çıkar' : 'Favoriye ekle';
        favoriteButton.classList.toggle('is-active', active);
        favoriteButton.setAttribute('aria-pressed', String(active));
      }
      if (watchButton) {
        const active = state.watchlist.has(product.id);
        watchButton.textContent = active ? 'İzlemeyi bırak' : 'İzlemeye al';
        watchButton.classList.toggle('is-active', active);
        watchButton.setAttribute('aria-pressed', String(active));
      }
    });
    updateToolbar();
  }

  function createSavedListItem(product) {
    const item = document.createElement('li');
    item.className = 'advanced-feature-list-item';

    const title = document.createElement('p');
    title.className = 'advanced-feature-list-item-title';
    title.textContent = `${product.title} — ${formatPrice(product.price)}`;

    const actions = document.createElement('div');
    actions.className = 'advanced-feature-list-item-actions';
    const openButton = createButton('Ürüne git', 'open-product');
    openButton.dataset.productId = product.id;
    openButton.dataset.productUrl = product.url;
    const historyButton = createButton('Fiyat geçmişi', 'show-history');
    historyButton.dataset.productId = product.id;
    const alertButton = createButton('Fiyat alarmı', 'toggle-alert-panel');
    alertButton.dataset.productId = product.id;
    const removeButton = createButton('Listeden çıkar', 'remove-saved');
    removeButton.dataset.productId = product.id;
    actions.append(openButton, historyButton, alertButton, removeButton);

    item.append(title, actions);
    return item;
  }

  function renderSavedList() {
    if (!savedPanel) return;
    const title = savedPanel.querySelector('[data-feature-role="saved-title"]');
    const list = savedPanel.querySelector('#advanced-saved-list');
    const activeIds = state.activeList === 'favorites' ? state.favorites : state.watchlist;
    const label = state.activeList === 'favorites' ? 'Favorilerim' : 'İzleme listem';
    title.textContent = label;
    list.replaceChildren();

    const selected = products.filter((product) => activeIds.has(product.id));
    if (!selected.length) {
      const empty = document.createElement('li');
      empty.className = 'advanced-feature-list-item';
      empty.textContent = state.activeList === 'favorites'
        ? 'Henüz favori ürün eklemediniz.'
        : 'Henüz izleme listenize ürün eklemediniz.';
      list.appendChild(empty);
      return;
    }

    selected.forEach((product) => list.appendChild(createSavedListItem(product)));
  }

  function toggleSavedPanel(listName) {
    state.activeList = listName;
    if (historyPanel) historyPanel.hidden = true;
    if (alertPanel) alertPanel.hidden = true;
    savedPanel.hidden = false;
    renderSavedList();
    savedPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function toggleSet(set, id) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
    saveState();
    updateCardButtons();
    renderSavedList();
  }

  function addCardButtons(product) {
    const actions = document.createElement('div');
    actions.className = 'advanced-feature-list-item-actions';
    const favoriteButton = createButton('', 'toggle-favorite');
    favoriteButton.dataset.productId = product.id;
    const watchButton = createButton('', 'toggle-watchlist');
    watchButton.dataset.productId = product.id;
    const historyButton = createButton('Geçmiş', 'show-history');
    historyButton.dataset.productId = product.id;
    const alertButton = createButton('Alarm', 'toggle-alert-panel');
    alertButton.dataset.productId = product.id;
    const shareButton = createButton('Paylaş', 'share-product');
    shareButton.dataset.productId = product.id;
    actions.append(favoriteButton, watchButton, historyButton, alertButton, shareButton);
    product.card.appendChild(actions);
  }

  function getHistoryPoints(productId) {
    const record = state.history?.products?.[productId];
    if (!record || !Array.isArray(record.points)) return [];
    return record.points
      .filter((point) => Number.isFinite(Number(point.price)) && point.observedAt)
      .map((point) => ({ ...point, price: Number(point.price) }))
      .sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
  }

  function createChart(points, summary, tooltip) {
    const width = 720;
    const height = 260;
    const padding = { top: 22, right: 22, bottom: 42, left: 78 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const prices = points.map((point) => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || Math.max(max * 0.02, 1);
    const x = (index) => padding.left + (index / Math.max(points.length - 1, 1)) * chartWidth;
    const y = (price) => padding.top + (1 - (price - min) / range) * chartHeight;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('advanced-history-chart');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Fiyat geçmişi grafiği; noktaların üzerine gelerek ayrıntıları görün');

    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grid.classList.add('advanced-history-grid');
    [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const lineY = padding.top + ratio * chartHeight;
      line.setAttribute('x1', padding.left);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y1', lineY);
      line.setAttribute('y2', lineY);
      grid.appendChild(line);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.classList.add('advanced-history-axis-label');
      label.setAttribute('x', 4);
      label.setAttribute('y', lineY + 4);
      label.textContent = formatPrice(max - ratio * range);
      svg.appendChild(label);
    });
    svg.appendChild(grid);

    const linePath = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.price)}`).join(' ');
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.classList.add('advanced-history-area');
    area.setAttribute('d', `${linePath} L ${x(points.length - 1)} ${padding.top + chartHeight} L ${x(0)} ${padding.top + chartHeight} Z`);
    svg.appendChild(area);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('advanced-history-line', `is-${summary.trend}`);
    path.setAttribute('d', linePath);
    svg.appendChild(path);

    if (summary.average !== null) {
      const averageLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      averageLine.classList.add('advanced-history-average-line');
      averageLine.setAttribute('x1', padding.left);
      averageLine.setAttribute('x2', width - padding.right);
      averageLine.setAttribute('y1', y(summary.average));
      averageLine.setAttribute('y2', y(summary.average));
      averageLine.setAttribute('aria-label', `Ortalama ${formatPrice(summary.average)}`);
      svg.appendChild(averageLine);
    }

    points.forEach((point, index) => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.classList.add('advanced-history-point-group');
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', `${formatObservedAt(point.observedAt)}: ${formatPrice(point.price)}`);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.classList.add('advanced-history-point');
      circle.setAttribute('cx', x(index));
      circle.setAttribute('cy', y(point.price));
      circle.setAttribute('r', index === points.length - 1 ? 5 : 4);
      group.appendChild(circle);

      const showTooltip = () => {
        if (!tooltip) return;
        tooltip.hidden = false;
        tooltip.textContent = `${formatObservedAt(point.observedAt)} · ${formatPrice(point.price)}${point.seller ? ` · ${point.seller}` : ''}${point.availability ? ` · ${formatAvailability(point.availability)}` : ''}`;
      };
      const hideTooltip = () => {
        if (tooltip) tooltip.hidden = true;
      };
      group.addEventListener('mouseenter', showTooltip);
      group.addEventListener('focus', showTooltip);
      group.addEventListener('mouseleave', hideTooltip);
      group.addEventListener('blur', hideTooltip);
      svg.appendChild(group);

      if (index === 0 || index === points.length - 1 || point === summary.minimum || point === summary.maximum) {
        const date = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        date.classList.add('advanced-history-axis-label');
        date.setAttribute('x', x(index));
        date.setAttribute('y', height - 12);
        date.setAttribute('text-anchor', index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle');
        date.textContent = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit' }).format(new Date(point.observedAt));
        svg.appendChild(date);
      }
    });

    return svg;
  }

  async function loadHistory() {
    if (state.history) return state.history;
    try {
      const response = await fetch(HISTORY_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error('Fiyat geçmişi yüklenemedi');
      state.history = await response.json();
      return state.history;
    } catch (error) {
      state.history = { products: {} };
      return state.history;
    }
  }

  function notifyAlertEvent(event, product) {
    const api = getPriceAlerts();
    const message = api ? api.eventMessage(event, product?.title || 'Ürün') : 'Fiyat alarmı oluştu.';
    showToast(message);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Amazon fiyat alarmı', {
          body: message,
          tag: event.key,
          icon: product?.image || undefined,
        });
      } catch (error) {
        // Browser notifications are optional; the in-page toast remains available.
      }
    }
  }

  function evaluateStoredAlerts() {
    const api = getPriceAlerts();
    if (!api || !state.history) return;
    const historyStatus = getHistoryStatus(state.history);
    if (historyStatus.kind === 'live' && !historyStatus.fresh) return;
    let changed = false;
    Object.values(state.alerts).forEach((rawAlert) => {
      if (!rawAlert?.enabled) return;
      const product = products.find((candidate) => candidate.id === rawAlert.productId);
      const points = getHistoryPoints(rawAlert.productId);
      if (!product || !points.length) return;
      try {
        const result = api.evaluateAlert(rawAlert, points);
        if (rawAlert.targetPrice !== null && rawAlert.targetPrice !== undefined) {
          const latest = points[points.length - 1];
          const targetKey = `${rawAlert.productId}:target_price:${rawAlert.targetPrice}`;
          if (latest.price > Number(rawAlert.targetPrice) && state.alertNotifications[targetKey]) {
            delete state.alertNotifications[targetKey];
            changed = true;
          }
        }
        const events = api.filterUnnotifiedEvents(result.events, state.alertNotifications);
        if (!events.length) return;
        state.alertNotifications = api.markNotified(state.alertNotifications, events);
        changed = true;
        events.forEach((event) => notifyAlertEvent(event, product));
      } catch (error) {
        // Invalid stored alarms are ignored instead of blocking the page.
      }
    });
    if (changed) saveAlerts();
  }

  function renderHistoryPanel() {
    const product = products.find((candidate) => candidate.id === state.historyProductId);
    if (!product || !historyPanel || !state.history) return;
    const history = state.history;
    const allPoints = getHistoryPoints(product.id);
    const analysis = getHistoryAnalysis();
    const points = analysis
      ? analysis.filterPointsByPeriod(allPoints, state.historyRange)
      : allPoints;
    const summary = analysis ? analysis.summarizePoints(points) : { count: points.length, trend: 'insufficient', trendLabel: 'Veri yetersiz', confidenceLabel: 'Düşük güven' };
    const historyStatus = getHistoryStatus(history);
    const title = historyPanel.querySelector('[data-feature-role="history-title"]');
    const meta = historyPanel.querySelector('[data-feature-role="history-meta"]');
    const summaryContainer = historyPanel.querySelector('[data-feature-role="history-summary"]');
    const chart = historyPanel.querySelector('[data-feature-role="history-chart"]');
    const tooltip = historyPanel.querySelector('[data-feature-role="history-tooltip"]');
    const note = historyPanel.querySelector('[data-feature-role="history-note"]');
    const rangeButtons = historyPanel.querySelectorAll('[data-history-range-control]');
    title.textContent = `Fiyat geçmişi: ${product.title}`;
    rangeButtons.forEach((button) => {
      const active = button.dataset.historyRangeControl === state.historyRange;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    chart.replaceChildren();
    summaryContainer.replaceChildren();
    if (tooltip) tooltip.hidden = true;
    if (!allPoints.length) {
      meta.textContent = 'Bu ürün için henüz geçmiş verisi yok.';
      note.textContent = '';
      return;
    }
    if (!points.length) {
      meta.textContent = `${state.historyRange} günlük dönemde veri yok.`;
      note.textContent = 'Daha geniş bir tarih aralığı seçerek geçmiş gözlemleri görebilirsiniz.';
      return;
    }
    if (historyStatus.kind === 'live' && !historyStatus.fresh) {
      const latest = points[points.length - 1];
      meta.textContent = `Son kayıt: ${formatPrice(latest.price)} · Güncel değil`;
      note.textContent = `Canlı ${history.source === BROWSER_HISTORY_SOURCE ? 'Amazon görünür ürün sayfası' : 'Amazon Creators API'} verisi ${formatObservedAt(history.generatedAt)} tarihinde güncellendi; ${historyStatus.limitHours} saatlik güncellik süresi aşıldı. Güncel fiyat için ürün sayfasını kontrol edin.`;
      return;
    }
    if (historyStatus.kind === 'unverified') {
      meta.textContent = 'Fiyat geçmişi kaynağı doğrulanamadı.';
      note.textContent = 'Bu veri canlı fiyat gibi gösterilmiyor. Güncel fiyat için ürün sayfasını kontrol edin.';
      return;
    }
    meta.textContent = `${state.historyRange === 'all' ? 'Tüm geçmiş' : `Son ${state.historyRange} gün`} · ${summary.count} gözlem · ${summary.trendLabel}`;
    summaryContainer.appendChild(createHistorySummary(summary));
    chart.appendChild(createChart(points, summary, tooltip));
    if (summary.latestVsAverageValue !== null) {
      const direction = summary.latestVsAverageValue === 0
        ? 'aynı seviyede'
        : summary.latestVsAverageValue < 0 ? 'altında' : 'üstünde';
      note.textContent = historyStatus.kind === 'fixture'
        ? 'Not: Bu grafik örnek fixture verisidir; canlı Amazon fiyatı değildir.'
        : direction === 'aynı seviyede'
          ? `Kaynak: ${history.source === BROWSER_HISTORY_SOURCE ? 'Amazon görünür ürün sayfası' : 'Amazon Creators API'} · Güncel fiyat dönem ortalamasıyla aynı seviyede. Son güncelleme: ${formatObservedAt(history.generatedAt)}. Satın alma öncesinde Amazon sayfasında doğrulayın.`
          : `Kaynak: ${history.source === BROWSER_HISTORY_SOURCE ? 'Amazon görünür ürün sayfası' : 'Amazon Creators API'} · Güncel fiyat, dönem ortalamasının ${formatPrice(Math.abs(summary.latestVsAverageValue))} ${direction}. Son güncelleme: ${formatObservedAt(history.generatedAt)}. Satın alma öncesinde Amazon sayfasında doğrulayın.`;
    } else {
      note.textContent = 'Trend oluşturmak için en az iki fiyat gözlemi gerekir. Satın alma öncesinde Amazon sayfasında doğrulayın.';
    }
  }

  async function showHistory(productId) {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product || !historyPanel) return;
    state.historyProductId = productId;
    state.historyRange = 'all';
    await loadHistory();
    renderHistoryPanel();
    historyPanel.hidden = false;
    if (savedPanel) savedPanel.hidden = true;
    if (alertPanel) alertPanel.hidden = true;
    historyPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function shareUrl(url, title) {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Ürün bağlantısı panoya kopyalandı.');
        return;
      } catch (error) {
        // Clipboard permission can be denied; the visible URL remains available below.
      }
    }
    showToast(`Bağlantı: ${url}`);
  }

  function shareProduct(productId) {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) return;
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('product', product.id);
    shareUrl(url.toString(), product.title);
  }

  function sharePage() {
    shareUrl(window.location.href, document.title);
  }

  function openProduct(productId, url) {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const product = products.find((candidate) => candidate.id === productId);
    if (product) window.open(product.url, '_blank', 'noopener,noreferrer');
  }

  function removeSaved(productId) {
    state.favorites.delete(productId);
    state.watchlist.delete(productId);
    saveState();
    updateCardButtons();
    renderSavedList();
    showToast('Ürün kişisel listelerden çıkarıldı.');
  }

  function handleAction(event) {
    const actionTarget = event.target.closest('[data-feature-action]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.featureAction;
    const productId = actionTarget.dataset.productId;
    if (action === 'save-alert') event.preventDefault();

    if (action === 'toggle-favorites-panel') toggleSavedPanel('favorites');
    else if (action === 'toggle-watchlist-panel') toggleSavedPanel('watchlist');
    else if (action === 'close-saved-panel') savedPanel.hidden = true;
    else if (action === 'close-history-panel') historyPanel.hidden = true;
    else if (action === 'close-alert-panel') alertPanel.hidden = true;
    else if (action === 'toggle-favorite') toggleSet(state.favorites, productId);
    else if (action === 'toggle-watchlist') toggleSet(state.watchlist, productId);
    else if (action === 'remove-saved') removeSaved(productId);
    else if (action === 'show-history') showHistory(productId);
    else if (action === 'toggle-alert-panel') toggleAlertPanel(productId);
    else if (action === 'save-alert') saveAlertFromPanel();
    else if (action === 'disable-alert') disableAlert();
    else if (action === 'request-notification-permission') requestNotificationPermission();
    else if (action === 'set-history-range') {
      state.historyRange = actionTarget.dataset.historyRange || 'all';
      renderHistoryPanel();
    }
    else if (action === 'share-product') shareProduct(productId);
    else if (action === 'share-page') sharePage();
    else if (action === 'open-product') openProduct(productId, actionTarget.dataset.productUrl);
  }

  function focusDeepLinkedProduct() {
    const productId = new URLSearchParams(window.location.search).get('product');
    if (!productId) return;
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) return;
    product.card.classList.add('advanced-feature-deep-link');
    product.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => product.card.classList.remove('advanced-feature-deep-link'), 2500);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {
      showToast('Çevrimdışı uygulama kaydı bu tarayıcıda kullanılamadı.');
    });
  }

  function init() {
    const list = document.querySelector('.list-group-numbered');
    if (!list) return;
    products = getProducts();
    if (!products.length) return;

    loadState();
    products.forEach(addCardButtons);
    const toolbar = createToolbar();
    savedPanel = createSavedPanel();
    alertPanel = createAlertPanel();
    historyPanel = createHistoryPanel();
    toast = createToast();
    list.parentElement.insertBefore(toolbar, list);
    list.parentElement.insertBefore(savedPanel, list);
    list.parentElement.insertBefore(alertPanel, list);
    list.parentElement.insertBefore(historyPanel, list);
    alertPanel.querySelector('[data-feature-role="alert-form"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveAlertFromPanel();
    });
    document.addEventListener('click', handleAction);
    window.addEventListener('storage', () => {
      loadState();
      updateCardButtons();
      renderSavedList();
    });
    updateCardButtons();
    registerServiceWorker();
    focusDeepLinkedProduct();
    loadHistory().then(evaluateStoredAlerts);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
