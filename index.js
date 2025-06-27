const express = require("express");
const { chromium } = require("playwright");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
app.use(express.json());

const db = new Database(path.join(__dirname, "last.db"));
const MAX_URLS = 20;

// Tworzymy tabelę, jeśli nie istnieje
db.prepare(`
  CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

function getLastUrls() {
  const rows = db.prepare(`
    SELECT url FROM urls
    ORDER BY added_at DESC
    LIMIT ?
  `).all(MAX_URLS);

  return rows.map(row => row.url);
}

function addUrlToHistory(url) {
  const insert = db.prepare(`INSERT OR IGNORE INTO urls (url) VALUES (?)`);
  insert.run(url);

  const count = db.prepare(`SELECT COUNT(*) AS count FROM urls`).get().count;
  if (count > MAX_URLS) {
    const deleteOld = db.prepare(`
      DELETE FROM urls
      WHERE id NOT IN (
        SELECT id FROM urls ORDER BY added_at DESC LIMIT ?
      )
    `);
    deleteOld.run(MAX_URLS);
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/extract", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Brak URL w żądaniu" });
  }

  const recentUrls = getLastUrls();
  if (recentUrls.includes(url)) {
    return res.status(200).json({ message: "URL już był — pomijam" });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch {
      console.warn("⏳ domcontentloaded failed, retrying with load...");
      await page.goto(url, {
        waitUntil: "load",
        timeout: 60000,
      });
    }

    await page.waitForTimeout(1000);

    const title = await page.title();
    const content = await page.evaluate(() => document.body.innerText);

    res.json({
      title,
      content: content.trim(),
    });
  } catch (err) {
    console.error("Błąd podczas ekstrakcji:", err);
    res.status(500).json({ error: `Błąd przetwarzania: ${err.message}` });
  } finally {
    if (browser) await browser.close();
  }
});

app.post("/remember", (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Brak URL" });
  }

  const recentUrls = getLastUrls();
  if (recentUrls.includes(url)) {
    return res.status(200).json({ message: "URL już zapisany" });
  }

  addUrlToHistory(url);
  res.json({ message: "URL zapisany" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serwer działa na http://localhost:${PORT}`);
});
