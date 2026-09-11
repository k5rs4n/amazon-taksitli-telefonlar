# Browser updater doğrulama bulguları

## Gerçek Amazon Türkiye dry-run

2026-09-11 tarihinde mevcut `index.html` içindeki üç Amazon Türkiye ürün URL'si Chromium ile açıldı. İlk denemede Redmi Pad fiyatının sayfadan `13.999 ,,00` biçiminde dönmesi parser'ın işlemi güvenli biçimde durdurmasına neden oldu; dosyaya yazım yapılmadı. Türkçe ayraç parser'ı fixture testiyle düzeltildikten sonra aynı üç URL tekrar çalıştırıldı.

Son dry-run sonucu üç ürünün tamamı başarılı oldu. Kaynak `amazon-browser-visible`, gözlem zamanı `2026-09-11T19:59:06Z` dry-run ve başarılı yazım zamanı `2026-09-11T20:00:57Z` olarak kaydedildi. Üç ürünün dönen fiyatları sırasıyla ASIN bazında `B0HCCFQR78: 14.999 TRY`, `B0HCCS6JTX: 25.999 TRY`, `B0BJ2WHW4B: 13.999 TRY`; her üçünde uygunluk `in_stock` olarak okundu. Fiyat geçmişi dosyası yalnızca doğrulanmış yazım komutundan sonra güncellendi.

## Frontend doğrulaması

Güncellenen site geçici HTTP sunucusunda açıldı. Console'da JavaScript hatası oluşmadı; iki mevcut uyarı Quirks Mode/harici Google Analytics kaynaklıydı. İlk ürünün geçmiş paneli açıldı ve `Kaynak: Amazon görünür ürün sayfası` ile son canlı güncelleme zamanı gösterildi. Panelde son gözlem `₺14.999,00` olarak göründü; mevcut ana ürün kartındaki eski liste fiyatının ayrı kalması beklenen davranıştır ve bu turda çalışan ürün kartı verisi değiştirilmemiştir.

390×844 mobil görünümde arama, filtre alanı, kişisel liste araçları, fiyat geçmişi paneli, grafik ve ürün listesi viewport dışına taşmadan render edildi. Mobil snapshot'ta da JavaScript hatası oluşmadı.

## Test özeti

- Node UI/regresyon testleri: 6 başarılı.
- Gelişmiş özellik testleri: 7 başarılı.
- Creators API legacy + browser updater Python testleri: 16 başarılı.
- Python syntax/compile kontrolü: başarılı.
- Gerçek Chromium Amazon dry-run: 3/3 ürün başarılı.
- Gerçek yazma: atomik olarak başarılı.
- Sandbox ve Windows yerel kopyası kritik dosya hashleri: eşleşti.
