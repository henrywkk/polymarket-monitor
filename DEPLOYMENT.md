# Deployment Guide

## Prerequisites

1. GitHub repository set up
2. Railway account (for backend)
3. Vercel account (for frontend)

## Backend Deployment (Railway)

1. **Create Railway Project**
   - Go to [Railway](https://railway.app)
   - Create a new project
   - Connect your GitHub repository

2. **Add Services**
   - Add PostgreSQL service
   - Add Redis service
   - Add Node.js service (point to `backend/` directory)

3. **Configure Environment Variables**
   ```
   NODE_ENV=production
   DATABASE_URL=<from Railway PostgreSQL service>
   REDIS_URL=<from Railway Redis service>
   FRONTEND_URL=<your Vercel frontend URL>
   POLYMARKET_WS_URL=wss://clob.polymarket.com
   LOG_LEVEL=info
   ```

4. **Deploy**
   - Railway will auto-deploy on push to main branch
   - Or use Railway CLI: `railway up`

## Frontend Deployment (Vercel)

1. **Create Vercel Project**
   - Go to [Vercel](https://vercel.com)
   - Import your GitHub repository
   - Set root directory to `frontend/`

2. **Configure Build Settings**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Framework Preset: Vite

3. **Configure Environment Variables**
   ```
   VITE_API_URL=<your Railway backend URL>
   VITE_WS_URL=<your Railway backend WebSocket URL>
   ```

4. **Deploy**
   - Vercel will auto-deploy on push to main branch
   - Or use Vercel CLI: `vercel --prod`

## CI/CD Setup

GitHub Actions workflows are configured in `.github/workflows/`:
- `deploy-backend.yml` - Tests and deploys backend to Railway
- `deploy-frontend.yml` - Tests and deploys frontend to Vercel

### Required GitHub Secrets

**For Backend:**
- `RAILWAY_TOKEN` - Railway API token

**For Frontend:**
- `VERCEL_TOKEN` - Vercel API token
- `VERCEL_ORG_ID` - Vercel organization ID
- `VERCEL_PROJECT_ID` - Vercel project ID
- `VITE_API_URL` - Backend API URL (for build)
- `VITE_WS_URL` - Backend WebSocket URL (for build)

## Monitoring

- **Railway**: Built-in metrics and logs in Railway dashboard
- **Vercel**: Built-in analytics and performance monitoring
- **Health Check**: `GET /api/health` endpoint for monitoring

## Local Development

```bash
# Start all services
docker-compose up

# Backend only
cd backend && npm run dev

# Frontend only
cd frontend && npm run dev
```

