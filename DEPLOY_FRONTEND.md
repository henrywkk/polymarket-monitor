# Step-by-Step Guide: Deploy Frontend to Vercel

This guide will walk you through deploying the Polymarket Monitor frontend to Vercel.

---

## Prerequisites

- ✅ GitHub account with the repository pushed
- ✅ Vercel account (free tier works)
- ✅ Backend API URL (from Railway deployment)
- ✅ Node.js 18+ installed locally (for testing)

---

## Step 1: Create Vercel Account

1. Go to [https://vercel.com](https://vercel.com)
2. Click **"Sign Up"** or **"Log In"**
3. Choose **"Continue with GitHub"** (recommended for easy integration)
4. Authorize Vercel to access your GitHub account

---

## Step 2: Prepare Your Repository

Make sure your code is pushed to GitHub:

```bash
cd frontend
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main  # or master, depending on your branch
```

---

## Step 3: Create Vercel Project

### Option A: Via Vercel Dashboard (Recommended)

1. Go to [https://vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. Select your GitHub repository (`polymarket-monitor`)
4. Vercel will auto-detect it's a Vite project
5. Configure the project:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend` (IMPORTANT! Click "Edit" to set this)
   - **Build Command**: `npm run build` (should auto-detect)
   - **Output Directory**: `dist` (should auto-detect)
   - **Install Command**: `npm install` (should auto-detect)

**Note:** You have a `vercel.json` file in the `frontend/` directory. If you set Root Directory to `frontend`, Vercel will use that config file automatically. Alternatively, you can keep the root as the repository root and the existing `vercel.json` will handle the build commands.

### Option B: Via Vercel CLI

```bash
# Install Vercel CLI globally
npm i -g vercel

# Navigate to frontend directory
cd frontend

# Login to Vercel
vercel login

# Deploy (follow prompts)
vercel

# For production deployment
vercel --prod
```

---

## Step 4: Configure Environment Variables

### In Vercel Dashboard:

1. Go to your project → **Settings** → **Environment Variables**
2. Add the following variables:

| Variable Name | Value | Environment |
|--------------|-------|-------------|
| `VITE_API_URL` | `https://your-backend.railway.app` | Production, Preview, Development |
| `VITE_WS_URL` | `https://your-backend.railway.app` | Production, Preview, Development |

**Important Notes:**
- Replace `your-backend.railway.app` with your actual Railway backend URL
- The `VITE_` prefix is required for Vite to expose these to the frontend
- Add to all environments (Production, Preview, Development) for consistency

### Example:
```
VITE_API_URL=https://polymarket-monitor-production.up.railway.app
VITE_WS_URL=https://polymarket-monitor-production.up.railway.app
```

---

## Step 5: Configure Project Settings

### Root Directory Configuration

Since your frontend is in a `frontend/` subdirectory:

1. Go to **Settings** → **General**
2. Under **"Root Directory"**, click **"Edit"**
3. Select `frontend` folder
4. Click **"Save"**

### Build Settings

Verify these settings in **Settings** → **General**:

- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`
- **Node.js Version**: 18.x (or latest)

---

## Step 6: Deploy

### First Deployment:

1. After configuring everything, click **"Deploy"**
2. Vercel will:
   - Install dependencies
   - Run the build command
   - Deploy to a preview URL
3. Wait for the build to complete (usually 1-3 minutes)

### Automatic Deployments:

After the first deployment, Vercel will automatically:
- Deploy on every push to `main`/`master` branch (Production)
- Create preview deployments for pull requests
- Deploy on pushes to other branches (Preview)

---

## Step 7: Configure Custom Domain (Optional)

1. Go to **Settings** → **Domains**
2. Click **"Add Domain"**
3. Enter your domain (e.g., `polymarket-monitor.com`)
4. Follow DNS configuration instructions
5. Vercel will automatically provision SSL certificates

---

## Step 8: Verify Deployment

### Check Build Logs:

1. Go to **Deployments** tab
2. Click on the latest deployment
3. Check **"Build Logs"** for any errors

### Test the Deployment:

1. Visit your deployment URL (e.g., `https://polymarket-monitor.vercel.app`)
2. Open browser DevTools (F12)
3. Check Console for any errors
4. Verify API calls are working:
   - Network tab should show requests to your backend
   - No CORS errors

### Common Issues:

**Issue: API calls failing**
- ✅ Check `VITE_API_URL` environment variable is set correctly
- ✅ Verify backend CORS allows your Vercel domain
- ✅ Check backend is running and accessible

**Issue: WebSocket connection failing**
- ✅ Check `VITE_WS_URL` environment variable
- ✅ Verify backend WebSocket server is running
- ✅ Check browser console for WebSocket errors

**Issue: Build failing**
- ✅ Check Node.js version (should be 18+)
- ✅ Verify all dependencies are in `package.json`
- ✅ Check build logs for specific errors

---

## Step 9: Update Backend CORS (If Needed)

If you see CORS errors, update your backend `index.ts`:

```typescript
app.use(cors({
  origin: [
    'http://localhost:5173', // Local dev
    'https://your-app.vercel.app', // Vercel production
    'https://*.vercel.app', // All Vercel previews
  ],
  credentials: true,
}));
```

Or use environment variable:

```typescript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
```

Then set `FRONTEND_URL` in Railway to your Vercel URL.

---

## Step 10: Continuous Deployment Setup

Vercel automatically deploys on:
- ✅ Push to `main`/`master` → Production
- ✅ Pull requests → Preview deployments
- ✅ Other branches → Preview deployments

### Manual Deployment:

If you need to redeploy manually:

1. Go to **Deployments** tab
2. Click **"..."** on any deployment
3. Click **"Redeploy"**

---

## Project Structure for Vercel

You have two options:

### Option 1: Set Root Directory to `frontend` (Recommended)

1. In Vercel dashboard, set **Root Directory** to `frontend`
2. Vercel will automatically:
   - Run `npm install` in `frontend/`
   - Run `npm run build` in `frontend/`
   - Use `frontend/dist` as output
3. The `frontend/vercel.json` will be used automatically

### Option 2: Keep Root as Repository Root

If you keep the root as the repository root, the existing `vercel.json` in `frontend/` directory will handle:
- Build command: `cd frontend && npm run build`
- Output directory: `frontend/dist`
- SPA routing rewrites
- Asset caching headers

**Recommendation:** Use Option 1 (set Root Directory to `frontend`) for cleaner configuration.

---

## Environment Variables Reference

### Required:
- `VITE_API_URL` - Backend API URL (e.g., `https://backend.railway.app`)
- `VITE_WS_URL` - WebSocket URL (usually same as API URL)

### Optional:
- `VITE_APP_NAME` - App name for display
- `VITE_APP_VERSION` - App version

---

## Troubleshooting

### Build Fails: "Cannot find module"

**Solution:**
```bash
# Make sure all dependencies are in package.json
cd frontend
npm install
npm run build  # Test locally first
```

### Build Fails: TypeScript Errors

**Solution:**
```bash
cd frontend
npm run build  # Check for TypeScript errors
# Fix errors, then push and redeploy
```

### API Calls Return 404

**Solution:**
1. Check `VITE_API_URL` is set correctly
2. Verify backend is running
3. Check backend routes match frontend API calls

### WebSocket Connection Fails

**Solution:**
1. Check `VITE_WS_URL` is set correctly
2. Verify backend WebSocket server is running
3. Check browser console for specific errors
4. Verify Socket.io is configured correctly

---

## Quick Checklist

Before deploying, ensure:

- [ ] Code is pushed to GitHub
- [ ] `package.json` has all dependencies
- [ ] `npm run build` works locally
- [ ] Environment variables are configured
- [ ] Root directory is set to `frontend`
- [ ] Backend CORS allows Vercel domain
- [ ] Backend is deployed and accessible

---

## Post-Deployment

After successful deployment:

1. ✅ Test all features (market list, detail, real-time updates)
2. ✅ Check mobile responsiveness
3. ✅ Verify WebSocket connections
4. ✅ Monitor Vercel analytics
5. ✅ Set up custom domain (optional)

---

## Vercel Dashboard Features

- **Analytics**: View page views, performance metrics
- **Logs**: Real-time function logs
- **Deployments**: View all deployments and rollback if needed
- **Settings**: Configure domains, environment variables, etc.

---

## Support

- Vercel Docs: [https://vercel.com/docs](https://vercel.com/docs)
- Vercel Discord: [https://vercel.com/discord](https://vercel.com/discord)
- Vite Docs: [https://vitejs.dev](https://vitejs.dev)

---

**Your frontend should now be live on Vercel! 🚀**
