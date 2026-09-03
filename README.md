<p align="center">
  <img src="build/icon.ico" width="96" height="96" alt="XPDF Editor Logo" />
</p>

<h1 align="center">XPDF Editor</h1>

<p align="center">
  <strong>Profesyonel, Donanım Hızlandırmalı ve Güvenli Masaüstü PDF Düzenleyici & Yöneticisi</strong><br />
  Adobe Acrobat standartlarında arayüz, milimetrik cetveller, ultra hızlı sayfa yöneticisi, güvenlik araçları ve otomatik güncelleme desteği.
</p>

<p align="center">
  <a href="https://github.com/knutolof06/XPDF-EDITOR/releases/latest"><img src="https://img.shields.io/github/v/release/knutolof06/XPDF-EDITOR?color=0ea5e9&label=S%C3%BCr%C3%BCm" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%2064--bit-blue?logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-34.x-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/React-18.x-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Lisans-MIT-green.svg" alt="License" />
</p>

---

## 🌟 Neden XPDF Editor?

**XPDF Editor**, web tabanlı hantal araçlara veya pahalı kurumsal aboneliklere ihtiyaç duymadan, tamamen **istemci tarafında (yerel ve çevrimdışı)** çalışan, donanım ivmeli, modern bir PDF düzenleme ve yönetim yazılımıdır. Tüm işlemler bilgisayarınızda yerel olarak gerçekleşir; belgeleriniz asla üçüncü taraf sunuculara yüklenmez.

---

## ✨ Temel Özellikler

### 🗂️ 1. Gelişmiş Sayfa Yöneticisi (Visual Page Manager)
- **Akıcı Sürükle-Bırak**: Sayfaları sürükleyerek sıralarını anında değiştirin.
- **Masaüstüne Doğrudan Sürükleme (Crash-Proof Drag-to-Desktop)**: Herhangi bir sayfayı tutup doğrudan Windows Masaüstüne veya bir klasöre bıraktığınızda bağımsız tek sayfalık PDF anında oluşturulur.
- **Sürüklerken Serbest Fare Tekerleği & Otomatik Kaydırma**: Kartı taşırken fare tekerleğiyle serbestçe kaydırabilir; ekranın üst/alt sınırlarına (90px) yaklaştığınızda 60 FPS otomatik hızlanan kaydırma devreye girer.
- **Acrobat / Figma Tarzı Yerleşim Çizgisi**: Rahatsız edici afişler yerine şık, 1.5px parlayan gök mavisi minimalist hizalama kılavuzu.
- **1. Sayfadan Başlayan Paralel Yükleme**: Forward-prioritized kuyruk ve 4 paralel iş parçacığı sayesinde yüzlerce sayfalık belgelerde bile ilk sayfalar gecikmesiz açılır.
- **Tam Kapsamlı Geri Al / Yinele (Undo/Redo)**: Döndürme, silme, ekleme veya sıra değiştirme işlemlerini `Ctrl+Z` / `Ctrl+Y` ile anında geri alın.

---

### 🎨 2. Adobe Acrobat Tarzı Sağ Araç Çubuğu (Right Tools Sidebar)
- **Temiz Üst Çubuk**: Üst kısım yalnızca temel dosya işlemleri, arama ve yakınlaştırma araçlarına ayrılarak ferah bir çalışma alanı sunar.
- **Genişletilebilir Sağ Panel**: 
  - 🎨 **PDF Düzenleme**: Nesneleri Düzenle, Boş Sayfa Ekle, Sayfa Yöneticisi, Boyutları Eşitle, N-up Çoklu Sayfa Düzeni.
  - 🗜️ **Dönüştürme ve Sıkıştırma**: Metin Çıkar (TXT/JSON), PDF Sıkıştır (%70 boyut tasarrufu), Görsele Çevir (ZIP), Görsellerden PDF, PDF Birleştir, PDF Böl.
  - 📝 **Formlar ve İmzalar**: AcroForm Yöneticisi, Sertifika Doğrulama, Dijital İmza Ekle, Kaşe ve Damga, Sayfa Numaralandırma, Üst/Alt Bilgi.
  - 📏 **Hizalama ve Cetveller**: Cetveller (Ctrl+R), Izgara, Manyetik Yapışma, Kılavuz Çizgileri.
  - 🛡️ **Güvenlik ve Araçlar**: Şifrele ve İzinler, Şifre Kaldır, Filigran Ekle, İki Belgeyi Karşılaştır, Belge Özellikleri.

---

### 📏 3. Hassas Cetveller, Kılavuzlar ve Izgara (Rulers & Guides)
- **Etkileşimli Milimetrik Cetveller**: Üst ve sol cetveller belge zoom oranına göre milimetrik hassasiyetle ölçeklenir.
- **Çekilip Bırakılan Kılavuz Çizgileri**: Cetvelden sürükleyip belge üzerine istediğiniz sayıda dikey ve yatay kılavuz bırakabilirsiniz.
- **Manyetik Yapışma (Snapping)**: Kılavuz çizgileri sayfa merkezine yaklaştığında otomatik olarak yapışır ve piksel mesafesini anlık gösterir.
- **Birim Desteği**: Milimetre (mm), Santimetre (cm), Nokta (pt) ve İnç (in) birimleri arasında tek tıkla geçiş.

---

### 🛡️ 4. Güvenlik, Şifreleme ve Dijital İmza Doğrulama
- **Parola Koruması & Yetkilendirme**: Belge açılış parolası koyma, yazdırma, kopyalama veya düzenleme izinlerini kısıtlama.
- **Kalıcı Parola Kaldırma (Decrypt)**: Parolası bilinen korumalı belgelerin şifresini tek tıkla kalıcı olarak çözme.
- **Dijital İmza & PKCS#7 Doğrulama**: Belgedeki e-imza ve dijital sertifikaları tarama; sertifika sahibi, imza tarihi ve belge bütünlüğü doğrulaması.
- **Özelleştirilebilir Filigran**: Açı, opaklık, font boyutu ve renk ayarlı dinamik metin filigranları.

---

### 📝 5. Akıllı Metin Çıkarma & Derin Arama
- **Doğal Okuma Sırasına Göre Metin Çıkarma**: Sayfa düzenini ve satır akışını koruyarak metin bloklarını ayıklama.
- **TXT & JSON İhracı**: Tek tıkla panoya kopyalama, ham `.txt` veya meta verili yapısal `.json` olarak kaydetme.
- **Gelişmiş Arama Katmanı**: Türkçe karakter ve büyük/küçük harf duyarlı, eşleşmeleri sayfa üzerinde sarı vurgu ile gösteren hızlı arama çubuğu (`Ctrl+F`).

---

### 🔄 6. Otomatik Güncelleme (Auto-Update)
- Uygulama açıldıktan 3 saniye sonra sessizce GitHub Releases üzerindeki yeni sürümleri kontrol eder.
- Yeni sürüm varsa arka planda fark (differential blockmap) teknolojisiyle yalnızca değişen blokları indirir.
- İndirme bittiğinde bildirim penceresi açılır; tek tıkla yeniden başlatıldığında yeni sürüme güncellenir veya uygulama bir sonraki kapatılışında otomatik kurulur.

---

### 🪟 7. Derin Windows Entegrasyonu
- **Windows Explorer Küçük Resim İşleyicisi (Thumbnail Provider DLL)**: Windows Gezgini'nde PDF dosyalarının ilk sayfasını gerçek önizleme simgesi olarak gösterir.
- **Dosya İlişkilendirmesi**: `.pdf` dosyalarına çift tıklandığında veya *"Birlikte Aç"* dendiğinde doğrudan XPDF Editor ile açılır.

---

## ⌨️ Klavye Kısayolları

| Kısayol | İşlev |
| :--- | :--- |
| `Ctrl + O` | PDF Dosyası Aç |
| `Ctrl + S` | Düzenlenen PDF'i Kaydet |
| `Ctrl + P` | Belgeyi Yazdır |
| `Ctrl + F` | Belge İçi Derin Arama |
| `Ctrl + Z` | Geri Al (Undo) |
| `Ctrl + Y` / `Ctrl + Shift + Z` | Yinele (Redo) |
| `Ctrl + R` | Cetvelleri Aç / Kapat |
| `Ctrl + +` / `Ctrl + -` | Yakınlaştır / Uzaklaştır |
| `Ctrl + 0` | Sayfayı Ekrana Sığdır |
| `Escape` | Açık Modalları veya Aramayı Kapat |
| `Delete` | Seçili Notu / Şekli Sil |

---

## 🛠️ Teknoloji Yığını

- **Masaüstü Motoru**: [Electron 34](https://www.electronjs.org/)
- **Kullanıcı Arayüzü**: [React 18](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Stil & Tasarım**: [Tailwind CSS](https://tailwindcss.com/), [Lucide Icons](https://lucide.dev/)
- **PDF İşleme & Render**: [PDF.js](https://mozilla.github.io/pdf.js/) (Mozilla), [pdf-lib](https://pdf-lib.js.org/)
- **Durum Yönetimi**: [Zustand 5](https://zustand-demo.pmnd.rs/)
- **Paketleme & Güncelleme**: [electron-builder](https://www.electron.build/), [electron-updater](https://www.electron.build/auto-update)
- **Derleme Aracı**: [Vite 6](https://vitejs.dev/)

---

## 📦 Kurulum ve Geliştirici Kılavuzu

### Gereksinimler
- **Node.js** 20.x veya üzeri
- **npm** 10.x veya üzeri
- **Windows 10 / 11 (64-bit)**

### 1. Depoyu Klonlayın
```bash
git clone https://github.com/knutolof06/XPDF-EDITOR.git
cd XPDF-EDITOR
```

### 2. Bağımlılıkları Yükleyin
```bash
npm install
```

### 3. Geliştirme Modunda Çalıştırın
```bash
# Vite geliştirme sunucusunu ve Electron penceresini başlatır
npm run dev
```

### 4. Üretim Sürümünü Derleyin ve Paketleyin
```bash
# Web varlıklarını derler ve NSIS kurulum Setup dosyasını üretir
npm run build:exe
```
Derlenen dosyalar `release/` dizini altına kaydedilir:
- **Kurulum Dosyası (Setup)**: `release/XPDF-Editor-Kurulum-Setup.exe`
- **Taşınabilir Sürüm (Unpacked)**: `release/win-unpacked/XPDF Editor.exe`

---

## 📄 Lisans

Bu proje **MIT Lisansı** ile lisanslanmıştır. Detaylar için `LICENSE` dosyasına bakabilirsiniz.

