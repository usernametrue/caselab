# Full-Stack Boilerplate

A production-ready, AI-friendly full-stack boilerplate with Vue.js 3, Node.js, MongoDB, Redis, RabbitMQ, and Docker. Optimized for zero-downtime deployments and rapid development.

## 🚀 Quick Start

```bash
# 1. Clone and setup
git clone <your-repo>
cd full-stack-template

# 2. Configure environment
cp .env.sample .env
# Edit .env with your values

# 3. Deploy (automatic NFS setup + zero downtime)
./deploy.sh

# 4. Check status
./deploy.sh status
```

## 🏗️ Architecture

### Core Stack
- **Frontend:** Vue.js 3 + Vite + Tailwind CSS + Pinia
- **Backend:** Node.js 18+ + Express + Mongoose
- **Database:** MongoDB (external/shared)
- **Cache:** Redis (per-app container)
- **Queue:** RabbitMQ (per-app container)
- **Container:** Docker with multi-stage builds
- **Reverse Proxy:** Nginx with security headers

### Key Features
- **Zero Downtime Deployments** - Blue-green deployment pattern
- **NFS Media Integration** - Automatic symlink setup for shared storage
- **Modular Services** - Enable/disable Redis, RabbitMQ, monitoring
- **Health Monitoring** - Built-in health checks and status endpoints
- **Image Processing** - Sharp-based image optimization and thumbnails
- **Security First** - Helmet, rate limiting, file type validation
- **AI-Friendly** - Comprehensive documentation for AI assistants

## 📁 Project Structure

```
├── backend/                 # Node.js API server
│   ├── Dockerfile          # Multi-stage backend container
│   ├── package.json        # Minimal, production-ready dependencies
│   ├── server.js           # Application entry point
│   ├── db.js              # MongoDB connection with pooling
│   ├── multer.js          # File upload handling with NFS
│   └── scripts/
│       └── health-check.js # Health monitoring script
├── frontend/               # Vue.js application
│   ├── Dockerfile         # Multi-stage frontend container
│   ├── package.json       # Vue 3 + essential dependencies
│   ├── nginx.conf         # Production nginx configuration
│   └── src/               # Vue application source
├── uploads/               # Media files (NFS symlinked)
├── docker-compose.yml     # Modular service orchestration
├── deploy.sh             # Universal deployment script
├── .env.sample           # Environment template
└── docs/                 # AI documentation suite
```

## ⚙️ Configuration

### Environment Variables

Copy `.env.sample` to `.env` and configure:

```bash
# Project
PROJECT_NAME=my-app
NODE_ENV=production

# Database (External MongoDB)
MONGO_HOST=your-mongodb-server.com
MONGO_USERNAME=app_user
MONGO_PASSWORD=secure_password
MONGO_DATABASE=app_db

# Services
REDIS_PASSWORD=redis_password
RABBITMQ_USER=rabbit_user
RABBITMQ_PASSWORD=rabbit_password

# Security
JWT_SECRET=your_32_character_minimum_secret
```

### Service Modules

Enable/disable services via environment variables:

```bash
ENABLE_REDIS=true          # Redis caching
ENABLE_RABBITMQ=true       # Message queue
ENABLE_MONITORING=false    # Node exporter
ZERO_DOWNTIME_DEPLOYMENT=true  # Blue-green deployment
```

## 🚀 Deployment

### Deployment Strategies

```bash
# Ultra-fast (default) - Intelligent caching + zero downtime
./deploy.sh

# Quick restart - Fastest for minor changes
./deploy.sh quick

# Standard rebuild - Complete rebuild for dependency changes
./deploy.sh standard

# Service-specific deployment
./deploy.sh quick backend
./deploy.sh standard frontend
```

### Zero Downtime Deployment

Automatic blue-green deployment:
1. Builds new container version
2. Starts new container alongside old
3. Health checks new container
4. Switches traffic when ready
5. Removes old container

### NFS Media Setup

Automatic NFS integration:
- Detects `/app-media` mount
- Creates project-specific directory structure
- Symlinks `./uploads` to NFS location
- Handles existing directory migration warnings

## 🔧 Development

### Development Mode

```bash
# Start with development profile
NODE_ENV=development ./deploy.sh

# Or use docker-compose directly
docker-compose --profile development up

# View logs
./deploy.sh logs backend
./deploy.sh logs frontend
```

### Adding Features

#### Backend API Endpoint
```javascript
// backend/routes/example.js
const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ message: 'Hello World' });
});

module.exports = router;
```

#### Frontend Component
```vue
<!-- frontend/src/components/Example.vue -->
<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold">{{ message }}</h1>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const message = ref('')

onMounted(async () => {
  const response = await axios.get('/api/example')
  message.value = response.data.message
})
</script>
```

## 📊 Monitoring

### Health Checks

Built-in health monitoring:

```bash
# Application health
curl http://localhost:3000/health

# Detailed system status
./deploy.sh status

# Check specific service
docker logs app-backend
```

### Status Endpoints

- `/health` - Basic health check
- `/status` - Detailed system status
- Application metrics via health-check.js

## 🔒 Security

### Built-in Security Features

- **Helmet.js** - Security headers
- **Rate Limiting** - Request throttling
- **File Upload Security** - Type validation, size limits
- **MongoDB Sanitization** - Query injection prevention
- **CORS Configuration** - Cross-origin controls
- **JWT Authentication** - Secure token handling

### File Upload Security

```javascript
// Allowed file types
Images: .jpg, .jpeg, .png, .gif, .webp, .svg
Documents: .pdf, .doc, .docx, .txt, .csv
Archives: .zip, .rar

// Blocked for security
Executables: .exe, .bat, .sh, .php, .js
```

## 🛠️ File Processing

### Image Processing

Automatic image optimization:
- Resize to max dimensions
- Compress with quality settings
- Generate thumbnails
- Support multiple formats (JPEG, PNG, WebP)

```javascript
// Example usage
const { processImage } = require('./multer');

await processImage(filePath, {
  width: 1200,
  quality: 85,
  createThumbnail: true,
  thumbnailSize: 300
});
```

## 📚 AI Documentation

Comprehensive AI assistant guides:
- **AI_MASTER_GUIDE.md** - Entry point and navigation
- **AI_DEVELOPMENT_GUIDELINES.md** - Architecture and patterns
- **QUICK_REFERENCE.md** - Common tasks and examples
- **TROUBLESHOOTING_GUIDE.md** - Issue resolution
- **DEPLOYMENT_GUIDE.md** - Deployment strategies

## 🐳 Docker Configuration

### Multi-stage Builds

Optimized Docker images:
- **Base stage** - Dependencies installation
- **Development stage** - Hot reload, dev tools
- **Production stage** - Minimal, secure, non-root user

### Service Profiles

Docker Compose profiles for different environments:
```bash
# Core services only
docker-compose up

# Development environment
docker-compose --profile development up

# Full stack with monitoring
docker-compose --profile default --profile monitoring up
```

## 🔄 Database Connection

### MongoDB Setup

External MongoDB with connection pooling:
```javascript
// Built-in features
- Connection pooling (2-10 connections)
- Automatic retry logic
- Health monitoring
- Graceful shutdown
- Connection state tracking
```

### Redis & RabbitMQ

Per-application containers with persistent storage:
- Redis: Session storage, caching
- RabbitMQ: Background jobs, inter-service communication

## 📈 Performance

### Optimization Features

- **Docker layer caching** - Faster builds
- **Multi-stage builds** - Smaller images
- **Nginx optimization** - Gzip, caching, security headers
- **Database pooling** - Efficient connections
- **Image processing** - Automatic optimization
- **Static file caching** - CDN-ready

## 🆘 Troubleshooting

### Common Issues

```bash
# Port conflicts
./deploy.sh status
netstat -tulpn | grep :3000

# Health check failures
./deploy.sh logs backend
curl http://localhost:3000/health

# NFS issues
ls -la uploads/
./deploy.sh setup

# Complete reset
docker-compose down -v
./deploy.sh standard
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=* ./deploy.sh

# Check container resources
docker stats

# Inspect service configuration
docker-compose config
```

## 📝 License

MIT License - See LICENSE file for details.

## 🤝 Contributing

1. Check the AI documentation guides for established patterns
2. Follow the existing code structure and naming conventions
3. Test with both `quick` and `standard` deployment strategies
4. Update relevant documentation
5. Ensure health checks pass

---

**Built for developers, optimized for AI assistants, ready for production.**