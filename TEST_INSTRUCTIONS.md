# Test Talimatları

## Server'ı Başlatma
```bash
npm run dev
```

## HTML Client Test

1. **HTTP Server Başlatın:**
   ```bash
   python3 -m http.server 8080
   ```

2. **Tarayıcıda Açın:**
   ```
   http://localhost:8080/client-test.html
   ```

3. **Test Adımları:**
   - Username: `testuser`
   - Email: `test@example.com`
   - Password: `Password123`
   - Register butonuna tıkla
   - Access token otomatik olarak doldurulmalı yoksa manuel
   - "Connect Socket" butonuna tıklay
   - Socket bağlantısı başarılı olmalı

## API Test
- Swagger UI: `http://localhost:3000/api-docs`
- Health Check: `http://localhost:3000/health`

## Admin Panel Test

1. **Admin Panel'i Açın:**
   ```
   http://localhost:8080/admin-test.html
   ```

2. **Admin Login:**
   - Email: `admin@example.com`
   - Password: `Admin123`
   - Login butonuna tıkla
   - Access token otomatik olarak doldurulmalı yoksa manuel

3. **Admin Özellikleri:**
   - System Status: Sistem durumunu görüntüle
   - Job Management: Job'ları kontrol et
   - Statistics: İstatistikleri görüntüle
   - Auto Messages: Otomatik mesajları yönet
   - Online Users: Çevrimiçi kullanıcıları görüntüle

## Test Kullanıcıları

### Normal User
- Username: `testuser`
- Email: `test@example.com`
- Password: `Password123`

### Admin User
- Username: `adminuser`
- Email: `admin@example.com`
- Password: `Admin123` 