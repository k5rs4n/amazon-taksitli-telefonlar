import importlib.util
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / 'scripts' / 'update_price_history.py'
updater = None
if MODULE_PATH.exists():
    spec = importlib.util.spec_from_file_location('update_price_history', MODULE_PATH)
    updater = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules['update_price_history'] = updater
    spec.loader.exec_module(updater)


class UpdatePriceHistoryTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(updater, 'scripts/update_price_history.py henüz eklenmedi')

    def test_extracts_unique_asins_from_product_links(self):
        html = '<a href="https://www.amazon.com.tr/example/dp/B0HCCFQR78"></a>' \
               '<a href="https://www.amazon.com.tr/example/dp/B0HCCFQR78"></a>' \
               '<a href="https://www.amazon.com.tr/example/dp/B0HCCS6JTX"></a>'
        self.assertEqual(
            updater.extract_asins_from_html(html),
            ['B0HCCFQR78', 'B0HCCS6JTX'],
        )

    def test_normalizes_buy_box_price_observation(self):
        item = {
            'asin': 'B0HCCFQR78',
            'item_info': {'title': {'display_value': 'Example Phone'}},
            'offers_v2': {
                'listings': [
                    {
                        'is_buy_box_winner': False,
                        'price': {'money': {'amount': 14000, 'currency': 'TRY'}},
                        'merchant_info': {'name': 'Other Seller'},
                        'condition': {'value': 'New'},
                        'availability': {'max_order_quantity': 2},
                    },
                    {
                        'is_buy_box_winner': True,
                        'price': {'money': {'amount': 12699, 'currency': 'TRY'}},
                        'merchant_info': {'name': 'Amazon.com.tr'},
                        'condition': {'value': 'New'},
                        'availability': {'max_order_quantity': 5},
                    },
                ]
            },
        }
        observation = updater.normalize_item(item, '2026-09-10T10:00:00+03:00')
        self.assertEqual(observation['asin'], 'B0HCCFQR78')
        self.assertEqual(observation['price'], 12699)
        self.assertEqual(observation['currency'], 'TRY')
        self.assertEqual(observation['seller'], 'Amazon.com.tr')
        self.assertEqual(observation['source'], 'amazon-creators-api')
        item['offers_v2']['listings'][1]['availability'] = {'message': 'In stock'}
        fallback_observation = updater.normalize_item(item, '2026-09-10T10:00:00+03:00')
        self.assertEqual(fallback_observation['availability'], 'In stock')

    def test_merge_preserves_history_and_deduplicates_observation(self):
        history = {
            'version': 1,
            'source': 'fixture',
            'products': {
                'B0HCCFQR78': {
                    'title': 'Example Phone',
                    'priceType': 'listed-total-price',
                    'points': [
                        {'observedAt': '2026-09-09T10:00:00+03:00', 'price': 13000, 'currency': 'TRY', 'source': 'fixture'}
                    ],
                }
            },
        }
        observation = {
            'asin': 'B0HCCFQR78',
            'title': 'Example Phone',
            'observedAt': '2026-09-10T10:00:00+03:00',
            'price': 12699,
            'currency': 'TRY',
            'priceType': 'offer-buying-price',
            'source': 'amazon-creators-api',
        }
        merged = updater.merge_history(history, [observation], '2026-09-10T10:00:00+03:00')
        self.assertEqual(merged['source'], 'amazon-creators-api')
        self.assertEqual(merged['products']['B0HCCFQR78']['points'][-1]['price'], 12699)
        self.assertEqual(len(merged['products']['B0HCCFQR78']['points']), 1)
        self.assertEqual(merged['products']['B0HCCFQR78']['points'][0]['source'], 'amazon-creators-api')

    def test_validation_rejects_missing_or_stale_live_metadata(self):
        history = {
            'version': 2,
            'source': 'amazon-creators-api',
            'generatedAt': '2026-09-09T10:00:00+03:00',
            'products': {
                'B0HCCFQR78': {
                    'title': 'Example Phone',
                    'points': [
                        {'observedAt': '2026-09-09T10:00:00+03:00', 'price': 12699, 'currency': 'TRY', 'source': 'amazon-creators-api'}
                    ],
                }
            },
        }
        with self.assertRaises(updater.UpdaterError):
            updater.validate_history(history, now='2026-09-11T12:00:00+03:00', max_age_hours=24)

    def test_live_configuration_requires_explicit_acknowledgement(self):
        env = {
            'AMAZON_CREDENTIAL_ID': 'id',
            'AMAZON_CREDENTIAL_SECRET': 'secret',
            'AMAZON_API_VERSION': '7.0',
            'AMAZON_PARTNER_TAG': 'tag',
            'AMAZON_MARKETPLACE': 'www.amazon.com.tr',
        }
        with self.assertRaises(updater.MissingConfigurationError):
            updater.load_required_config(env)

    def test_real_sdk_client_is_configured_for_turkey_without_network_call(self):
        env = {
            'AMAZON_CREDENTIAL_ID': 'id',
            'AMAZON_CREDENTIAL_SECRET': 'secret',
            'AMAZON_API_VERSION': '2.2',
            'AMAZON_PARTNER_TAG': 'tag-20',
            'AMAZON_MARKETPLACE': 'www.amazon.com.tr',
            'AMAZON_LIVE_DATA_ACK': updater.ACK_VALUE,
        }
        config = updater.load_required_config(env)
        client = updater._build_client(config)
        try:
            self.assertEqual(client.marketplace, 'www.amazon.com.tr')
            self.assertEqual(len(client._history_resources), 6)
        finally:
            client.close()

    def test_atomic_write_produces_valid_json_without_temp_file(self):
        payload = {'version': 2, 'source': 'amazon-creators-api', 'products': {}}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'price-history.json'
            updater.atomic_write_json(output, payload)
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')), payload)
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
