#!/usr/bin/env python3
"""Update the client-visible price history from Amazon Creators API.

The script deliberately fails closed when credentials and explicit authorization are
missing. It never scrapes Amazon HTML and it never writes a partial JSON file.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HTML = ROOT / 'index.html'
DEFAULT_OUTPUT = ROOT / 'data' / 'price-history.json'
DEFAULT_MAX_AGE_HOURS = 24
MAX_FUTURE_SKEW_MINUTES = 5
ASIN_RE = re.compile(r'/dp/([A-Z0-9]{10})(?=[/?#"\'<>\s]|$)', re.IGNORECASE)
LIVE_SOURCE = 'amazon-creators-api'
ACK_VALUE = 'I_HAVE_AUTHORIZED_AMAZON_API_ACCESS'


class UpdaterError(RuntimeError):
    """A safe, user-actionable updater failure."""


class MissingConfigurationError(UpdaterError):
    """Raised when required credentials or explicit authorization are missing."""


@dataclass(frozen=True)
class LiveConfig:
    credential_id: str
    credential_secret: str
    api_version: str
    partner_tag: str
    marketplace: str


def _env_value(env: Mapping[str, str], *names: str) -> str:
    for name in names:
        value = env.get(name, '').strip()
        if value:
            return value
    return ''


def load_required_config(env: Mapping[str, str] | None = None) -> LiveConfig:
    """Load secrets from environment and require an explicit access acknowledgement."""
    env = env or os.environ
    config = {
        'credential_id': _env_value(env, 'AMAZON_CREATORS_CREDENTIAL_ID', 'AMAZON_CREDENTIAL_ID'),
        'credential_secret': _env_value(env, 'AMAZON_CREATORS_CREDENTIAL_SECRET', 'AMAZON_CREDENTIAL_SECRET'),
        'api_version': _env_value(env, 'AMAZON_CREATORS_API_VERSION', 'AMAZON_API_VERSION'),
        'partner_tag': _env_value(env, 'AMAZON_PARTNER_TAG', 'AMAZON_ASSOCIATE_TAG'),
        'marketplace': _env_value(env, 'AMAZON_MARKETPLACE') or 'www.amazon.com.tr',
    }
    missing = [name for name, value in config.items() if name != 'marketplace' and not value]
    if missing:
        raise MissingConfigurationError(
            'Canlı Amazon güncellemesi için eksik ortam değişkenleri: '
            + ', '.join(missing)
            + '. Credential değerlerini public dosyalara yazmayın.'
        )
    if env.get('AMAZON_LIVE_DATA_ACK', '').strip() != ACK_VALUE:
        raise MissingConfigurationError(
            'Canlı Amazon fiyat verisi yazımı kapalı. Kullanım şartlarını ve API erişimini '
            f'doğruladıktan sonra AMAZON_LIVE_DATA_ACK={ACK_VALUE} ayarlayın.'
        )
    if config['marketplace'] != 'www.amazon.com.tr':
        raise MissingConfigurationError(
            'Bu updater yalnızca Amazon Türkiye için yapılandırıldı: AMAZON_MARKETPLACE=www.amazon.com.tr'
        )
    return LiveConfig(**config)


def _value(obj: Any, *keys: str, default: Any = None) -> Any:
    for key in keys:
        if isinstance(obj, Mapping):
            if key in obj:
                obj = obj[key]
            else:
                return default
        else:
            obj = getattr(obj, key, None)
            if obj is None:
                return default
    return obj


def _first_value(obj: Any, paths: Iterable[tuple[str, ...]], default: Any = None) -> Any:
    for path in paths:
        value = _value(obj, *path, default=None)
        if value is not None:
            return value
    return default


def _number(value: Any) -> int | float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise UpdaterError(f'Geçersiz fiyat değeri: {value!r}') from error
    if number <= 0:
        raise UpdaterError(f'Fiyat pozitif olmalı: {number}')
    return int(number) if number.is_integer() else round(number, 2)


def extract_asins_from_html(html: str) -> list[str]:
    """Extract unique ASINs from existing product links without scraping Amazon."""
    seen: set[str] = set()
    for match in ASIN_RE.finditer(html):
        seen.add(match.group(1).upper())
    return sorted(seen)


def _listing_price(listing: Any) -> tuple[int | float, str]:
    amount = _first_value(listing, [
        ('price', 'money', 'amount'),
        ('price', 'amount'),
    ])
    currency = _first_value(listing, [
        ('price', 'money', 'currency'),
        ('price', 'currency'),
    ], default='')
    if str(currency).upper() != 'TRY':
        raise UpdaterError(f'Beklenmeyen para birimi: {currency!r}')
    return _number(amount), str(currency).upper()


def _is_new_listing(listing: Any) -> bool:
    condition = _first_value(listing, [('condition', 'value'), ('condition', 'display_value')], default=None)
    if condition is None:
        return True
    return str(condition).lower() in {'new', 'conditionnew'}


def normalize_item(item: Any, observed_at: str) -> dict[str, Any]:
    """Convert an SDK item or test dictionary into the public history point shape."""
    asin = str(_value(item, 'asin', default='')).upper()
    if not re.fullmatch(r'[A-Z0-9]{10}', asin):
        raise UpdaterError(f'Geçersiz veya eksik ASIN: {asin!r}')
    title = str(_first_value(item, [
        ('item_info', 'title', 'display_value'),
        ('item_info', 'title', 'displayValue'),
    ], default='')).strip()
    offers = _value(item, 'offers_v2', default=None)
    listings = _value(offers, 'listings', default=[]) if offers is not None else []
    listings = list(listings or [])
    candidates = [listing for listing in listings if _is_new_listing(listing)]
    if not candidates:
        raise UpdaterError(f'{asin} için yeni ürün teklifi bulunamadı')

    priced: list[tuple[Any, int | float, str]] = []
    for listing in candidates:
        try:
            price, currency = _listing_price(listing)
        except UpdaterError:
            continue
        priced.append((listing, price, currency))
    if not priced:
        raise UpdaterError(f'{asin} için TRY fiyatı bulunamadı')

    buy_box = [row for row in priced if bool(_value(row[0], 'is_buy_box_winner', default=False))]
    listing, price, currency = (buy_box[0] if buy_box else min(priced, key=lambda row: row[1]))
    seller = _first_value(listing, [('merchant_info', 'name')], default='')
    availability = _first_value(listing, [
        ('availability', 'max_order_quantity'),
        ('availability', 'maxOrderQuantity'),
        ('availability', 'message'),
    ], default=None)
    return {
        'asin': asin,
        'title': title or asin,
        'observedAt': observed_at,
        'price': price,
        'currency': currency,
        'priceType': 'offer-buying-price',
        'source': LIVE_SOURCE,
        'seller': str(seller) if seller else None,
        'availability': availability,
    }


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def merge_history(history: Mapping[str, Any], observations: list[Mapping[str, Any]], generated_at: str, max_age_hours: int = DEFAULT_MAX_AGE_HOURS) -> dict[str, Any]:
    """Merge a successful live response and retain only policy-safe recent points."""
    if not observations:
        raise UpdaterError('Amazon API geçerli fiyat gözlemi döndürmedi; dosya değiştirilmeyecek.')
    merged = copy.deepcopy(dict(history))
    merged['version'] = 2
    merged['source'] = LIVE_SOURCE
    merged['generatedAt'] = generated_at
    merged['staleAfterHours'] = max_age_hours
    products = merged.setdefault('products', {})
    if history.get('source') != LIVE_SOURCE:
        for record in products.values():
            if isinstance(record, Mapping):
                record['points'] = []
    cutoff = _parse_time(generated_at) - timedelta(hours=max_age_hours)
    for observation in observations:
        asin = observation['asin']
        record = products.setdefault(asin, {
            'title': observation['title'],
            'priceType': observation['priceType'],
            'points': [],
        })
        record['title'] = observation['title']
        record['priceType'] = observation['priceType']
        points = [point for point in record.get('points', []) if _parse_time(point['observedAt']) >= cutoff]
        point = {
            key: observation[key]
            for key in ('observedAt', 'price', 'currency', 'priceType', 'source', 'seller', 'availability')
            if key in observation and observation[key] is not None
        }
        points = [existing for existing in points if existing.get('observedAt') != point['observedAt']]
        points.append(point)
        points.sort(key=lambda value: _parse_time(value['observedAt']))
        record['points'] = points
    for asin, record in list(products.items()):
        record['points'] = [point for point in record.get('points', []) if _parse_time(point['observedAt']) >= cutoff]
        if not record['points']:
            del products[asin]
    return merged


def validate_history(history: Mapping[str, Any], now: str | None = None, max_age_hours: int = DEFAULT_MAX_AGE_HOURS) -> None:
    """Reject malformed or stale live history before it reaches the public frontend."""
    if history.get('source') != LIVE_SOURCE:
        raise UpdaterError('Yalnızca canlı Amazon kaynağı doğrulanabilir; fixture veri canlıya karıştırılamaz.')
    generated_at = history.get('generatedAt')
    if not generated_at:
        raise UpdaterError('Canlı geçmişte generatedAt alanı eksik.')
    current = _parse_time(now or _now_iso())
    generated = _parse_time(generated_at)
    if generated - current > timedelta(minutes=MAX_FUTURE_SKEW_MINUTES):
        raise UpdaterError('Canlı geçmişin generatedAt zamanı gelecekte görünüyor.')
    if current - generated > timedelta(hours=max_age_hours):
        raise UpdaterError('Canlı fiyat geçmişi stale; public dosya güncellenmeyecek.')
    products = history.get('products')
    if not isinstance(products, Mapping) or not products:
        raise UpdaterError('Canlı geçmişte ürün verisi yok.')
    for asin, record in products.items():
        if not re.fullmatch(r'[A-Z0-9]{10}', str(asin)):
            raise UpdaterError(f'Geçersiz ürün kimliği: {asin}')
        points = record.get('points') if isinstance(record, Mapping) else None
        if not points:
            raise UpdaterError(f'{asin} için fiyat noktası yok.')
        for point in points:
            if point.get('source') != LIVE_SOURCE or str(point.get('currency')).upper() != 'TRY':
                raise UpdaterError(f'{asin} için yalnızca canlı TRY noktaları kabul edilir.')
            if current - _parse_time(point['observedAt']) > timedelta(hours=max_age_hours):
                raise UpdaterError(f'{asin} için eski fiyat noktası bulundu.')
            _number(point.get('price'))


def atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    """Write JSON atomically so a failed run cannot corrupt the public file."""
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


def _build_client(config: LiveConfig) -> Any:
    try:
        from amazon_creatorsapi import AmazonCreatorsApi
        from amazon_creatorsapi import Country
        from amazon_creatorsapi.models import GetItemsResource
    except ImportError as error:
        raise UpdaterError(
            'python-amazon-paapi==7.0.0 kurulu değil. requirements-updater.txt ile kurun.'
        ) from error
    client = AmazonCreatorsApi(
        credential_id=config.credential_id,
        credential_secret=config.credential_secret,
        version=config.api_version,
        tag=config.partner_tag,
        country=Country.TR,
        marketplace=config.marketplace,
        throttling=1,
        timeout=30,
        retries=3,
    )
    client._history_resources = [
        GetItemsResource.ITEM_INFO_DOT_TITLE,
        GetItemsResource.OFFERS_V2_DOT_LISTINGS_DOT_AVAILABILITY,
        GetItemsResource.OFFERS_V2_DOT_LISTINGS_DOT_CONDITION,
        GetItemsResource.OFFERS_V2_DOT_LISTINGS_DOT_IS_BUY_BOX_WINNER,
        GetItemsResource.OFFERS_V2_DOT_LISTINGS_DOT_MERCHANT_INFO,
        GetItemsResource.OFFERS_V2_DOT_LISTINGS_DOT_PRICE,
    ]
    return client


def update_once(html_path: Path = DEFAULT_HTML, output_path: Path = DEFAULT_OUTPUT, dry_run: bool = False, max_age_hours: int = DEFAULT_MAX_AGE_HOURS) -> int:
    config = load_required_config()
    asins = extract_asins_from_html(html_path.read_text(encoding='utf-8'))
    if not asins:
        raise UpdaterError('index.html içinde ASIN bulunamadı; dosya değiştirilmeyecek.')
    observed_at = _now_iso()
    client = _build_client(config)
    try:
        from amazon_creatorsapi.models import Condition
        items = client.get_items(
            asins,
            condition=Condition.NEW,
            currency_of_preference='TRY',
            languages_of_preference=['tr_TR'],
            resources=client._history_resources,
        )
        observations = [normalize_item(item, observed_at) for item in items]
    finally:
        client.close()
    current = json.loads(output_path.read_text(encoding='utf-8')) if output_path.exists() else {'version': 1, 'products': {}}
    updated = merge_history(current, observations, observed_at, max_age_hours=max_age_hours)
    validate_history(updated, now=observed_at, max_age_hours=max_age_hours)
    if not dry_run:
        atomic_write_json(output_path, updated)
    print(json.dumps({'updated': not dry_run, 'source': LIVE_SOURCE, 'products': len(observations), 'observedAt': observed_at}, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Amazon Creators API ile fiyat geçmişini güncelle')
    parser.add_argument('--dry-run', action='store_true', help='API çağrısı yapar ancak JSON dosyasını yazmaz')
    parser.add_argument('--max-age-hours', type=int, default=DEFAULT_MAX_AGE_HOURS)
    args = parser.parse_args(argv)
    if args.max_age_hours <= 0:
        parser.error('--max-age-hours pozitif olmalı')
    try:
        return update_once(dry_run=args.dry_run, max_age_hours=args.max_age_hours)
    except (UpdaterError, OSError, ValueError) as error:
        print(f'Updater durdu: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
