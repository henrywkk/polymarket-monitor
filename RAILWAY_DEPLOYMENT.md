# Railway Deployment Step-by-Step Guide

## Step 1: Configure Railway Service Settings

1. **Go to your Railway project dashboard**
2. **Click on your service** (the one connected to GitHub)
3. **Click on "Settings" tab**

### Configure Root Directory

4. **Scroll down to "Root Directory"**
5. **Set Root Directory to:** `backend`
6. **Click "Save"**

### Configure Build Settings

7. **Go to "Deploy" tab** (or "Settings" → "Build & Deploy")
8. **Set the following:**

   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Healthcheck Path:** `/api/health`

9. **Click "Save"**

## Step 2: Add PostgreSQL Service

1. **In your Railway project, click "+ New"**
2. **Select "Database" → "Add PostgreSQL"**
3. **Wait for it to provision**
4. **Click on the PostgreSQL service**
5. **Go to "Variables" tab**
6. **Copy the `DATABASE_URL` value** (you'll need this)

## Step 3: Add Redis Service

1. **In your Railway project, click "+ New"**
2. **Select "Database" → "Add Redis"**
3. **Wait for it to provision**
4. **Click on the Redis service**
5. **Go to "Variables" tab**
6. **Copy the `REDIS_URL` value** (you'll need this)

## Step 4: Configure Environment Variables

1. **Go back to your main service** (the Node.js one)
2. **Click on "Variables" tab**
3. **Add the following variables:**

   ```
   NODE_ENV=production
   PORT=3000
   DATABASE_URL=<paste from PostgreSQL service>
   REDIS_URL=<paste from Redis service>
   FRONTEND_URL=<your Vercel frontend URL - add after deploying frontend>
   POLYMARKET_WS_URL=wss://clob.polymarket.com
   LOG_LEVEL=info
   ```

4. **Click "Add" for each variable**

## Step 5: Link Services

1. **In your main service, go to "Settings" tab**
2. **Scroll to "Service Dependencies"**
3. **Add PostgreSQL service as a dependency**
4. **Add Redis service as a dependency**
5. **Click "Save"**

## Step 6: Deploy

1. **Go to "Deployments" tab**
2. **Click "Redeploy"** (or push a new commit to trigger deployment)
3. **Wait for build to complete**
4. **Check logs for any errors**

## Step 7: Get Your Backend URL

1. **After successful deployment, go to "Settings" tab**
2. **Scroll to "Domains"**
3. **Copy the generated domain** (e.g., `your-app.railway.app`)
4. **This is your backend URL**

## Troubleshooting

### If build fails:

1. **Check build logs** in Railway dashboard
2. **Verify Root Directory is set to `backend`**
3. **Verify Build Command:** `npm install && npm run build`
4. **Verify Start Command:** `npm start`

### If deployment fails:

1. **Check runtime logs** in Railway dashboard
2. **Verify all environment variables are set**
3. **Verify DATABASE_URL and REDIS_URL are correct**
4. **Check health endpoint:** `https://your-app.railway.app/api/health`

### Common Issues:

- **"Cannot find module"**: Make sure Root Directory is `backend`
- **"Database connection failed"**: Verify DATABASE_URL is correct
- **"Redis connection failed"**: Verify REDIS_URL is correct
- **"Port already in use"**: Railway sets PORT automatically, don't override it

## Next Steps

After backend is deployed:
1. Copy your Railway backend URL
2. Deploy frontend to Vercel (see DEPLOYMENT.md)
3. Update `FRONTEND_URL` in Railway with your Vercel URL
4. Update Vercel environment variables with your Railway backend URL

