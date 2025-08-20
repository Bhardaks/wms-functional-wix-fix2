# WMS Data Safety Guide

## 🔒 Veri Güvenliği Sistemi

Bu proje artık **otomatik veri yedekleme sistemi** ile donatılmıştır. Artık GitHub'a her update yaptığınızda verileriniz silinmeyecek!

## 🚀 Güvenli Deployment

### Yeni Deployment Yöntemi
```bash
node deploy-safe.js
```

Bu script:
1. ✅ Otomatik database yedeği alır
2. ✅ Git durumunu kontrol eder  
3. ✅ Değişiklikleri commit eder
4. ✅ GitHub'a güvenli şekilde push eder
5. ✅ Deployment özetini gösterir

### Manuel Yedekleme
```bash
cd backend/db
node -e "const Backup = require('./backup'); new Backup().autoBackup()"
```

## 📦 Yedekleme Sistemi

### Otomatik Yedeklemeler
- **Server başlangıcında**: Her uygulama başlatıldığında
- **Migration öncesi**: Database şeması güncellenmeden önce
- **30 günlük tutma**: Eski yedekler otomatik temizlenir

### Yedek Konumları
```
backend/db/backups/
├── wms_backup_2025-08-20T10-30-15-123Z.db
├── wms_backup_2025-08-20T09-15-30-456Z.db
└── ...
```

### Manuel Geri Yükleme
```javascript
const DatabaseBackup = require('./backend/db/backup');
const backup = new DatabaseBackup();

// Yedekleri listele
const backups = backup.listBackups();
console.log(backups);

// Geri yükle
backup.restoreFromBackup('./backend/db/backups/wms_backup_XXX.db');
```

## 🔧 Git Yapılandırması

### Ignored Files (Otomatik)
```
backend/db/wms.db          # Ana database
backend/db/wms.db-shm      # SQLite shared memory
backend/db/wms.db-wal      # SQLite write-ahead log
backend/db/backups/        # Yedek dosyalar
```

## ⚡ Önemli Notlar

### ✅ Artık Güvenli:
- GitHub güncellemeleri veri kaybına neden olmaz
- Otomatik yedekleme sistemi her zaman aktif
- Database dosyalar git'e commit edilmez
- Migration öncesi güvenlik yedekleri

### 🚨 Önceki Sorun:
- ❌ Database dosyaları git'e dahil ediliyordu
- ❌ Her pull/push'da veriler siliniyordu
- ❌ Yedekleme sistemi yoktu

## 🛠️ Geliştirme Workflow'u

### 1. Değişiklik Yap
```bash
# Kodda değişiklik yap
vim public/service-request.html
```

### 2. Güvenli Deploy
```bash
node deploy-safe.js
```

### 3. Server Çalıştır
```bash
cd backend
node server.js
```

## 🔄 Acil Durum Kurtarma

### Database Bozulursa:
1. Server'ı durdur
2. `backend/db/backups/` klasöründen en son yedek bul
3. Geri yükle:
```bash
cp backend/db/backups/wms_backup_LATEST.db backend/db/wms.db
```

### Git Sorunları:
```bash
git reset --hard HEAD~1    # Son commit'i geri al
node deploy-safe.js         # Tekrar deploy et
```

## 📊 Sistem Durumu

Bu sistemle:
- ✅ %100 veri güvenliği
- ✅ Otomatik yedekleme
- ✅ Güvenli GitHub sync
- ✅ Kolay geri yükleme
- ✅ Geliştirici dostu

---

**🎉 Artık verileriniz güvende! GitHub'da istediğiniz kadar update yapabilirsiniz.**