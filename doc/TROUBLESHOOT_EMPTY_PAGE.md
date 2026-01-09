# Troubleshooting Empty Page on Vercel

## Quick Checklist

1. ✅ **Check Browser Console** (F12)
   - Look for JavaScript errors
   - Check network tab for failed API calls
   - Look for CORS errors

2. ✅ **Verify Environment Variables**
   - Go to Vercel → Settings → Environment Variables
   - Ensure `VITE_API_URL` and `VITE_WS_URL` are set
   - **Important**: Add to **Preview** environment (not just Production)

3. ✅ **Check Backend CORS**
   - Backend must allow your Vercel domain
   - Update `backend/src/index.ts` CORS settings

4. ✅ **Redeploy After Changes**
   - After adding env vars, redeploy the preview

---

## Common Issues & Fixes

### Issue 1: Environment Variables Not Set

**Symptoms:**
- Empty page
- Console shows `API URL: undefined` or `http://localhost:3000`
- Network requests failing

**Fix:**
1. Vercel Dashboard → Project → Settings → Environment Variables
2. Add:
   ```
   VITE_API_URL=https://your-backend.railway.app
   VITE_WS_URL=https://your-backend.railway.app
   ```
3. **Select "Preview" environment** (or "All Environments")
4. Redeploy

### Issue 2: CORS Errors

**Symptoms:**
- Console shows CORS errors
- Network tab shows blocked requests

**Fix:**
Update `backend/src/index.ts`:

```typescript
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://your-app.vercel.app',
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

### Issue 3: API URL Not Resolving

**Symptoms:**
- Console shows wrong API URL
- Network requests to wrong domain

**Fix:**
1. Verify environment variables in Vercel
2. Check the actual value (not just that it exists)
3. Make sure it includes `https://` (not `http://`)
4. No trailing slash

### Issue 4: Build Errors

**Symptoms:**
- Deployment succeeds but page is blank
- Check Vercel build logs

**Fix:**
1. Check Vercel deployment logs
2. Look for TypeScript errors
3. Fix and redeploy

---

## Debugging Steps

### Step 1: Check Console
1. Open deployed site
2. Press F12 (Developer Tools)
3. Go to Console tab
4. Look for:
   - Red errors
   - API URL logs
   - Network errors

### Step 2: Check Network Tab
1. Open Developer Tools
2. Go to Network tab
3. Refresh page
4. Look for:
   - Failed requests (red)
   - CORS errors
   - 404 errors

### Step 3: Verify Environment Variables
1. Add temporary logging in `App.tsx`:
   ```typescript
   console.log('API URL:', import.meta.env.VITE_API_URL);
   console.log('WS URL:', import.meta.env.VITE_WS_URL);
   ```
2. Check console output
3. Should show your Railway URL, not `undefined`

### Step 4: Test API Directly
1. Try accessing: `https://your-backend.railway.app/api/health`
2. Should return JSON response
3. If it fails, backend issue

---

## Quick Fix Commands

### Update Backend CORS (if needed):
```bash
cd backend
# Edit src/index.ts to add Vercel domain to CORS
git add src/index.ts
git commit -m "Update CORS for Vercel"
git push origin master
```

### Redeploy Frontend:
1. Vercel Dashboard → Deployments
2. Click "..." on latest deployment
3. Click "Redeploy"

---

## Expected Behavior

After fixing:
- ✅ Page loads with header "Polymarket Dashboard"
- ✅ Console shows API URL (not undefined)
- ✅ Network tab shows successful API calls
- ✅ Markets list appears (or loading spinner)

---

## Still Not Working?

1. Check Vercel build logs for errors
2. Check Railway backend logs
3. Verify backend is running and accessible
4. Test backend health endpoint directly
5. Check browser console for specific errors
