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
   | `OUTPASS_SECRET` (optional for the prototype) | `829c11cadc849762899e15669010cccc48a60db18594e05466d94cd3bd70290e` |

4. Click **Deploy**. You get a link like `https://cvv-outpass.vercel.app`.

## 3. Database: not needed for the prototype

Without a database, the online version runs in **no-database mode**:
- **Saved in the browser:** each browser keeps its own copy of the demo data, and logins, requests and approvals all work.
- **One device per demo:** a request made on one phone won't show up on another. Present from one browser and switch roles with the demo accounts. The parent page opened from the WhatsApp link works in another tab.
- **Starting over:** use **Demo accounts → Reset demo data** on the login page.

If you later connect a Neon database (Storage → Create Database → Neon → Connect → Redeploy), it switches to shared data automatically.

## Updating later

Upload changed files to the GitHub repo the same way (**Add file → Upload files**). Vercel redeploys on its own.

## Good to know

- **Demo mode is on.** OTP codes and the parent link show on screen, which is good for presenting.
  For real use, add `OUTPASS_DEMO` = `0` and connect a WhatsApp/SMS provider (see README → "Still simulated").
- **Calendar sync** (Admin → Calendar) needs Vercel to reach cvv.ac.in. If it fails, the saved CVV calendar stays in place.
- **Without step 3**, the site still opens, but logins and passes reset at random.
