# Put CVV Outpass online (GitHub + Vercel)

This takes about 10 minutes. Everything is free.

## 1. Upload to GitHub (Sahasra's account)

1. Go to https://github.com/new
   - **Repository name:** `cvv-outpass`
   - **Private** is fine; Vercel can still deploy it.
   - Don't add a README. Click **Create repository**.
2. On the new repo page, click **uploading an existing file**.
3. Open the **CVV OUTPASS** folder in Finder. Select everything **except** `outpass.db` and `prototype-backup`, and drag it onto the page.
   Make sure the `api` folder goes too. Vercel needs it.
   Hidden files (`.gitignore`, `.vercelignore`) don't show in Finder. Press **Cmd + Shift + .** to show them, or skip them; they're optional.
4. Click **Commit changes**.

## 2. Deploy on Vercel

1. Go to https://vercel.com/signup and choose **Continue with GitHub**, using the same account.
2. Click **Add New… → Project**, find `cvv-outpass` and click **Import**.
3. Leave the settings as they are. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `OUTPASS_SECRET` | `829c11cadc849762899e15669010cccc48a60db18594e05466d94cd3bd70290e` |

4. Click **Deploy**. You get a link like `https://cvv-outpass.vercel.app`.

## 3. Add the database (required, or data disappears)

Vercel's servers don't keep files, so it needs a real database.

1. In the Vercel project, open the **Storage** tab → **Create Database** → **Neon** (Postgres) → free plan → **Create**.
2. **Connect** it to the `cvv-outpass` project. This adds `DATABASE_URL` automatically.
3. Go to **Deployments** → the ⋯ menu on the latest one → **Redeploy**.

Open the link. The first load creates the tables, the demo accounts and the CVV calendar.

## Updating later

Upload changed files to the GitHub repo the same way (**Add file → Upload files**). Vercel redeploys on its own.

## Good to know

- **Demo mode is on.** OTP codes and the parent link show on screen, which is good for presenting.
  For real use, add `OUTPASS_DEMO` = `0` and connect a WhatsApp/SMS provider (see README → "Still simulated").
- **Calendar sync** (Admin → Calendar) needs Vercel to reach cvv.ac.in. If it fails, the saved CVV calendar stays in place.
- **Without step 3**, the site still opens, but logins and passes reset at random.
