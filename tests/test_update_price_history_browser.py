import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / 'scripts' / 'update_price_history_browser.py'
FIXTURES = ROOT / 'tests' / 'fixtures'
BROWSER_SOURCE = 'amazon-browser-visible'

browser_updater = None
if MODULE_PATH.exists():
    spec = importlib.util.spec_from_file_location('update_price_history_browser', MODULE_PATH)
    browser_updater = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules['update_price_history_browser'] = browser_updater
    spec.loader.exec_module(browser_updater)


class BrowserPriceHistoryTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(browser_updater, 'scripts/update_price_history_browser.py henüz eklenmedi')

    def test_parses_turkish_price_with_spaced_thousands_separator(self):
        self.assertEqual(browser_updater.parse_price('13.999 ,,00 TL'), 13999)

    def test_parses_turkish_try_price_from_json_ld(self):
        html = (FIXTURES / 'amazon-product-good.html').read_text(encoding='utf-8')
        observation = browser_updater.parse_product_html(
            html,
            asin='B0HCCFQR78',
            observed_at='2026-09-11T10:00:00Z',
        )
        self.assertEqual(observation['asin'], 'B0HCCFQR78')
        self.assertEqual(observation['title'], 'General Mobile Gm 26 5G 8+128 GB Akıllı Telefon Siyah')
        self.assertEqual(observation['price'], 12699)
        self.assertEqual(observation['currency'], 'TRY')
        self.assertEqual(observation['seller'], 'Amazon.com.tr')
        self.assertEqual(observation['availability'], 'in_stock')
        self.assertEqual(observation['source'], BROWSER_SOURCE)

    def test_rejects_robot_check_or_captcha_page(self):
        html = (FIXTURES / 'amazon-product-blocked.html').read_text(encoding='utf-8')
        with self.assertRaises(browser_updater.BlockedPageError):
            browser_updater.parse_product_html(
                html,
                asin='B0HCCFQR78',
                observed_at='2026-09-11T10:00:00Z',
            )

    def test_rejects_ambiguous_multiple_offers_without_featured_offer(self):
        html = '''
        <script type="application/ld+json">
        {"@type":"Product","name":"Example","offers":[
          {"@type":"Offer","price":"12000","priceCurrency":"TRY","availability":"https://schema.org/InStock"},
          {"@type":"Offer","price":"13000","priceCurrency":"TRY","availability":"https://schema.org/InStock"}
        ]}
        </script>
        '''
        with self.assertRaises(browser_updater.AmbiguousPriceError):
            browser_updater.parse_product_html(
                html,
                asin='B0HCCFQR78',
                observed_at='2026-09-11T10:00:00Z',
            )

    def test_rejects_non_try_or_missing_price(self):
        html = '''
        <script type="application/ld+json">
        {"@type":"Product","name":"Example","offers":{"@type":"Offer","price":"99.99","priceCurrency":"USD"}}
        </script>
        '''
        with self.assertRaises(browser_updater.InvalidObservationError):
            browser_updater.parse_product_html(
                html,
                asin='B0HCCFQR78',
                observed_at='2026-09-11T10:00:00Z',
            )

    def test_merge_replaces_fixture_points_and_keeps_browser_source(self):
        history = {
            'version': 1,
            'source': 'fixture',
            'note': 'Bu dosya örnek geçmiş verisidir; canlı Amazon fiyatı değildir.',
            'products': {
                'B0HCCFQR78': {
                    'title': 'Example',
                    'points': [
                        {'observedAt': '2026-09-10T10:00:00Z', 'price': 13000, 'currency': 'TRY', 'source': 'fixture'}
                    ],
                }
            },
        }
        observation = {
            'asin': 'B0HCCFQR78',
            'title': 'Example',
            'observedAt': '2026-09-11T10:00:00Z',
            'price': 12699,
            'currency': 'TRY',
            'priceType': 'visible-offer-price',
            'source': BROWSER_SOURCE,
            'availability': 'in_stock',
        }
        merged = browser_updater.merge_browser_history(
            history,
            [observation],
            generated_at='2026-09-11T10:00:00Z',
        )
        self.assertEqual(merged['source'], BROWSER_SOURCE)
        self.assertNotIn('örnek geçmiş', merged.get('note', '').casefold())
        self.assertEqual(merged['products']['B0HCCFQR78']['points'][0]['price'], 12699)
        self.assertEqual(merged['products']['B0HCCFQR78']['points'][0]['source'], BROWSER_SOURCE)

    def test_dry_run_does_not_modify_output_file(self):
        payload = {'version': 1, 'source': 'fixture', 'products': {}}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'price-history.json'
            output.write_text(json.dumps(payload), encoding='utf-8')
            result = browser_updater.write_history_if_requested(output, payload, dry_run=True)
            self.assertFalse(result)
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')), payload)

    def test_update_once_dry_run_fetches_targets_without_writing_history(self):
        good_html = (FIXTURES / 'amazon-product-good.html').read_text(encoding='utf-8')
        index_html = '''
        <a href="https://www.amazon.com.tr/Example/dp/B0HCCFQR78">one</a>
        <a href="https://www.amazon.com.tr/Example/dp/B0HCCS6JTX">two</a>
        '''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            index_path = root / 'index.html'
            output_path = root / 'price-history.json'
            index_path.write_text(index_html, encoding='utf-8')
            original = {'version': 1, 'source': 'fixture', 'products': {}}
            output_path.write_text(json.dumps(original), encoding='utf-8')
            fetched_urls = []

            def fetcher(url):
                fetched_urls.append(url)
                return good_html

            result = browser_updater.update_once(
                index_path=index_path,
                output_path=output_path,
                dry_run=True,
                delay_seconds=0,
                page_fetcher=fetcher,
            )
            self.assertTrue(result['dryRun'])
            self.assertEqual(result['products'], 2)
            self.assertEqual(len(fetched_urls), 2)
            self.assertEqual(json.loads(output_path.read_text(encoding='utf-8')), original)

    def test_live_url_must_be_public_amazon_turkey_product_page(self):
        self.assertTrue(browser_updater.is_allowed_product_url(
            'https://www.amazon.com.tr/Example/dp/B0HCCFQR78'
        ))
        self.assertFalse(browser_updater.is_allowed_product_url(
            'https://www.amazon.com.tr/gp/cart/view.html'
        ))
        self.assertFalse(browser_updater.is_allowed_product_url(
            'https://example.com/dp/B0HCCFQR78'
        ))


if __name__ == '__main__':
    unittest.main()
