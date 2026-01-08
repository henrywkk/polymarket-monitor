# How to Configure Vercel to Deploy from a Specific Branch

## Option 1: Preview Deployments (Automatic - Recommended)

Vercel **automatically creates preview deployments** for all branches! You don't need to change anything.

### How it works:
1. Push your `frontend-updates` branch:
   ```bash
   git push origin frontend-updates
   ```
2. Vercel will automatically:
   - Create a preview deployment
   - Give it a unique URL like: `polymarket-monitor-git-frontend-updates-yourusername.vercel.app`
   - Deploy it automatically

### Access Preview Deployments:
- Go to your Vercel project → **Deployments** tab
- You'll see deployments from different branches
- Click on any deployment to get its preview URL

**This is the recommended approach** - you can test on preview URLs without affecting production!

---

## Option 2: Change Production Branch (Make frontend-updates the main branch)

If you want `frontend-updates` to be the **production** branch (what deploys to your main domain):

### Steps:

1. **Go to Vercel Dashboard**
   - Navigate to your project
   - Click **Settings** → **Git**

2. **Change Production Branch**
   - Find **"Production Branch"** setting
   - Click **"Edit"**
   - Change from `master` to `frontend-updates`
   - Click **"Save"**

3. **Result:**
   - Pushes to `frontend-updates` will deploy to your production domain
   - Pushes to `master` will create preview deployments

### To Revert Later:
Just change the production branch back to `master` in the same settings.

---

## Option 3: Create a Separate Vercel Project

If you want completely separate deployments:

1. **Create New Project in Vercel**
   - Click **"Add New..."** → **"Project"**
   - Select the same repository
   - Configure it to use `frontend-updates` branch
   - This gives you a completely separate project with its own domain

---

## Recommended Workflow

### For Development:
```bash
# Work on frontend-updates branch
git checkout frontend-updates
# Make changes, commit, push
git push origin frontend-updates
# Vercel automatically creates preview deployment
# Test on preview URL
```

### For Production:
```bash
# When ready, merge to master
git checkout master
git merge frontend-updates
git push origin master
# Vercel deploys to production domain
```

---

## Current Setup Recommendation

**Keep it as-is!** Vercel will automatically:
- ✅ Deploy `master` branch to production
- ✅ Create preview deployments for `frontend-updates`
- ✅ Give you preview URLs to test

You can test on preview URLs, and when ready, merge to `master` for production.

---

## How to View Preview Deployments

1. Go to **Vercel Dashboard** → Your Project
2. Click **"Deployments"** tab
3. You'll see:
   - Production deployments (from `master`) - marked with 🌿
   - Preview deployments (from other branches) - marked with 🔀
4. Click any deployment to:
   - View the live URL
   - See build logs
   - Redeploy if needed

---

## Quick Reference

| Action | Command | Result |
|--------|---------|--------|
| Push to `frontend-updates` | `git push origin frontend-updates` | Preview deployment (auto) |
| Push to `master` | `git push origin master` | Production deployment |
| Change production branch | Vercel Settings → Git | Change which branch deploys to production |

---

**TL;DR:** Just push your `frontend-updates` branch - Vercel will automatically create a preview deployment! No configuration needed. 🚀
