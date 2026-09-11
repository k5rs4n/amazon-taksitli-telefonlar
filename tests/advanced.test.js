const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function parseIfExists(filePath) {
  const content = readIfExists(filePath);
  return content ? JSON.parse(content) : {};
}

const featureScript = readIfExists(path.join(root, 'assets', 'advanced-features.js'));
const featureStyles = readIfExists(path.join(root, 'assets', 'advanced-features.css'));
const analysisScript = readIfExists(path.join(root, 'assets', 'history-analysis.js'));
const alertScript = readIfExists(path.join(root, 'assets', 'price-alerts.js'));
const manifest = parseIfExists(path.join(root, 'manifest.webmanifest'));
const serviceWorker = readIfExists(path.join(root, 'sw.js'));
const history = parseIfExists(path.join(root, 'data', 'price-history.json'));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

test('ileri özellik modülü ve stilleri sayfaya izole bağlanır', () => {
  assert.match(indexHtml, /assets\/advanced-features\.css/);
  assert.match(indexHtml, /assets\/advanced-features\.js/);
  assert.match(featureScript, /amazonTaksitliTelefonlar:favorites:v1/);
  assert.match(featureStyles, /advanced-feature/);
});

test('favoriler ve izleme listesi ürün kimliğiyle localStorage kullanır', () => {
  assert.match(featureScript, /localStorage/);
  assert.match(featureScript, /favorite/);
  assert.match(featureScript, /watchlist/);
  assert.match(indexHtml, /data-product-id/);
  assert.match(featureScript, /ASIN|canonical|productId/);
  assert.doesNotMatch(featureScript, /data-price[^\n]*localStorage/);
});

test('ürün paylaşımı Web Share ve panoya kopyalama fallback içerir', () => {
  assert.match(featureScript, /navigator\.share/);
  assert.match(featureScript, /navigator\.clipboard/);
  assert.match(featureScript, /URLSearchParams/);
});

test('PWA manifest ve service worker sürümlü cache ile tanımlıdır', () => {
  assert.strictEqual(manifest.name, 'Amazon Taksitli Telefonlar');
  assert.strictEqual(manifest.display, 'standalone');
  assert.ok(manifest.start_url === './?source=pwa' || manifest.start_url.includes('/amazon-taksitli-telefonlar/'));
  assert.ok(Array.isArray(manifest.icons));
  assert.ok(fs.existsSync(path.join(root, 'amazon-logo.png')));
  assert.match(indexHtml, /manifest\.webmanifest/);
  assert.match(featureScript, /serviceWorker\.register/);
  assert.match(serviceWorker, /CACHE_VERSION/);
  assert.match(serviceWorker, /addEventListener\(['"]install/);
  assert.match(serviceWorker, /addEventListener\(['"]activate/);
  assert.match(serviceWorker, /addEventListener\(['"]fetch/);
});

test('fiyat geçmişi fixture verisi kararlı ürün kimlikleri ve geçerli noktalar içerir', () => {
  assert.ok(history.version);
  assert.ok(history.products && typeof history.products === 'object');
  const productIds = [...indexHtml.matchAll(/data-product-id="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(productIds.length >= 3);
  for (const productId of productIds) {
    assert.ok(history.products[productId], `Eksik geçmiş: ${productId}`);
    const minimumPoints = history.source === 'fixture' ? 2 : 1;
    assert.ok(history.products[productId].points.length >= minimumPoints);
    for (const point of history.products[productId].points) {
      assert.match(point.observedAt, /^2026-09-/);
      assert.strictEqual(point.currency, 'TRY');
      assert.ok(Number.isFinite(point.price) && point.price > 0);
    }
  }
  assert.match(featureScript, /price-history\.json/);
  assert.match(featureScript, /Fiyat geçmişi/);
});

test('canlı fiyat geçmişi kaynağı ve stale veri koruması arayüzde tanımlıdır', () => {
  assert.match(featureScript, /amazon-creators-api/);
  assert.match(featureScript, /amazon-browser-visible/);
  assert.match(featureScript, /generatedAt/);
  assert.match(featureScript, /staleAfterHours/);
  assert.match(featureScript, /güncel değil|stale/i);
});

test('fiyat geçmişi Aşama 1 analiz arayüzü ve erişilebilir grafik özelliklerini içerir', () => {
  assert.match(indexHtml, /assets\/history-analysis\.js/);
  assert.match(featureScript, /advanced-history-summary-grid/);
  assert.match(featureScript, /data-history-range/);
  assert.match(featureScript, /advanced-history-trend/);
  assert.match(featureScript, /filterPointsByPeriod/);
  assert.match(featureScript, /summarizePoints/);
  assert.match(featureScript, /advanced-history-tooltip/);
  assert.match(featureScript, /labelElement/);
  assert.match(analysisScript, /summarizePoints/);
});

test('grafik stilleri özet kartları, trend ve responsive görünümü içerir', () => {
  assert.match(featureStyles, /advanced-history-summary-grid/);
  assert.match(featureStyles, /advanced-history-trend/);
  assert.match(featureStyles, /advanced-history-tooltip/);
  assert.match(featureStyles, /@media \(max-width: 575px\)/);
});

test('fiyat alarmı ve tarayıcı bildirimleri güvenli kullanıcı etkileşimiyle tanımlıdır', () => {
  assert.match(indexHtml, /assets\/price-alerts\.js/);
  assert.match(featureScript, /toggle-alert-panel/);
  assert.match(featureScript, /save-alert/);
  assert.match(featureScript, /requestNotificationPermission/);
  assert.match(featureScript, /Notification/);
  assert.match(featureScript, /evaluateAlert/);
  assert.match(featureScript, /price-alert/);
  assert.match(alertScript, /normalizeAlert/);
  assert.match(alertScript, /filterUnnotifiedEvents/);
  assert.match(featureScript, /createButton\('Fiyat alarmı', 'toggle-alert-panel'\)/);
});

test('alarm CSS mobilde ve bildirim rozetinde tanımlıdır', () => {
  assert.match(featureStyles, /advanced-alert/);
  assert.match(featureStyles, /price-alert/);
});

test('modern dashboard shell ve dinamik özet kartları tanımlıdır', () => {
  assert.match(indexHtml, /dashboard-shell/);
  assert.match(indexHtml, /dashboard-hero/);
  assert.match(indexHtml, /dashboard-stats/);
  assert.match(indexHtml, /dashboard-stat-products/);
  assert.match(indexHtml, /dashboard-stat-lowest/);
  assert.match(indexHtml, /dashboard-stat-alerts/);
  assert.match(indexHtml, /dashboard-stat-lists/);
  assert.match(indexHtml, /dashboard-layout/);
  assert.match(indexHtml, /dashboard-sidebar/);
  assert.match(featureScript, /updateDashboardStats/);
});

test('dashboard stilleri sade responsive kontrol merkezi düzenini içerir', () => {
  assert.match(featureStyles, /dashboard-shell/);
  assert.match(featureStyles, /dashboard-hero/);
  assert.match(featureStyles, /dashboard-stats/);
  assert.match(featureStyles, /dashboard-layout/);
  assert.match(featureStyles, /dashboard-sidebar/);
  assert.match(featureStyles, /prefers-reduced-motion/);
});

test('mevcut Amazon ürün bağlantıları korunur', () => {
  const amazonLinks = [...indexHtml.matchAll(/href="(https:\/\/www\.amazon\.com\.tr\/[^"]+)"/g)].map((match) => match[1]);
  assert.strictEqual(amazonLinks.length, 3);
  assert.ok(amazonLinks.every((url) => url.includes('/dp/')));
});

if (process.exitCode) process.exit(1);
