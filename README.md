# The Hitter's Notebook

A journaling app for baseball hitters. Anyone can create an account, sign in, and keep
their own private journal: log at-bats, reflect on games and practices, record hitting
sessions, search everything they've written, build routines, and keep a personal
Success Blueprint checklist.

## Run it on your own computer

You need **Node.js** (version 18 or newer). Check with `node --version`.

1. Open a terminal in this folder.
2. Install the pieces the app needs (only needed once):
   ```
   npm install
   ```
3. Start the app:
   ```
   npm start
   ```
4. Open your browser to **http://localhost:3000** and create an account.

Your journal is stored in a local file (`data/hitting-app.db`) — nothing leaves your computer.

### Optional settings

Copy `.env.example` to a file named `.env` to change settings:

- `PORT` — which port the app listens on (default 3000)
- `SESSION_SECRET` — a long random string that keeps sign-ins secure. Generate one with:
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

## Put it on the internet (Render)

This gets you a public website where anyone can sign up. It uses Render's free tier.

**What you'll need:** a Render account (free), and a GitHub account (free).

1. **Put this code on GitHub.** Create a new repository on github.com and push this
   folder to it. (In a terminal inside this folder: `git init`, `git add .`,
   `git commit -m "hitting app"`, then follow GitHub's instructions to push.)
2. **Create a Render account** at render.com (sign up with GitHub — easiest).
3. In the Render dashboard, click **New → Blueprint** and connect the GitHub
   repository you just created. Render will read `render.yaml` and set everything up.
4. Render will create two things: the **web service** (the app itself) and a
   **Postgres database** (where everyone's journals are stored). The database
   connection is wired up automatically — you don't need to copy anything.
5. Click **Apply**, wait a few minutes for the first deploy, then open the URL
   Render gives you (something like `https://hitters-notebook.onrender.com`).
6. Create your account on the live site and start logging.

**Notes:**
- On the free tier, the site "sleeps" after 15 minutes of no visitors and takes
  about a minute to wake up on the next visit. That's normal.
- If Render no longer offers a free database, you can use a free Postgres from
  [Neon](https://neon.tech) instead: create a free Neon database, copy its
  connection string, and paste it as the `DATABASE_URL` environment variable on
  your Render web service (dashboard → your service → Environment).
- Never share your `SESSION_SECRET` or `DATABASE_URL` with anyone.

## How it works (the short version)

- **Sign up / Sign in** — passwords are scrambled (hashed) before storage; sign-in
  uses a secure cookie that expires after 30 days.
- **Your data is yours** — every entry, routine, and checklist item is tied to your
  account. Users can never see each other's journals.
- **Takeaways** — after you save a game or practice reflection, the app generates
  2–3 takeaways from your own ratings and words using built-in rules. No data is
  sent to any outside AI service.
- **Voice logging** — uses your phone or browser's built-in speech recognition.
- **Database** — uses a local SQLite file when `DATABASE_URL` is not set, and
  Postgres when it is (that's how Render works).
