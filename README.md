# Amazon Taksitli Telefonlar

Amazon.com.tr sitesindeki taksitli telefonların listesi olan bir repodur.

Link : https://k5rs4n.github.io/amazon-taksitli-telefonlar/

⚠️ Bilgilendirme

Bu sayfa, Amazon Türkiye'de yer alan ve taksit seçeneği bulunduğu tespit edilen telefonların otomatik olarak derlenmesiyle oluşturulmaktadır. Ürün fiyatları, taksit seçenekleri, stok durumu ve kampanyalar zaman içerisinde değişebilir. En güncel ve kesin bilgiler için ürün sayfasını ziyaret ederek satın alma işlemi öncesinde bilgileri doğrulayınız. Bu site Amazon'un resmi bir hizmeti değildir ve Amazon ile herhangi bir ticari ilişkisi bulunmamaktadır. Burada yer alan marka, ürün ve görseller ilgili hak sahiplerine aittir. Listeleme sırasında oluşabilecek eksik veya hatalı bilgilerden dolayı sorumluluk kabul edilmez.

💡 Proje Hakkında

Bu proje, Amazon Türkiye'de taksitli telefon arayan kullanıcıların ürünleri daha kolay bulabilmesi amacıyla hazırlanmış bağımsız bir çalışmadır. Liste düzenli olarak güncellense de bilgilerin doğruluğu ve güncelliği garanti edilmez.

Bu sitede herhangi bir satış işlemi yapılmaz. Ürün bağlantıları ilgili satıcının sayfasına yönlendirmektedir.

## Eklenen özellikler

Ana sayfa sade bir dashboard düzenine sahiptir: üst bölümde arama ve filtreler, dört özet kartında ürün sayısı, en düşük fiyat, aktif alarm ve kişisel liste sayısı, yanında kısa kullanım ipuçları ve altında ürün kataloğu bulunur. Dashboard açık zemin, koyu kontrol paneli ve turuncu/teal durum renkleriyle tasarlanmıştır; masaüstü ve mobil ekranlarda yatay taşma yapmadan responsive çalışır.

Ürün kartlarında favoriye ekleme, izleme listesi, ürün paylaşımı, fiyat geçmişi ve yerel fiyat alarmı görünümü bulunur. Fiyat geçmişi panelinde 7 gün, 30 gün ve tüm geçmiş dönemleri; güncel fiyat, ilk-son değişim, ortalama, en düşük/en yüksek fiyat, gözlem sayısı, trend ve veri güveni özetleri gösterilir. SVG grafik üzerinde ortalama çizgisi, alan dolgusu, erişilebilir fiyat noktaları ve nokta detay tooltip'i bulunur. Favoriler ve izleme listesi satırlarından doğrudan fiyat alarmı açılabilir. Favoriler, izleme listesi ve alarm ayarları yalnızca aynı tarayıcıdaki site depolamasında tutulur; hesaplar arasında senkronizasyon yapılmaz ve tarayıcı verileri temizlenirse kayıtlar silinebilir.

Site ayrıca GitHub Pages proje adresiyle uyumlu bir PWA manifesti ve sürümlü service worker içerir. Daha önce açılmış uygulama kabuğu çevrimdışı gösterilebilir; Amazon ürün sayfası, canlı fiyat ve satın alma bağlantısı için internet bağlantısı gerekir.

`data/price-history.json` içindeki grafik verisi browser-visible updater ile güncellenen gözlemlerden oluşur; fiyat yine satın alma öncesinde Amazon sayfasında doğrulanmalıdır. Yerel fiyat alarmı; hedef fiyat, bir önceki gözleme göre yüzde düşüş ve stok yeniden geldiğinde bildirim koşullarını destekler. Bildirimler sayfa içi gösterilir; kullanıcı açıkça izin verirse tarayıcı Notification API de kullanılır. Bu sürümde bilgisayar kapalıyken kontrol çalışmaz ve Telegram/e-posta gibi uzak bildirim kanalları yoktur.

## Yerel fiyat alarmı

Ürün kartındaki `Alarm`, favori/izleme listesi satırındaki `Fiyat alarmı` veya üst araç çubuğundaki `Fiyat alarmları` düğmesiyle alarm paneli açılır. En az bir koşul seçilebilir: hedef fiyat, gözlemden gözleme yüzde düşüş veya ürün stokta yokken yeniden stok bildirimi. Alarm ayarları aynı tarayıcıda saklanır ve her sayfa açılışında güncel fiyat geçmişiyle kontrol edilir. Aynı gözlem için tekrar bildirim üretilmez.

Tarayıcı bildirimleri varsayılan olarak otomatik istenmez. Kullanıcı `Bildirimleri aç` düğmesine basarak izin verirse desteklenen tarayıcılarda sistem bildirimi gösterilir; izin verilmezse alarm yalnızca sayfa içi uyarı olarak gösterilir.

## Yerel browser fiyat geçmişi updater'ı

`scripts/update_price_history_browser.py`, mevcut ürün kartlarındaki herkese açık Amazon Türkiye ürün URL'lerini açar ve öncelikle sayfadaki JSON-LD ürün verisini, gerekirse görünür fiyat alanını okur. Amazon Creators API, Amazon hesabı girişi, sepet/ödeme akışı, CAPTCHA çözme, proxy rotasyonu veya bot koruması aşma kullanılmaz. Fiyat, satıcı, uygunluk, gözlem zamanı ve `amazon-browser-visible` veri kaynağı birlikte saklanır.

Updater varsayılan olarak **dry-run** çalışır; başarılı sonuçları ekrana yazdırır fakat JSON dosyasını değiştirmez. CAPTCHA, robot uyarısı, login ekranı, TRY olmayan fiyat, belirsiz çoklu teklif veya eksik fiyat durumunda tüm işlem durur ve mevcut geçmiş korunur. Başarılı yazım atomiktir; stale-data kontrolü 24 saatlik güncellik sınırını uygular.

### Windows'ta kurulum ve dry-run

PowerShell'i proje klasöründe açın. Yardımcı script, `.venv` klasörünü oluşturur, Playwright'ı ve Chromium tarayıcısını kurar, ardından güvenli dry-run çalıştırır:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\update-price-history-browser.ps1
```

Dry-run çıktısı üç ürün için de doğru görünüyorsa JSON dosyasını yazmak için açıkça `-Write` kullanılır:

```powershell
.\scripts\update-price-history-browser.ps1 -Write
```

İlk denemede tarayıcı penceresini görünür açmak için `-Headed`, ürünler arası beklemeyi ayarlamak için `-DelaySeconds 1`, güvenlik sınırını değiştirmek için `-MaxProducts 20` kullanılabilir. Varsayılan maksimum ürün sayısı 20'dir ve varsayılan bekleme süresi 1 saniyedir.

Doğrudan Python komutları da kullanılabilir:

```powershell
python -m pip install -r requirements-browser.txt
python -m playwright install chromium
python scripts/update_price_history_browser.py
python scripts/update_price_history_browser.py --write
```

Bilgisayar kapalıyken güncelleme çalışmaz. Otomatik çalıştırma gerekirse Windows Task Scheduler'da `scripts/update-price-history-browser.ps1` dosyasını günde en fazla bir kez tetiklemek önerilir. İlk üç başarılı dry-run gözlemlenmeden zamanlanmış yazma görevi kurulmayacaktır.

### Güvenlik ve kullanım sınırı

Amazon sayfalarının otomatik okunması kullanım şartlarına ve erişim politikalarına tabi olabilir. Bu updater CAPTCHA çözmez, erişim engelini aşmaz, login olmaz ve gizli Amazon endpoint'lerini çağırmaz. Belirsiz sonuçta tahmin yürütmez. Yayınlanmış veya ticari kullanım öncesinde [Amazon Conditions of Use](https://www.amazon.com/gp/help/customer/display.html?nodeId=508088), [Amazon Türkiye robots.txt](https://www.amazon.com.tr/robots.txt) ve ilgili diğer şartlar kullanıcı tarafından doğrulanmalıdır.

`scripts/update_price_history.py` ve `requirements-updater.txt` Creators API için önceki/legacy uygulama olarak tutulmaktadır; yeni browser workflow bunları kullanmaz. Creators API GitHub Actions workflow'u otomatik çalışmaması için devre dışı bırakılmıştır.

## Yerel testler

Node.js kurulu bir ortamda mevcut davranış ve eklenen özellik testlerini şu komutlarla çalıştırabilirsiniz:

```bash
node tests/ui.test.js
node tests/advanced.test.js
node tests/history-analysis.test.js
node tests/price-alerts.test.js
python -m unittest discover -s tests -p 'test_update_price_history.py'
python -m unittest discover -s tests -p 'test_update_price_history_browser.py'
```
