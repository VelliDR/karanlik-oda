# Foton: Karanlık Oda

Modern web standartları üzerinde çalışan; analog film emülsiyonlarını, vintage optik mercek kusurlarını ve fotokimyasal banyo süreçlerini doğrudan tarayıcı içinde simüle eden istemci taraflı (client-side) profesyonel bir karanlık oda işleme motorudur.

Uzak sunuculara bağımlılığı yoktur. Görseller ve ham kamera verileri hiçbir koşulda cihaz dışına aktarılmaz; tüm hesaplamalar **WebGPU, C++ WebAssembly (WASM SIMD), Web Worker, HTML5 Canvas / OffscreenCanvas ve ONNX Runtime Web** mimarisi üzerinde, yerel donanım hızlandırmasıyla çalışır.

---

## Mimari Tasarım ve Sistem Akışı

Foton, klasik dijital fotoğraf editörlerinde sıkça kullanılan basit CSS filtrelerini (`brightness`, `contrast`, `saturate`) ve düz renk bindirmelerini (`fillRect`) tamamen devre dışı bırakır. Bunun yerine ışığın mercekten geçişini, sensörün doğrusal foton yanıtını, gümüş halojenür kristallerinin spektral boya tepkisini ve selüloz film tabanındaki geri sekmeleri fiziksel formüllerle işler.

```mermaid
flowchart TD
    subgraph Input ["1. Giriş ve Dosya Ayrıştırma"]
        A[Kullanıcı Görseli] --> B{Dosya Türü}
        B -->|RAW: .dng, .cr2, .cr3, .nef, .arw, .raf| C[LibRaw C++ WASM SIMD Worker]
        B -->|HEIC / HEIF| D[heic2any Çözücü]
        B -->|JPEG, PNG, WebP| E[Tarayıcı ImageBitmap Motoru]
    end

    subgraph Demosaic ["2. Sensör İşleme & Ham Veri"]
        C --> F[16-Bit Doğrusal Bayer Demosaic]
        C --> G[EXIF & Çekim Metaverisi]
        F --> H[Doğrusal Float32 / Uint16 Tamponu]
    end

    subgraph DepthEngine ["3. Derinlik & Akıllı Analiz"]
        E --> P[Depth Anything V2 ONNX Runtime Web]
        H --> P
        P --> Q[Piksel Düzeyinde 3D Derinlik Haritası]
        Q --> Q1[7x7 Bilateral Gauss Filtresi]
        Q1 --> Q2[Merkez Altın Oran Histogram Modu ile Akıllı AF]
        Q1 --> Q3[Etkileşimli Vizör Tap-to-Focus Retikülü]
    end

    subgraph CoreEngine ["4. Çekirdek Renk ve Optik Pipeline"]
        D --> I[Piksel Dokusu / Canvas]
        E --> I
        H --> I
        I --> J[WebGPU Renk ve Sensitometri Hattı]
        J --> K[Hurter & Driffield Duyarlık Eğrisi]
        J --> L[3D LUT Tetrahedral Enterpolasyon]
        J --> M[Helios 44M WebGPU Swirl & Cat-Eye Motoru]
        Q1 --> M
        J --> N[650nm Spektral Halasyon & 35mm Nutting Greni]
        J -.->|WebGPU Desteklenmezse| O[CPU 1:1 Tetrahedral Fallback Motoru]
    end

    subgraph UI ["5. Amber Darkroom Arayüzü"]
        S[Preact 10 + Signals Durum Yönetimi]
        S --> T[Hassas Dokunmatik Sürgüler & Haptic Feedback]
        S --> U[Saf Vektörel SVG Simge Sistemi]
        S --> V[Canlı Zone System Histogramı]
        S --> W[Öncesi / Sonrası Karşılaştırma]
    end

    subgraph Export ["6. Dışa Aktarım Hattı"]
        J --> X[Export Web Worker & OffscreenCanvas]
        O --> X
        X --> Y[300 DPI JFIF/EXIF/pHYs Segment Enjeksiyonu]
        Y --> Z[Kaydedilen Master Görsel]
    end
```

---

## Kütüphaneler ve Teknoloji Yığını

Projede harici kütüphane seçimi yapılırken **sıfır izleyici (telemetry-free), bağımsız, hafif ve doğrudan donanımı kontrol edebilme** prensipleri esas alınmıştır:

| Kütüphane / Teknoloji | Sürüm | Seçim Nedeni ve Mimari Rolü |
| :--- | :--- | :--- |
| **[Preact](https://preactjs.com/)** | `^10.26.4` | Yalnızca ~3.5 KB çekirdek boyutuyla React ekosisteminin tüm avantajlarını sunar; gereksiz Virtual DOM yükünü ortadan kaldırarak mobil cihazlarda akıcı bir arayüz sağlar. |
| **[@preact/signals](https://preactjs.com/guide/v10/signals/)** | `^2.0.1` | İnce granüler (fine-grained) reaktivite sunar. Sürgü kaydırmalarında tüm bileşen ağacını yeniden çizmek yerine yalnızca ilgili DOM düğümünü ve WebGPU uniform tamponunu 60–120 FPS hızında günceller. |
| **[LibRaw (C++)](https://www.libraw.org/) -> WASM** | `0.21+` | Dijital fotoğrafçılık standardı olan LibRaw motoru, bağımsız C++ sarmalayıcımızla (`native/libraw_wrapper.cpp`) Emscripten üzerinden SIMD-128 destekli WebAssembly olarak derlenmiştir. Profesyonel kameraların ham sensör verilerini 16-bit doğrusal demosaic eder. |
| **WebGPU API & WGSL** | W3C Standart | `texture_3d<f32>` formatında 3D LUT profillerini, analitik Vesica Piscis kedi gözü swirl bokeh'i, Jorge Jimenez IGN dither'ı, H&D eğrilerini ve spektral halasyonu doğrudan GPU paralel iş parçacıklarında mikro-saniyeler içinde hesaplar. |
| **[ONNX Runtime Web](https://onnxruntime.ai/)** | `^1.21.0` | Tarayıcı içinde yapay zekâ çıkarımı (inference) sağlar. Depth Anything V2 modelini WebGPU ve WASM SIMD arka uçlarıyla çalıştırarak piksel düzeyinde fiziksel alan derinliği haritası üretir. |
| **[Tailwind CSS](https://tailwindcss.com/)** | `^4.0.0` | Yeni CSS tabanlı `@theme` mimarisiyle, analog karanlık oda ortamlarına özel Amber Darkroom renk paletini (`#F2A93B`, `#0B0C10`, `#1A1D24`) ve yüksek yoğunluklu dokunmatik kontrolleri tanımlar. |
| **[heic2any](https://github.com/alexcorvi/heic2any)** | `^0.0.4` | Apple iPhone cihazlarından gelen HEIC/HEIF konteynerlerini tarayıcı içinde yerel olarak kayıpsız çözer. |
| **[Vite](https://vitejs.dev/)** | `^8.3.5` | ES modül tabanlı ultra hızlı geliştirme ortamı ve optimize edilmiş üretim paketi derlemesi sağlar. |
| **[vite-plugin-pwa](https://vite-pwa-org.netlify.app/)** | `^0.21.1` | Workbox altyapısıyla WASM çekirdeğini, stilleri ve kod parçalarını yerel diske önbelleğe alarak uygulamanın internet olmadan (%100 çevrimdışı) çalışmasını sağlar. |

---

## Fiziksel ve Matematiksel Modelleme

### 1. WebGPU Helios 44M-4 Dönen Bokeh ve Sinematik Optik Motoru

Klasik 58mm f/2 Helios 44M ve Biotar optik formülü, mekanik diyafram tüpünün kenarlarda ışığı kesmesi (vignetting) ve teğetsel astigmatizm nedeniyle imza niteliğinde dairesel dönen (swirl) bokeh üretir. Bu fiziksel fenomen WebGPU üzerinde tek geçişli tam ekran üçgen gölgelendirici (fullscreen triangle shader) ile modellenmiştir:

* **Analitik Vesica Piscis Kedi Gözü Sınır Kırpması:**
  Merkezden uzaklaştıkça diyafram açıklığı dairesellikten çıkar ve iki çemberin arakesiti olan badem/kedi gözü formuna (`Vesica Piscis`) dönüşür. Merkez kaçıklık mesafesi $D_{\text{tube}} = r^2 \cdot K_{\text{cat}}$ hesaplanarak optik eksene göre $d_1, d_2$ mesafeleri analitik olarak sınırlandırılır:
  $$\max(d_1, d_2) > 1.0 \implies \text{Örnek Ağırlığı} = 0.0$$
* **Jorge Jimenez Interleaved Gradient Noise (IGN) Açısal & Radyal Dither:**
  Geleneksel Vogel disk spirallerinde az sayıda örnek (28-48) kullanıldığında oluşan eşmerkezli halkalanmaları (banding) ortadan kaldırmak için, Jimenez'in ekran koordinatlı yüksek frekanslı mavi gürültü yaklaşımı entegre edilmiştir:
  $$\text{IGN}(x, y) = \operatorname{frac}\left(52.9829189 \cdot \operatorname{frac}(0.06711056 \cdot x + 0.00583715 \cdot y)\right)$$
  Altın açı spirali $\theta + \text{IGN} \cdot 2\pi$ ile döndürülür ve örnek yarıçapı $r$ dither edilir.
* **Jorge Jimenez & Earl Hammon Ön Plan Sızıntı Kalkanı (Foreground Bleed Shield):**
  Odak düzleminin önündeki nesnelerin keskin kenarlarının bulanık arka plan üzerine çamurlu renk sızdırmasını engeller:
  $$\text{sampleZ} < \text{centerZ} - 0.035 \implies \text{weight} \times \operatorname{smoothstep}(0.0, 0.40, \text{sampleCoC})$$
* **Boyuna Kromatik Sapma (LoCA / Spectral Bokeh Fringing):**
  Mercek camının dalga boyuna bağlı kırılma indisi ($n_{\text{kırmızı}} < n_{\text{yeşil}} < n_{\text{mavi}}$) modellenerek odak dışı dairelerin kenarlarına magenta/yeşil prizmatik renk saçılması eklenir.

### 2. Gelişmiş Derinlik Seçimi ve Akıllı Otomatik Odak (AF)

Depth Anything V2 modelinin ürettiği derinlik haritası ham hâliyle model greni ve saç/kenar gürültüsü barındırabilir. Bu sorunu çözmek için iki aşamalı bir mimari geliştirilmiştir:

* **7x7 İki Yönlü Gauss Filtresi (Bilateral Depth Kernel):**
  Kullanıcının dokunduğu pikselin derinliği tek bir pikselden okunmaz. Merkez piksel etrafında 7x7 pencerede uzamsal yakınlık ($\sigma_{\text{spatial}} = 1.8$) ile derinlik farkı toleransı ($\sigma_{\text{range}} = 0.15$) birlikte ağırlıklandırılır:
  $$W(i, j) = \exp\left(-\frac{\Delta x^2 + \Delta y^2}{2 \sigma_s^2}\right) \cdot \exp\left(-\frac{(Z_{ij} - Z_0)^2}{2 \sigma_r^2}\right)$$
  Böylece saç teli veya kenar boşluğuna denk gelen dokunmalarda arka planın yanlışlıkla seçilmesi engellenir.
* **Merkez Pencere Derinlik Histogram Modu ile Akıllı AF:**
  Portre ve sokak fotoğraflarında ana özne çoğunlukla kadrajın altın oran merkez alanında yer alır ($x \in [0.20, 0.80], y \in [0.15, 0.85]$). 32 bölmeli derinlik histogramı çıkarılarak $Z \ge 0.35$ aralığındaki birincil mod tespit edilir; tek dokunuşla ana özneye anında kilitlenir.
* **Sinematik Vizör AF Retikülü:**
  Seçim yapılan noktada sinema kamerası vizörlerini andıran dinamik `[ + ]` hedef kutusu ve canlı derinlik rozeti (örneğin `%78 • Ön Plan`) belirir.

### 3. WebGPU 3D LUT ve Tetrahedral Enterpolasyon Motoru

* **3B Doku (`texture_3d<f32>`):** Film emülsiyonlarının karmaşık spektral boya kuplaj tepkileri GPU üzerinde 33x33x33 veya 65x65x65 boyutundaki 3D LUT profilleriyle piksel bazında eşlenir.
* **6-Bölmeli Dörtyüzlü (Tetrahedral) Enterpolasyon:** Donanımsal trilinear enterpolasyonun nötr gri ekseninde (0,0,0 -> 1,1,1) yarattığı kutu ortalaması kirlenmelerini engellemek için, birim renk küpü ana köşegen boyunca 6 alt dörtyüzlüye bölünür ve barycentric ağırlıklarla enterpole edilir:
  $$\Delta R \ge \Delta G \ge \Delta B \implies T_1, \quad \Delta R \ge \Delta B > \Delta G \implies T_2 \quad (\dots)$$
* **1:1 CPU / Web Worker Yedek Hattı:** WebGPU desteklenmeyen ortamlarda veya arka plan yüksek çözünürlüklü dışa aktarma işlerinde birebir aynı tetrahedral matematik çalışır.
* **Harici `.CUBE` Desteği:** Adobe / Iridas formatındaki 17³, 33³ ve 65³ 3D LUT dosyaları doğrudan arayüzden yüklenerek anında uygulanabilir.

### 4. Hurter & Driffield (H&D) Duyarlık Eğrisi ve Omuz Sıkıştırması

Dijital sensörlerin aksine analog film, ışığa doğrusal olmayan logaritmik bir yanıt verir. Güneş vuran nesnelerdeki veya beyaz yüzeylerdeki sert kırpılmaları (clipping) önlemek için sahne-lineer ışık uzayında H&D karakteristik transfer fonksiyonu uygulanır:

* **Dip Tonlar (Toe):** Taban sisi ($D_{\min}$) üzerinde yumuşak logaritmik uyanış.
* **Orta Tonlar (Straight-line):** %18 orta gri ($E_0 = 0.184$) pivot noktası etrafında karakteristik film gamma eğimi ($\gamma$).
* **Film Omzu (Shoulder):** Yüksek ışıklarda gümüş halojenür doygunluğuna yaklaşan $C^1$-sürekli asimptotik üstel sıkıştırma:
  $$S(E) = E_{\text{knee}} + h \cdot \left(1 - e^{-(E - E_{\text{knee}}) / h}\right)$$
* **Çapraz Kanal Omuz Doygunluk Sönümlenmesi (`highlightDesat`):** Parlak pikseller doygunluğa ulaştığında renk kanallarının plastik sarı veya camgöbeği patlaması yapmasını engeller; açık tonları organik biçimde fildişi ve nötr beyaza yuvarlar.

### 5. 650 nm Spektral Kırılmalı Halasyon

Geleneksel çift loblu Gauss bulanıklığı yerine, dalga boyuna göre dağılan 3 katmanlı fiziksel saçılma modeli kullanılır:

1. **450 nm (Üst Mavi Katman):** Kısa dalga boyu nedeniyle yüksek soğurulma; dar açılı ileri Rayleigh saçılması ($r_{450} \approx 0.12 R$).
2. **550 nm (Orta Yeşil Katman):** Kısmi Mie saçılması ($r_{550} \approx 0.34 R$); parlak ışık çekirdeğinin çevresinde kehribar geçişi sağlar.
3. **650 nm (Alt Kırmızı Katman & Film Tabanı):** Üst katmanları aşan kırmızı fotonlar, selüloz triasetat film tabanından ($n \approx 1.48$, kritik açı $\theta_c \approx 42.5^\circ$) tam yansımayla geri seker ve alt emülsiyonu geniş bir Cauchy-Lorentz dağılımıyla pozlar.

### 6. 35mm Nutting-Weibull Film Greni ve Erken CCD Simülatörü

* **Asimetrik Fotokimyasal Gren:** Gren dokusu orta-koyu tonlarda (%18 gri, Zone IV-V) belirginleşir; derin gölgelerde ve patlamış beyazlarda doğal olarak sönümlenir. Negatif karesi başına yaklaşık 1800 kristal kümesi baz alınarak çözünürlükten bağımsız ölçeklenir.
* **Erken CCD Sensör Simülatörü (Digicam 2004 & Cyber Flash Y2K):** 2000'lerin başındaki ICX CCD sensörlerinin aşırı ışıkta sergilediği dikey elektron taşması (vertical smear) ve analog yumuşatma olmaksızın sertçe saf beyaza kenetlenen kırpılma fiziği modellenmiştir.

---

## Arayüz Tasarımı ve Ergonomi

Mobil ekranlarda ve masaüstünde tek elle rahat çalışabilmek amacıyla geliştirilen modern arayüz bileşenleri:

* **Sıcak Kehribar (Amber Darkroom) Paleti:** Laboratuvar güvenli kırmızı/kehribar ışık geleneğinden ilham alan `#F2A93B` vurgu rengi ve derin `#0B0C10` zemin tonu ile göz yormayan karanlık oda estetiği.
* **Saf Vektörel SVG Simge Sistemi:** Arayüzdeki tüm işletim sistemi bağımlı pikselli emojiler kaldırılmış; yerlerine yüksek çözünürlüklü Retina ekranlarda keskin render edilen 20'den fazla saf SVG simge entegre edilmiştir.
* **PrecisionSlider (Hassas Dokunmatik Sürgü):**
  - **Bipolar Merkez Çentik (Center Notch):** -100 ile +100 arasındaki değerlerde merkez sıfır noktasından sağa veya sola doğru amber renk dolgusu.
  - **Haptic Titreşim (Taptic Feedback):** Sıfır noktasından geçerken fiziksel bir çentiğe oturma hissi veren mikro haptik geri bildirim (`navigator.vibrate(10)`).
  - **Çift Dokunma ile Sıfırlama:** Değer etiketine veya sürgüye çift dokunarak anında varsayılan değere dönme.
  - **Sayısal Doğrudan Giriş:** Değere tek tıklandığında klavyeden doğrudan sayı yazma imkânı.
* **Modüler Alt Panel (Bottom Tray):** Işık, Renk, Film, Optik, Histogram ve Bitiş sekmeleri arasında yatay kaydırılabilir, tek dokunuşla geçiş.
* **Canlı Zone System Histogramı:** Logaritmik parlaklık eğrisi üzerinde derin gölge (Zone 0) ve patlamış ışık (Zone X) kırpılma uyarıları.
* **Öncesi / Sonrası Karşılaştırma:** Ekrana basılı tutarak veya bölünmüş görünümle ham orijinal ile banyo edilmiş hâli anında kıyaslama.

---

## Spektral Emülsiyon ve Optik Profilleri

### Film Emülsiyonları

| Profil Adı | Emülsiyon Türü | Karakteristik ve Tonlama |
| :--- | :--- | :--- |
| **Kodak Portra 400** | C-41 Renkli Negatif | Sıcak altın orta tonlar, korunan şeftali ten pigmenti, yumuşak H&D omuz toleransı |
| **Kodachrome 64** | K-14 Renkli Dia | Zengin doygun kırmızılar, derin kobalt gökyüzü mavisi, arşivsel kontrast |
| **Fuji Velvia 50** | E-6 Saydam Dia | Yüksek klorofil zümrüt yeşilleri, derin alacakaranlık mavileri, canlı peyzaj dengesi |
| **Ilford HP5+ 400** | Siyah/Beyaz Negatif | Pankromatik gümüş duyarlığı, geniş gri ton geçişleri, yumuşak omuz sönümlenmesi |
| **Moriyama S/B** | Tri-X 400 (Push D-76) | Daido Moriyama tarzı sokak estetiği, dik H&D kontrast eğrisi, derin siyahlar |
| **CineStill 800T** | Vision3 500T Tungsten | 3200K tungsten dengesi, petrol mavisi gölgeler, 650 nm kırmızı halasyon |
| **Leica Nordic** | Soğuk Ton Negatif | İskandinav arduvaz-lacivert gölgeler, adaçayı yeşilleri, sıcak parşömen açık tonlar |
| **CSM Reze** | Fuji Pro 400H Pastel | Seladon-nane açık tonlar, şeftali vurgular, yüksek ışık omuz sıkıştırması |
| **Vampir** | E-6 / C-41 Çapraz Banyo | Kan kırmızısı gölge boya kuplajı, gotik gümüş kontrast |
| **Gotik** | ENR Gümüş Tutma | Prusya mavisi gölgeler, düşük doygunluk, metalik gümüş orta tonlar |
| **Digicam 2004** | ICX Bayer CCD | 2000'ler dijital kompakt estetiği, kobalt mavisi, doymuş kroma gürültüsü |
| **Cyber Flash** | Y2K Xenon Flaş CCD | Sert flaş vurguları, soğuk gümüş tonlar, dikey elektron taşması (smear) |
| **Özel .CUBE** | 33³ / 65³ 3D LUT | Kullanıcı tarafından yüklenen harici profiller için tetrahedral eşleme |

### Hızlı Mercek Profilleri

* **Zeiss Biotar:** Maksimum kedi gözü kesilmesi ve karakteristik swirl dönme etkisi.
* **Helios 44M:** Dengeli portre bokehi, hafif kromatik saçılma ve doğal vinyet.
* **Helios 44-2:** Güçlü girdap etkisi ve vintage sıcak ışık karakteri.
* **Modern:** Düzeltilmiş küresel aberasyon, dairesel bokeh ve sıfır vinyet kararması.

---

## 300 DPI Laboratuvar Baskısı ve Dışa Aktarma

* **Fiziksel Piksel Başlığı:** Dışa aktarılan PNG dosyalarına `pHYs` bloğu ($11.811\text{ px/m}$), JPEG dosyalarına ise JFIF `APP0` ve EXIF `APP1` 300 DPI başlığı enjekte edilir. Fotoğraf laboratuvarları ve baskı makineleri çıktıyı doğrudan santimetre/inç ölçüleriyle tanır.
* **EXIF ve ICC Korunumu:** Orijinal kameraya ait diyafram, enstantane, lens modeli ve renk profili segmentleri ayıklanarak çıktı dosyasına aktarılır.
* **Display P3 Renk Gamutu:** Destekleyen ekranlarda geniş dinamik aralık ve renk gamutu korunur.
* **Arka Plan Web Worker Hattı:** Yüksek çözünürlüklü (16–60+ MP) dışa aktarma işlemleri `OffscreenCanvas` üzerinde bağımsız iş parçacığında çalıştırılır; ana arayüz kare atlamaz.

---

## Kurulum ve Çalıştırma

### Gereksinimler
- Node.js 18+ veya 20+
- Modern bir tarayıcı (WebGPU ve WebAssembly destekli Chrome, Edge, Brave veya Safari 18+)

```bash
# Depoyu klonlayın
git clone https://github.com/VelliDR/karanlik-oda.git
cd karanlik-oda

# Bağımlılıkları yükleyin
npm install

# Geliştirme sunucusunu başlatın
npm run dev

# Tip kontrolü ve üretim paketini derleyin
npm run build

# Üretim paketini yerel olarak önizleyin
npm run preview
```

### (Opsiyonel) LibRaw WASM Çekirdeğini Yeniden Derleme
Proje önceden derlenmiş ve optimize edilmiş `public/wasm/libraw.wasm` ile birlikte gelir. Kendi C++ değişikliklerinizi derlemek isterseniz:

```bash
# Emscripten ortamını etkinleştirin (emsdk)
source /path/to/emsdk/emsdk_env.sh

# C++ wrapper ve LibRaw'ı WASM olarak derleyin
bash native/build_wasm.sh
```

---

## PWA (Çevrimdışı Masaüstü ve Mobil Kurulum)

Foton, tam donanımlı bir Progressive Web App (PWA) olarak tasarlanmıştır:
1. Desteklenen bir masaüstü veya mobil tarayıcıda açın.
2. Adres çubuğundaki **Yükle** butonuna tıklayın (mobilde *Ana Ekrana Ekle*).
3. İnternet bağlantınız olmasa dahi bağımsız bir masaüstü veya mobil yazılım gibi doğrudan çalıştırın.
4. Masaüstü işletim sistemlerinde `.jpg`, `.png`, `.dng`, `.cr2`, `.nef`, `.arw` dosyalarına sağ tıklayıp "Foton ile Aç" seçeneğiyle doğrudan görsel aktarabilirsiniz.

---

## Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında açık kaynak olarak yayımlanmıştır.
Üçüncü taraf kütüphanelerin lisans bildirimleri için [LICENSE](LICENSE) dosyasına bakınız:
- **LibRaw:** CDDL 1.0 / LGPL 2.1 (C++ / WASM demosaic motoru)
- **ONNX Runtime Web:** MIT Lisansı (Microsoft Corporation)
- **Preact:** MIT Lisansı