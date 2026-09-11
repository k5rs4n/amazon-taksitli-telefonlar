(() => {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const TREND_THRESHOLD_PERCENT = 2;

  function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function normalizePoints(points) {
    return (Array.isArray(points) ? points : [])
      .filter((point) => point && point.observedAt && Number.isFinite(Number(point.price)))
      .map((point) => ({ ...point, price: Number(point.price), date: new Date(point.observedAt) }))
      .filter((point) => !Number.isNaN(point.date.getTime()) && point.price > 0)
      .sort((a, b) => a.date - b.date);
  }

  function filterPointsByPeriod(points, period = 'all', now = new Date()) {
    const normalized = normalizePoints(points);
    if (period === 'all') return normalized;
    const days = Number(period);
    if (!Number.isFinite(days) || days <= 0) return normalized;
    const end = new Date(now).getTime();
    if (!Number.isFinite(end)) return normalized;
    const start = end - days * DAY_MS;
    return normalized.filter((point) => point.date.getTime() >= start && point.date.getTime() <= end);
  }

  function trendDetails(changePercent, count) {
    if (count < 2 || changePercent === null) {
      return { trend: 'insufficient', trendLabel: 'Veri yetersiz', confidence: 'low', confidenceLabel: 'Düşük güven' };
    }
    if (changePercent <= -TREND_THRESHOLD_PERCENT) {
      return {
        trend: 'down',
        trendLabel: 'Düşüş eğilimi',
        confidence: count >= 4 ? 'high' : 'medium',
        confidenceLabel: count >= 4 ? 'Yüksek güven' : 'Orta güven',
      };
    }
    if (changePercent >= TREND_THRESHOLD_PERCENT) {
      return {
        trend: 'up',
        trendLabel: 'Yükseliş eğilimi',
        confidence: count >= 4 ? 'high' : 'medium',
        confidenceLabel: count >= 4 ? 'Yüksek güven' : 'Orta güven',
      };
    }
    return {
      trend: 'flat',
      trendLabel: 'Yatay seyir',
      confidence: count >= 4 ? 'high' : 'medium',
      confidenceLabel: count >= 4 ? 'Yüksek güven' : 'Orta güven',
    };
  }

  function summarizePoints(points, options = {}) {
    const normalized = filterPointsByPeriod(points, 'all', options.now || new Date());
    const count = normalized.length;
    const latest = normalized[count - 1] || null;
    const previous = normalized[count - 2] || null;
    const first = normalized[0] || null;
    const prices = normalized.map((point) => point.price);
    const minimum = count ? normalized.reduce((best, point) => point.price < best.price ? point : best) : null;
    const maximum = count ? normalized.reduce((best, point) => point.price > best.price ? point : best) : null;
    const average = count ? round(prices.reduce((sum, price) => sum + price, 0) / count) : null;
    const changeValue = first && latest && count >= 2 ? round(latest.price - first.price) : null;
    const changePercent = first && first.price && changeValue !== null ? round((changeValue / first.price) * 100) : null;
    const previousChangeValue = previous && latest ? round(latest.price - previous.price) : null;
    const previousChangePercent = previous && previous.price ? round((previousChangeValue / previous.price) * 100) : null;
    const latestVsAverageValue = latest && average !== null ? round(latest.price - average) : null;
    const latestVsAveragePercent = latest && average ? round((latestVsAverageValue / average) * 100) : null;
    const details = trendDetails(changePercent, count);

    return {
      count,
      first,
      previous,
      latest,
      minimum,
      maximum,
      average,
      changeValue,
      changePercent,
      previousChangeValue,
      previousChangePercent,
      rangeValue: minimum && maximum ? round(maximum.price - minimum.price) : null,
      latestVsAverageValue,
      latestVsAveragePercent,
      ...details,
    };
  }

  const api = { filterPointsByPeriod, normalizePoints, summarizePoints, TREND_THRESHOLD_PERCENT };
  if (typeof window !== 'undefined') window.AmazonHistoryAnalysis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
