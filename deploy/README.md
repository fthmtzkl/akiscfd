# AkisCFD — Hetzner Cloud Deploy Rehberi

## 1. Hetzner'da VM Oluşturma

1. [Hetzner Cloud Console](https://console.hetzner.cloud) → New Server
2. **Location**: Nuremberg (EU) veya Falkenstein
3. **Image**: Ubuntu 22.04
4. **Type**: CPX31 (4 vCPU / 8 GB RAM / 160 GB SSD) — ~€15/ay  
   Daha fazla iş yükü için CPX41 (8 vCPU / 16 GB) — ~€35/ay
5. **SSH Key**: Kendi public key'ini ekle
6. Server IP'yi not al

## 2. Sunucu İlk Kurulum

```bash
# Sunucuya bağlan
ssh root@<SERVER_IP>

# Setup scriptini çalıştır
curl -sL https://raw.githubusercontent.com/fthmtzkl/akiscfd/main/deploy/setup_hetzner.sh | bash
```

## 3. Ortam Değişkenleri

```bash
# Sunucuda
nano /opt/akiscfd/.env.prod
```

```env
SECRET_KEY=<openssl rand -hex 32 ile üret>
CORS_ORIGINS=https://akiscfd.com,https://www.akiscfd.com
FLOWER_AUTH=admin:<güçlü_şifre>
IMAGE_TAG=latest
```

## 4. GitHub Secrets

Repository → Settings → Secrets and variables → Actions:

| Secret | Değer |
|--------|-------|
| `HETZNER_HOST` | Sunucu IP adresi |
| `HETZNER_USER` | `root` (veya oluşturduğun kullanıcı) |
| `HETZNER_SSH_KEY` | SSH private key içeriği |

## 5. İlk Deploy

```bash
git push origin main
```

GitHub Actions otomatik olarak:
1. Frontend'i build eder
2. Docker image'ı build edip GHCR'a push eder
3. Sunucuya SSH ile bağlanır ve `docker compose up -d` çalıştırır

Sonra `http://<SERVER_IP>` adresinde uygulama ayakta olacak.

## 6. SSL Sertifikası (Let's Encrypt)

DNS'i sunucuya yönlendirdikten sonra:

```bash
ssh root@<SERVER_IP>
certbot certonly --standalone -d akiscfd.com -d www.akiscfd.com
```

`nginx/nginx.conf` içindeki HTTPS bloğunun yorumunu kaldır, yeniden deploy et.

## Servis URLs

| Servis | URL |
|--------|-----|
| Frontend | https://akiscfd.com |
| API | https://akiscfd.com/api |
| Swagger | https://akiscfd.com/api/docs |
| Flower (Celery) | http://\<IP\>:5555 (iç ağ) |

## Kaynak Kullanımı (Tahmini)

| Bileşen | RAM | CPU |
|---------|-----|-----|
| Nginx | ~50 MB | minimal |
| FastAPI (4 worker) | ~200 MB | minimal |
| Celery (2 slot) | ~2 GB/sim | 4-6 core/sim |
| Redis | ~50 MB | minimal |
