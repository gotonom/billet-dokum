# Billet Dökümhanesi · Otomasyon Panelleri

Alüminyum billet dökümhanesi için otomasyon panelleri ve süreç simülasyonu. Ergitmeden sevke kadar tüm hattı kapsar. Created by **GOTONOM**.

| Sayfa | Kaynak | İçerik |
|---|---|---|
| `/` | `src/index.html` | Kontrol merkezi: canlı saha planı ve ünite inceleme paneli, metal yolculuğu, sıradaki işlemler, olay akışı, günlük döküm takvimi, son 10 dökümün kalitesi |
| `/firin.html` | `src/firin.html` | E1, E2 ergitme fırınları ve B1 döküm fırını: kesit görünümü, sıcaklık eğrisi, şarj karışımı, OES kimya analizi, "döküme hazır" kapısı, doğalgaz tüketimi |
| `/dokum.html` | `src/dokum.html` | D1 hot-top döküm masası: pit kesiti, 64 kalıbın üstten görünümü, hız ve su reçetesi, anlık ölçümler, manuel müdahale (operatör ve yönetici yetkisi), alarm senaryoları, PLC kilitleri, döküm kayıtları |
| `/homojen.html` | `src/homojen.html` | H1–H5 homojenizasyon fırınları, soğutma odası, ultrasonik muayene, testere ve stok |

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

## Güncelleme

```bash
python3 build.py
PORT=3060 node server.js          # yerel önizleme
git commit -am "..." && git push   # GitHub Pages docs/'u yayınlar
railway up --service billet-dokum --detach
```

Railway projesi `billet-dokum`, servis `billet-dokum` ("Ezagor's Projects"). Servis GitHub'a bağlı değil, CLI ile yüklenir.

## Varsayımlar (tesisle doğrulanacak)

Hiçbir değer henüz bir tesisten gelmedi. Aşağıdakiler sektör kaynaklarına dayanan başlangıç varsayımlarıdır.

| Konu | Varsayım | Dayanak |
|---|---|---|
| Kapasite | Günde 10 döküm (144 dk'da bir), döküm başına ~30 t | EGA Jebel Ali: 60–70 t/döküm, günde 12 döküm (ICSOBA 2024) |
| Ergitme | 2 × 36 t doğalgazlı fırın (4 t sıvı dip + 32 t şarj), 288 dk çevrim, transfer 730–750 °C | Tipik casthouse pratiği |
| Şarj | %34–50 primer, %20–28 iç hurda, kalanı dış hurda | Varsayım |
| Döküm fırını | B1, 35 t, devirmeli, argon lansı + flaks | Varsayım |
| Döküm hattı | SNIF degazör (~380 d/dk, argon ~42 l/dk), AlTi5B1 çubuk ~1 kg/t, 40 ppi seramik köpük filtre | SNIF ~350 d/dk; levha külçesi için 0,5–2 kg/t Ti:B çubuk |
| H₂ | Fırın 0,24–0,32, degazör çıkışı 0,10–0,14 ml/100 g; uyarı > 0,15 | Çıkışta 0,10–0,15 yaygın; profil kabarcığı için üst sınır 0,12–0,15 |
| Masa | Hot-top, 8 × 8 = 64 kalıp, Ø178 mm (7"), 7.000 mm log | Hot-top masada 50–100+ kalıp |
| Hız reçetesi | 50 mm/dk başlangıç → 450 mm'de kararlı hız (6063: 123, 6060: 128, 6082: 105 mm/dk) → son 150 mm'de 80 mm/dk | 152 mm billette 110–130 mm/dk; çap büyüdükçe hız düşer |
| Su | Kalıp başına 45 → 110 l/dk, giriş ~24 °C | Varsayım |
| Oluk metali | 6063: 695 °C, 6060: 692 °C, 6082: 700 °C | Varsayım |
| Hot-top seviyesi | 75 ± 5 mm | Varsayım |
| Kalıp havası ve yağ | Kalıp başına 1,6 Nl/dk hava ve 0,5 ml/dk yağ | Varsayım |
| PLC kilitleri | Pit suyu ≥ 0,9 m; su yüzeyi kalıbın ≥ 3 m altında; su < %70 hedefse acil bitiş; bleed-out'ta kalıp tıkanır, 3 kalıpta acil bitiş; oluk metali 675 °C altındaysa başlatma kilidi; H₂ > 0,20 ise başlatma kilidi; operatör hızı en fazla %10 düşürebilir, artırma yönetici yetkisi; filtre ΔP ≤ 35 mm | Pit kuralları sektör uygulama kodlarından (~3 ft su, kalıbın ~10 ft altı); diğerleri varsayım |
| Homojenizasyon | 5 parti fırını, 580 °C'de ≥ 6 sa bekletme, 12 sa çevrim | 6063 için 575–585 °C × 4–6 sa |
| Soğutma | Fan ve su sisi, 580 → 250 °C arası ~400 °C/sa (hedef > 250) | > 200–300 °C/sa önerilir |
| Testere | Baş 300 mm, kuyruk 200 mm kesim; ürün 6.500 mm; UT red oranı ~%18 dökümde 1 log | Varsayım |
| Verim ve enerji | Cüruf 15–23 kg/t, doğalgaz 72–86 Nm³/t, metal verimi ~%90–91 | Cüruf 15–25 kg/t tipik |
