const express = require("express");
const { chromium } = require("playwright");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
app.use(express.json());

// Middleware logujący każdy request
app.use((req, res, next) => {
  console.log(`🔥 ${req.method} ${req.url}`);
  next();
});

const db = new Database(path.join(__dirname, "last.db"));
const MAX_URLS = 20;

console.log("🏷️ Starting server...");

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
    console.log(`🧹 Usuń stare wpisy, zostawiam max ${MAX_URLS}`);
  }
}

// Endpoint health check
app.get("/health", (req, res) => {
  console.log("🏷️ /health endpoint hit");
  res.json({ status: "ok" });
});

// POST /extract
app.post("/extract", async (req, res) => {
  console.log("🏷️ /extract endpoint hit");
  const { url } = req.body;

  if (!url) {
    console.warn("⚠️ Brak URL w /extract");
    return res.status(400).json({ error: "Brak URL w żądaniu" });
  }

  const recentUrls = getLastUrls();
  if (recentUrls.includes(url)) {
    console.log("ℹ️ URL już był — pomijam");
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

    addUrlToHistory(url);
    console.log(`✅ URL dodany do historii: ${url}`);

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

console.log("🏷️ REGISTERED GET /scrape-latest-one");

// GET /scrape-latest-one
app.get("/scrape-latest-one", async (req, res) => {
  console.log("🏷️ SCRAPE-LATEST-ONE endpoint hit");
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

    console.log("🌐 Otwieram stronę główną WNN...");
    await page.goto("https://www.world-nuclear-news.org", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    const articleUrl = await page.$eval(
      "div.news_list_image:nth-child(2) > img:nth-child(1)",
      (img) => {
        const link = img.closest("a");
        return link ? link.href : null;
      }
    );

    if (!articleUrl) {
      console.warn("⚠️ Nie znaleziono linku do artykułu");
      return res.status(404).json({ error: "Nie znaleziono linku do artykułu" });
    }

    console.log("📰 Najnowszy artykuł:", articleUrl);

    const recentUrls = getLastUrls();
    if (recentUrls.includes(articleUrl)) {
      console.log("ℹ️ Najnowszy artykuł już był");
      return res.status(200).json({ message: "Najnowszy artykuł już był", url: articleUrl });
    }

    const articlePage = await context.newPage();
    console.log("➡️ Przechodzę do artykułu...");
    await articlePage.goto(articleUrl, { waitUntil: "domcontentloaded" });
    await articlePage.waitForTimeout(3000);

    const title = await articlePage.title();

    const paragraphs = await articlePage.$$eval(".article__body p", ps =>
      ps.map(p => p.innerText.trim()).filter(Boolean)
    );
    const content = paragraphs.join("\n\n");

    addUrlToHistory(articleUrl);
    console.log(`✅ Artykuł dodany do historii: ${articleUrl}`);

    res.json({
      url: articleUrl,
      title,
      content,
    });

    await articlePage.close();
  } catch (err) {
    console.error("❌ Błąd podczas scrapowania:", err);
    res.status(500).json({ error: `Błąd scrapowania: ${err.message}` });
  } finally {
    if (browser) await browser.close();
  }
});

app.post("/remember", (req, res) => {
  console.log("🏷️ /remember endpoint hit");
  const { url } = req.body;

  if (!url) {
    console.warn("⚠️ Brak URL w /remember");
    return res.status(400).json({ error: "Brak URL" });
  }

  const recentUrls = getLastUrls();
  if (recentUrls.includes(url)) {
    console.log("ℹ️ URL już zapisany");
    return res.status(200).json({ message: "URL już zapisany" });
  }

  addUrlToHistory(url);
  console.log(`✅ URL zapisany: ${url}`);
  res.json({ message: "URL zapisany" });
});

const PORT = process.env.PORT || 3000;
console.log("🚀 Using PORT from env:", process.env.PORT);
app.listen(PORT, () => {
  console.log(`🚀 Serwer działa na http://localhost:${PORT}`);
});
