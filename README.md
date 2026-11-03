# Billet Dökümhanesi · Otomasyon Panelleri

Alüminyum billet dökümhanesi için otomasyon panelleri ve süreç simülasyonu. Ergitmeden sevke kadar tüm hattı kapsar. Created by **GOTONOM**.

| Sayfa | Kaynak | İçerik |
|---|---|---|
| `/` | `src/index.html` | Kontrol merkezi: canlı saha planı ve ünite inceleme paneli, metal yolculuğu, sıradaki işlemler, olay akışı, günlük döküm takvimi, son 10 dökümün kalitesi |
| `/firin.html` | `src/firin.html` | E1, E2 ergitme fırınları ve B1 döküm fırını: kesit görünümü, sıcaklık eğrisi, şarj karışımı, OES kimya analizi ve düzeltme reçetesi (hangi malzemeden kaç kg), elle alaşım düzeltme hesabı, "döküme hazır" kapısı, doğalgaz tüketimi |
| `/dokum.html` | `src/dokum.html` | D1 hot-top döküm masası: pit kesiti, 64 kalıbın üstten görünümü, hız ve su reçetesi, anlık ölçümler, manuel müdahale (operatör ve yönetici yetkisi), alarm senaryoları, PLC kilitleri, döküm kayıtları |
| `/homojen.html` | `src/homojen.html` | H1–H5 homojenizasyon fırınları (alaşıma özel reçete), soğutma odası, soğuma tamponu, ultrasonik muayene, testere, log izlenebilirliği ve stok |

- **Canlı (Railway):** https://billet-dokum-production.up.railway.app
- **GitHub Pages:** https://gotonom.github.io/billet-dokum/

PLC bağlantısı kurulana kadar paneller örnek veriyle çalışan bir simülasyon gösterir. Tesisin her ünitesi `src/common.js` içindeki aynı modelden, tesis saatinin saf bir fonksiyonu olarak hesaplanır. Bu yüzden kontrol merkezi ile detay sayfaları her zaman aynı durumu gösterir.

- **×1:** gerçek saat.
- **×10 ve ×60:** hızlı demo. Hız ayarı sayfalar arasında geçerken de korunur.
- **Etaplar:** her etap kutusuna tıklayınca demo o etaba atlar.

## Yapı

| Yol | Ne |
|---|---|
| `src/common.css` | Ortak görünüm: MAKOM kontrol odası dili, açık ve koyu tema |
| `src/common.js` | Tesis modeli (döküm, fırınlar, homojenizasyon, soğutma, testere), simülasyon saati, grafik yardımcısı |
| `src/*.html` | Sayfa kaynakları. `/*@COMMON_CSS*/` ve `//@COMMON_JS` yer tutucuları derlemede doldurulur |
| `build.py` | Her kaynağı ortak dosyalarla birleştirip tek dosyalık tam bir HTML olarak `docs/`'a yazar |
| `docs/` | Yayınlanan sayfalar |
| `server.js` | `docs/` sayfalarını `$PORT` üzerinden sunan bağımlılıksız Node sunucusu. Sayfaları her istekte diskten okur |
| `test/model_check.js` | Modeli birkaç simüle gün boyunca tarar: üniteler arası etap uyumu, kütle dengesi, kimya, homojenizasyon sınırları, gün içinde düşmeyen toplamlar |

## Paylaşım kartları (Open Graph)

Her sayfanın 1200 × 630 paylaşım görseli `docs/og/` içinde. Kartlar her panelin canlı şemasını gösterir: ergitme fırını, döküm hattı ve pit kesiti, son işlem hattı. Kontrol merkezi kartında bu üçü bir arada. Kaynağı `og/og.html` (#index, #firin, #dokum, #homojen): sayfaları yerel bir HTTP sunucusundan iframe ile yükler, tesisi anlamlı bir ana getirir (döküm ortası, ergitme sonu, soğutma) ve yalnızca şemayı alır. `python3 build.py && python3 og/render.py` headless Chrome ile yeniden üretir. Kartlar değişince `build.py` içindeki `OG_VERSION` artırılır, böylece eski önizlemeyi önbellekte tutan uygulamalar yenisini çeker.

## Güncelleme

```bash
python3 build.py
node test/model_check.js          # model kontrolleri
python3 og/render.py              # şemalar değiştiyse paylaşım kartları
PORT=3060 node server.js          # yerel önizleme
git commit -am "..." && git push   # GitHub Pages docs/'u yayınlar
railway up --service billet-dokum --detach
```

Railway projesi `billet-dokum`, servis `billet-dokum` ("Ezagor's Projects"). Servis GitHub'a bağlı değil, CLI ile yüklenir.

## Model kuralları

- **Kütle dengesi:** her döküm için ergitme fırınına şarj = transfer + cüruf − alaşım ilavesi; B1'e transfer = brüt döküm + oluk/filtre artığı (0,45 t) + B1 cürufu (0,12 t). Fırınlar her döngüyü normal dip seviyesinde bitirir (E 4 t, B1 3 t).
- **Alaşım değişimi:** eski metalin dibi yeni alaşımın bir elementini penceresinin yarısından fazla kaydıracaksa (ör. 6082 → 6063), dip şarjdan veya dolumdan önce sow kalıplarına boşaltılır (0,5 t kalır).
- **Kimya:** ergitme fırınında numune 1 → düzeltme → numune 2. Fırın hedefi, B1'deki dip ve arıtmadaki Mg kaybı (0,01) hesaba katılarak ayarlanır. Döküm kimyası **B1'deki onay numunesiyle** onaylanır.
- **Göstergeler:** döküm verimi = iyi billet / brüt döküm; ergitme kaybı = (ergitme + B1 cürufu) / şarj; doğalgaz = ergitme + B1 + homojenizasyon / brüt döküm. Hepsi aynı modelden hesaplanır.
- **Kilitler:** acil bitiş "metal kesik, su açık" güvenli durumuna geçer. Kilidi yalnızca yönetici kaldırır; kilit sonraki döküme taşınır ve onu başlatmaz, demo etap atlaması da kilitliyken çalışmaz.

## Varsayımlar (tesisle doğrulanacak)

Hiçbir değer henüz bir tesisten gelmedi. Aşağıdakiler sektör kaynaklarına ve Kasım 2026 denetimine dayanan başlangıç varsayımlarıdır.

| Konu | Varsayım | Dayanak |
|---|---|---|
| Kapasite | Günde 10 döküm (144 dk'da bir), döküm başına ~30 t brüt | EGA Jebel Ali: 60–70 t/döküm, günde 12 döküm (ICSOBA 2024) |
| Ergitme | 2 × 36 t rejeneratif doğalgazlı fırın (tam güç 750 Nm³/h ≈ 7,5 MW), 288 dk çevrim, transfer 730–750 °C | Rejeneratif fırında ölçülen ~72 Nm³/t (CCT 2024); modelde ~75 Nm³/t |
| Şarj | %34–50 primer, %20–28 iç hurda, kalanı dış hurda | Varsayım |
| Döküm fırını | B1, 3 t dip + ~30 t transfer, devirmeli; argon lansı + flaks 8 dk, cüruf alma, onay numunesi, ~14 dk dinlendirme | Varsayım |
| Döküm hattı | SNIF degazör (2 rotor, ~380 d/dk, argon ~42 l/dk), AlTi5B1 çubuk ~0,8 kg/t, 40 ppi seramik köpük filtre | ~32 t/h akış için iki rotorlu degazör; tane inceltici düşük oranlara iniyor |
| H₂ | B1 fırını (Alspek) 0,22–0,30, başlatma sınırı 0,30; degazör çıkışı 0,10–0,14, döküm sırasında alarm > 0,15 | Çıkış sensörü metal akmadan ölçmez; başlatma kilidi fırın ölçümüne bağlı |
| Masa | Hot-top, 8 × 8 = 64 kalıp, Ø178 mm (7"), 7.000 mm log | Hot-top masada 50–100+ kalıp |
| Hız reçetesi | 50 mm/dk başlangıç → 250 mm'de kararlı hız (6063: 123, 6060: 128, 6082: 105 mm/dk) → son 150 mm'de 80 mm/dk | 152 mm billette 110–130 mm/dk; çoğu reçete 100–250 mm'de kararlı hıza çıkar |
| Su | Kalıp başına 45 → 110 l/dk (~420 m³/h masa); metal kesildikten sonra 6 dk tam, 2 dk azalarak; dönüş +12–16 °C | Isı dengesi: kalıp başına ~140 kW |
| Su kilidi | Alarm %90, kesme %80 hedef ve kalıp başına en az 35 l/dk; yerçekimli acil su tankı ≥ %80; su kalitesi (pH, iletkenlik) ve pit suyu sıcaklığı izlenir | Varsayım |
| Oluk metali | 6063: 695 °C, 6060: 692 °C, 6082: 700 °C | 6063 için ~690 °C (Türkiye DC tezi) |
| Hot-top seviyesi | 75 ± 5 mm; kalıp başına 1,6 Nl/dk hava ve 0,5 ml/dk yağ | Varsayım |
| Diğer PLC kilitleri | Pit suyu ≥ 0,9 m; su yüzeyi kalıbın ≥ 3 m altında; bleed-out'ta kalıp tıkanır, 3 kalıpta acil bitiş; oluk metali 675 °C altında başlatma kilidi; operatör hızı en fazla %10 düşürebilir, artırma yönetici yetkisi; filtre ΔP ≤ 35 mm | Pit kuralları sektör uygulama kodlarından (~3 ft su, kalıbın ~10 ft altı) |
| Alaşım düzeltmesi | Pencere: fırın hedefi ± maks(0,015; aralığın %5'i). Pencerenin altındaki alaşım elementi fırın hedefine çıkarılır; miktarlar birlikte çözülür. Fe yalnızca minimumun altına düşerse eklenir. Maksimumu aşan element için primer seyreltme miktarı, seyreltmeden sonraki ilave ve kimyaya (alt sınırlar dahil) uyan alternatif alaşım verilir | Varsayım |
| Katkı malzemeleri (verim) | Si metal %98,5 (%92) · saf Mg %99,8 (%90, en son, banyo altına) · Mn tablet %75 (%95) · AlCu50 (%98) · Fe tablet %75 (%95) | Varsayım, tesisin kendi verimleriyle güncellenecek |
| Homojenizasyon | 5 parti fırını (2,6 MW), 12 sa çevrim, ≥ 6 sa bekletme. 6063/6060: 575–585 °C, hava ≤ 600 °C. 6082: 550–565 °C, hava ≤ 575 °C (katılaşma bitişi ~580 °C) | 6082 endüstriyel pratiği ~550 °C × 5 sa (UQAC tezi); fırınlar %100 dolu, bakım payı yok |
| Soğutma | Fan ve su sisi 60 dk, bekletme sıcaklığından 250 °C'ye ~400 °C/sa; sonra 4 sa soğuma tamponu, UT girişi ≤ 60 °C | > 200–300 °C/sa önerilir; su temaslı UT sıcak logda çalışmaz |
| Testere ve kalite | Dip (başlangıç ucu) 300 mm, baş 200 mm kesim; ürün 6.500 mm; ~%18 dökümde 1 log UT reddi. Her döküm için LiMCA N20 (4–10 k/kg), her parti için β → α AlFeSi dönüşümü (≥ %90) | Varsayım |
| Verim ve enerji | Cüruf 15–23 kg/t, ergitme kaybı ~%2,2, döküm verimi ~%91, doğalgaz ~108 Nm³/t brüt | Ergitme kaybı %1,5–2,5, döküm verimi %90–93 tipik |
