#!/usr/bin/env python3
"""Collect Amazon Türkiye product prices through a visible public page.

This adapter intentionally does not use Amazon's private endpoints, login flows,
CAPTCHA solving, proxy rotation, or bot-evasion techniques. It fails closed when a
page is blocked, ambiguous, or missing an explicit TRY price.
"""
from __future__ import annotations

import argparse
import copy
import html as html_lib
import json
import os
import re
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX = ROOT / 'index.html'
DEFAULT_OUTPUT = ROOT / 'data' / 'price-history.json'
BROWSER_SOURCE = 'amazon-browser-visible'
DEFAULT_MAX_AGE_HOURS = 24
MAX_FUTURE_SKEW_MINUTES = 5
MAX_PRODUCTS_DEFAULT = 20
ALLOWED_HOSTS = {'amazon.com.tr', 'www.amazon.com.tr'}
ASIN_RE = re.compile(r'(?i)(?:/dp/|/gp/product/)([A-Z0-9]{10})(?=[/?#"\'<>\s]|$)')
HREF_RE = re.compile(r'''(?is)\bhref\s*=\s*["']([^"']+)["']''')
JSON_LD_RE = re.compile(
    r'''(?is)<script\b[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>'''
)
BLOCKED_MARKERS = (
    'robot check',
    'captcha',
    'enter the characters you see below',
    'sorry, we just need to make sure you\'re not a robot',
    'automated access to amazon data',
    'request is blocked',
)
AGENT_USER_AGENT = (
    'AmazonTelefonFiyatGuncelleyici/1.0 '
    'Agent/AmazonTelefonFiyatGuncelleyici '
    '(public-product-page; contact-owner-before-commercial-use)'
)


class BrowserUpdaterError(RuntimeError):
    """Base error for a safe, actionable browser updater failure."""


class BlockedPageError(BrowserUpdaterError):
    """The page indicates a robot check, CAPTCHA, or access block."""


class AmbiguousPriceError(BrowserUpdaterError):
    """The page exposes more than one price without a selected offer."""


class InvalidObservationError(BrowserUpdaterError):
    """The page does not contain a valid, explicit TRY observation."""


class BrowserDependencyError(BrowserUpdaterError):
    """Playwright is not installed or its browser is unavailable."""


class BrowserUpdateError(BrowserUpdaterError):
    """A full update must fail closed without modifying the output file."""


@dataclass(frozen=True)
class ProductTarget:
    asin: str
    url: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _parse_time(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError as error:
        raise InvalidObservationError(f'Geçersiz gözlem zamanı: {value!r}') from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalize_text(value: Any) -> str:
    return re.sub(r'\s+', ' ', html_lib.unescape(str(value or ''))).strip()


def parse_price(value: Any) -> int | float:
    """Parse common Turkish price formats without silently guessing currencies."""
    if isinstance(value, bool) or value is None:
        raise InvalidObservationError(f'Geçersiz fiyat: {value!r}')
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = _normalize_text(value)
        text = text.replace('\u00a0', '').replace(' ', '').replace('₺', '').replace('TL', '').replace('TRY', '')
        text = re.sub(r'[^0-9,.\-]', '', text)
        if not text or text == '-':
            raise InvalidObservationError(f'Geçersiz fiyat: {value!r}')
        if ',' in text:
            last_comma = text.rfind(',')
            fractional = text[last_comma + 1:]
            integer = text[:last_comma].replace(',', '').replace('.', '')
            if len(fractional) in {1, 2}:
                text = f'{integer}.{fractional}'
            else:
                text = f'{integer}{fractional}'
        elif text.count('.') > 1:
            text = text.replace('.', '')
        elif '.' in text and len(text.rsplit('.', 1)[1]) == 3:
            text = text.replace('.', '')
        try:
            number = float(text)
        except ValueError as error:
            raise InvalidObservationError(f'Geçersiz fiyat: {value!r}') from error
    if number <= 0:
        raise InvalidObservationError(f'Fiyat pozitif olmalı: {number}')
    return int(number) if number.is_integer() else round(number, 2)


def extract_asin_from_url(url: str) -> str | None:
    match = ASIN_RE.search(unquote(url))
    return match.group(1).upper() if match else None


def is_allowed_product_url(url: str) -> bool:
    """Allow only public Amazon Türkiye product-detail URLs."""
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    if parsed.scheme.lower() != 'https' or parsed.hostname is None:
        return False
    if parsed.hostname.lower() not in ALLOWED_HOSTS:
        return False
    if parsed.username or parsed.password or parsed.port:
        return False
    return extract_asin_from_url(url) is not None


def extract_product_targets(index_html: str) -> list[ProductTarget]:
    targets: dict[str, ProductTarget] = {}
    for raw_url in HREF_RE.findall(index_html):
        url = html_lib.unescape(raw_url).strip()
        asin = extract_asin_from_url(url)
        if asin and is_allowed_product_url(url):
            clean_url = url.split('#', 1)[0]
            targets.setdefault(asin, ProductTarget(asin=asin, url=clean_url))
    return sorted(targets.values(), key=lambda target: target.asin)


def _json_ld_objects(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, Mapping):
        yield value
        graph = value.get('@graph')
        if isinstance(graph, list):
            for item in graph:
                yield from _json_ld_objects(item)
    elif isinstance(value, list):
        for item in value:
            yield from _json_ld_objects(item)


def _load_product_json_ld(page_html: str) -> Mapping[str, Any] | None:
    for raw_script in JSON_LD_RE.findall(page_html):
        try:
            decoded = json.loads(html_lib.unescape(raw_script).strip())
        except json.JSONDecodeError:
            continue
        for candidate in _json_ld_objects(decoded):
            types = candidate.get('@type', [])
            if isinstance(types, str):
                types = [types]
            if 'Product' in types or ('name' in candidate and 'offers' in candidate):
                return candidate
    return None


def _offer_list(product: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    offers = product.get('offers')
    if isinstance(offers, Mapping):
        return [offers]
    if isinstance(offers, list) and all(isinstance(offer, Mapping) for offer in offers):
        return list(offers)
    raise InvalidObservationError('Ürün sayfasında geçerli teklif alanı bulunamadı.')


def _is_featured_offer(offer: Mapping[str, Any]) -> bool:
    return any(bool(offer.get(key)) for key in ('isFeaturedOffer', 'isBuyBoxWinner', 'featuredOffer'))


def _select_offer(product: Mapping[str, Any]) -> Mapping[str, Any]:
    offers = _offer_list(product)
    if len(offers) == 1:
        return offers[0]
    featured = [offer for offer in offers if _is_featured_offer(offer)]
    if len(featured) == 1:
        return featured[0]
    raise AmbiguousPriceError('Birden fazla teklif var ve seçili/öne çıkan teklif belirlenemedi.')


def _seller_name(offer: Mapping[str, Any]) -> str | None:
    seller = offer.get('seller')
    if isinstance(seller, Mapping):
        seller = seller.get('name')
    seller = _normalize_text(seller)
    return seller or None


def normalize_availability(value: Any) -> str:
    normalized = _normalize_text(value).casefold().replace('_', '').replace('-', '')
    if 'instock' in normalized or 'stokta' in normalized:
        return 'in_stock'
    if 'outofstock' in normalized or 'stokyok' in normalized:
        return 'out_of_stock'
    if 'preorder' in normalized or 'önsipariş' in normalized:
        return 'preorder'
    return 'unknown'


def _visible_text(page_html: str, element_id: str) -> str:
    pattern = re.compile(
        rf'''(?is)<[^>]*\bid\s*=\s*["']{re.escape(element_id)}["'][^>]*>(.*?)</[^>]+>'''
    )
    match = pattern.search(page_html)
    return _normalize_text(re.sub(r'<[^>]+>', ' ', match.group(1))) if match else ''


def _visible_price(page_html: str) -> tuple[int | float, str] | None:
    whole_match = re.search(
        r'''(?is)<[^>]*class\s*=\s*["'][^"']*a-price-whole[^"']*["'][^>]*>(.*?)</[^>]+>''',
        page_html,
    )
    if not whole_match:
        return None
    fraction_match = re.search(
        r'''(?is)<[^>]*class\s*=\s*["'][^"']*a-price-fraction[^"']*["'][^>]*>(.*?)</[^>]+>''',
        page_html,
    )
    whole = _normalize_text(re.sub(r'<[^>]+>', ' ', whole_match.group(1)))
    fraction = _normalize_text(re.sub(r'<[^>]+>', ' ', fraction_match.group(1))) if fraction_match else ''
    raw_price = f'{whole},{fraction}' if fraction else whole
    currency_context = page_html.casefold()
    if 'try' not in currency_context and '₺' not in currency_context and '>tl<' not in currency_context:
        raise InvalidObservationError('Görünür fiyatın TRY olduğu doğrulanamadı.')
    return parse_price(raw_price), 'TRY'


def _blocked_page(page_html: str) -> bool:
    folded = page_html.casefold()
    return any(marker in folded for marker in BLOCKED_MARKERS)


def parse_product_html(page_html: str, asin: str, observed_at: str) -> dict[str, Any]:
    """Parse one public product page and return a normalized browser observation."""
    if not page_html or not page_html.strip():
        raise InvalidObservationError('Ürün sayfası boş döndü.')
    if _blocked_page(page_html):
        raise BlockedPageError(f'{asin} sayfası robot/CAPTCHA/erişim engeli gösteriyor.')
    product = _load_product_json_ld(page_html)
    if product is not None:
        title = _normalize_text(product.get('name')) or _visible_text(page_html, 'productTitle')
        offer = _select_offer(product)
        currency = _normalize_text(offer.get('priceCurrency') or offer.get('currency')).upper()
        if currency != 'TRY':
            raise InvalidObservationError(f'{asin} fiyatı TRY değil: {currency or "bilinmiyor"}')
        price_value = offer.get('price')
        if price_value is None and isinstance(offer.get('priceSpecification'), Mapping):
            price_value = offer['priceSpecification'].get('price')
        price = parse_price(price_value)
        availability = normalize_availability(offer.get('availability'))
        seller = _seller_name(offer)
    else:
        title = _visible_text(page_html, 'productTitle')
        visible = _visible_price(page_html)
        if not title or visible is None:
            raise InvalidObservationError(f'{asin} için yapılandırılmış veya görünür TRY fiyatı bulunamadı.')
        price, currency = visible
        availability = normalize_availability(_visible_text(page_html, 'availability'))
        seller = None
    if not title:
        raise InvalidObservationError(f'{asin} için ürün başlığı bulunamadı.')
    return {
        'asin': asin.upper(),
        'title': title,
        'observedAt': observed_at,
        'price': price,
        'currency': currency,
        'priceType': 'visible-offer-price',
        'source': BROWSER_SOURCE,
        'seller': seller,
        'availability': availability,
    }


def _point_from_observation(observation: Mapping[str, Any]) -> dict[str, Any]:
    keys = ('observedAt', 'price', 'currency', 'priceType', 'source', 'seller', 'availability')
    return {key: observation[key] for key in keys if key in observation and observation[key] is not None}


def merge_browser_history(
    history: Mapping[str, Any],
    observations: list[Mapping[str, Any]],
    generated_at: str,
    max_age_hours: int = DEFAULT_MAX_AGE_HOURS,
) -> dict[str, Any]:
    if not observations:
        raise BrowserUpdateError('Geçerli browser gözlemi yok; dosya değiştirilmeyecek.')
    merged = copy.deepcopy(dict(history))
    merged['version'] = 2
    merged['source'] = BROWSER_SOURCE
    merged['generatedAt'] = generated_at
    merged['staleAfterHours'] = max_age_hours
    merged['note'] = (
        'Fiyat ve stok bilgisi herkese açık Amazon Türkiye ürün sayfasından gözlemlendi; '
        'satın alma öncesinde Amazon sayfasında yeniden doğrulanmalıdır.'
    )
    products = merged.setdefault('products', {})
    if history.get('source') != BROWSER_SOURCE:
        for record in products.values():
            if isinstance(record, Mapping):
                record['points'] = []
    cutoff = _parse_time(generated_at) - timedelta(hours=max_age_hours)
    for observation in observations:
        asin = str(observation['asin']).upper()
        record = products.setdefault(asin, {'title': observation['title'], 'priceType': observation['priceType'], 'points': []})
        record['title'] = observation['title']
        record['priceType'] = observation['priceType']
        old_points = [
            point for point in record.get('points', [])
            if _parse_time(point['observedAt']) >= cutoff and point.get('source') == BROWSER_SOURCE
        ]
        new_point = _point_from_observation(observation)
        old_points = [point for point in old_points if point.get('observedAt') != new_point['observedAt']]
        old_points.append(new_point)
        old_points.sort(key=lambda point: _parse_time(point['observedAt']))
        record['points'] = old_points
    for asin, record in list(products.items()):
        record['points'] = [
            point for point in record.get('points', [])
            if _parse_time(point['observedAt']) >= cutoff and point.get('source') == BROWSER_SOURCE
        ]
        if not record['points']:
            del products[asin]
    return merged


def validate_browser_history(
    history: Mapping[str, Any],
    now: str | None = None,
    max_age_hours: int = DEFAULT_MAX_AGE_HOURS,
) -> None:
    if history.get('source') != BROWSER_SOURCE:
        raise BrowserUpdateError('Geçmiş kaynağı browser-visible değil.')
    generated_at = history.get('generatedAt')
    if not generated_at:
        raise BrowserUpdateError('Canlı browser geçmişinde generatedAt eksik.')
    current = _parse_time(now or _now_iso())
    generated = _parse_time(generated_at)
    if generated - current > timedelta(minutes=MAX_FUTURE_SKEW_MINUTES):
        raise BrowserUpdateError('Güncelleme zamanı gelecekte görünüyor.')
    if current - generated > timedelta(hours=max_age_hours):
        raise BrowserUpdateError('Browser fiyat geçmişi stale; dosya değiştirilmeyecek.')
    products = history.get('products')
    if not isinstance(products, Mapping) or not products:
        raise BrowserUpdateError('Browser geçmişinde ürün verisi yok.')
    for asin, record in products.items():
        if not re.fullmatch(r'[A-Z0-9]{10}', str(asin)):
            raise BrowserUpdateError(f'Geçersiz ASIN: {asin}')
        points = record.get('points') if isinstance(record, Mapping) else None
        if not points:
            raise BrowserUpdateError(f'{asin} için fiyat noktası yok.')
        for point in points:
            if point.get('source') != BROWSER_SOURCE or str(point.get('currency')).upper() != 'TRY':
                raise BrowserUpdateError(f'{asin} için geçersiz browser fiyat noktası.')
            _parse_time(point['observedAt'])
            parse_price(point.get('price'))


def atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def write_history_if_requested(path: Path, payload: Mapping[str, Any], dry_run: bool = True) -> bool:
    if dry_run:
        return False
    atomic_write_json(path, payload)
    return True


def fetch_product_html(url: str, timeout_ms: int = 45000, headless: bool = True) -> str:
    if not is_allowed_product_url(url):
        raise BrowserUpdateError(f'İzin verilmeyen ürün URL\'si: {url}')
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise BrowserDependencyError(
            'Playwright kurulu değil. requirements-browser.txt kurun ve ardından '
            '`python -m playwright install chromium` çalıştırın.'
        ) from error
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=headless)
            context = browser.new_context(
                locale='tr-TR',
                user_agent=AGENT_USER_AGENT,
            )
            page = context.new_page()
            response = page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
            if response is not None and response.status in {403, 429, 503}:
                raise BlockedPageError(f'{url} HTTP {response.status} döndürdü.')
            try:
                page.wait_for_selector('#productTitle', timeout=10000)
            except PlaywrightTimeoutError:
                pass
            page_html = page.content()
            context.close()
            browser.close()
            return page_html
    except BrowserUpdaterError:
        raise
    except Exception as error:
        raise BrowserUpdateError(f'Ürün sayfası açılamadı: {url}: {error}') from error


def update_once(
    index_path: Path = DEFAULT_INDEX,
    output_path: Path = DEFAULT_OUTPUT,
    dry_run: bool = True,
    max_age_hours: int = DEFAULT_MAX_AGE_HOURS,
    delay_seconds: float = 1.0,
    max_products: int = MAX_PRODUCTS_DEFAULT,
    page_fetcher: Callable[[str], str] | None = None,
    headless: bool = True,
) -> dict[str, Any]:
    index_html = index_path.read_text(encoding='utf-8')
    targets = extract_product_targets(index_html)
    if not targets:
        raise BrowserUpdateError('index.html içinde izin verilen Amazon Türkiye ürün URL\'si bulunamadı.')
    if len(targets) > max_products:
        raise BrowserUpdateError(f'{len(targets)} ürün bulundu; güvenlik sınırı {max_products}.')
    observed_at = _now_iso()
    observations: list[dict[str, Any]] = []
    fetch = page_fetcher or (lambda url: fetch_product_html(url, headless=headless))
    for index, target in enumerate(targets):
        try:
            page_html = fetch(target.url)
            observations.append(parse_product_html(page_html, target.asin, observed_at))
        except BrowserUpdaterError as error:
            raise BrowserUpdateError(f'{target.asin} güncellenemedi: {error}') from error
        if delay_seconds > 0 and index < len(targets) - 1:
            time.sleep(delay_seconds)
    current = json.loads(output_path.read_text(encoding='utf-8')) if output_path.exists() else {'version': 1, 'products': {}}
    updated = merge_browser_history(current, observations, observed_at, max_age_hours=max_age_hours)
    validate_browser_history(updated, now=observed_at, max_age_hours=max_age_hours)
    written = write_history_if_requested(output_path, updated, dry_run=dry_run)
    result = {
        'updated': written,
        'dryRun': dry_run,
        'source': BROWSER_SOURCE,
        'products': len(observations),
        'observedAt': observed_at,
        'urls': [target.url for target in targets],
    }
    print(json.dumps(result, ensure_ascii=False))
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Amazon Türkiye fiyat geçmişini görünür ürün sayfasından güncelle')
    parser.add_argument('--write', action='store_true', help='Başarılı doğrulamadan sonra price-history.json yazar; varsayılan dry-run')
    parser.add_argument('--index', type=Path, default=DEFAULT_INDEX)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--max-age-hours', type=int, default=DEFAULT_MAX_AGE_HOURS)
    parser.add_argument('--delay-seconds', type=float, default=1.0)
    parser.add_argument('--max-products', type=int, default=MAX_PRODUCTS_DEFAULT)
    parser.add_argument('--headed', action='store_true', help='Tarayıcı penceresini görünür aç')
    args = parser.parse_args(argv)
    if args.max_age_hours <= 0 or args.delay_seconds < 0 or args.max_products <= 0:
        parser.error('max-age-hours ve max-products pozitif, delay-seconds negatif olmayan bir sayı olmalı')
    try:
        update_once(
            index_path=args.index,
            output_path=args.output,
            dry_run=not args.write,
            max_age_hours=args.max_age_hours,
            delay_seconds=args.delay_seconds,
            max_products=args.max_products,
            headless=not args.headed,
        )
        return 0
    except (BrowserUpdaterError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f'Browser updater durdu: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
