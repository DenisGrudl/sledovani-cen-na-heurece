#!/usr/bin/env node
/**
 * Scraper výrobců / značek z https://www.vitalita.cz/znacka/
 *
 * Pro každou značku získá:
 *   - popis (krátký text ze stránky výrobce, fallback og:description / meta description)
 *   - logo  (stáhne obrázek loga do složky ./loga/)
 *   - adresu + IČO (dohledá v oficiálním rejstříku ARES podle názvu firmy)
 *
 * Výstup:
 *   - vyrobci.json  (strukturovaná data)
 *   - vyrobci.csv   (pro Excel; oddělovač ;, kódování UTF-8 s BOM)
 *   - loga/<slug>.<ext>  (stažená loga)
 *   - debug/ (uložené HTML první značky + index, pro doladění selektorů)
 *
 * Spuštění:
 *   npm install
 *   node scrape.js                 # projde celý index /znacka/
 *   node scrape.js --limit 10      # jen prvních 10 značek (test)
 *   node scrape.js --no-ares       # bez dohledávání adres v ARES
 *   node scrape.js --from-file     # seznam značek vezme z brands.txt místo indexu
 *
 * POZNÁMKA: přesné CSS selektory pro popis a logo se mohou lišit podle
 * aktuální šablony webu. Skript zkouší několik variant a jako fallback
 * používá og:/meta tagy. Po prvním běhu zkontroluj debug/brand-*.html a
 * případně uprav pole DESC_SELECTORS / LOGO_SELECTORS níže.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.vitalita.cz';
const INDEX_URL = `${BASE}/znacka/`;
const OUT_DIR = __dirname;
const LOGO_DIR = path.join(OUT_DIR, 'loga');
const DEBUG_DIR = path.join(OUT_DIR, 'debug');

// --- argumenty ---
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 0;
const USE_ARES = !args.includes('--no-ares');
const FROM_FILE = args.includes('--from-file');

// Kandidátní selektory – uprav podle reálného DOM (viz debug/ po prvním běhu).
const DESC_SELECTORS = [
  '.brand-detail__description', '.brand-detail__perex', '.brand__description',
  '.brand-description', '.manufacturer__description', '.category__description',
  '.category-perex', '.perex', '.text-content', '.rte', 'article .text', 'article p',
];
const LOGO_SELECTORS = [
  '.brand-detail__logo img', '.brand__logo img', '.brand-logo img', 'img.brand-logo',
  '.manufacturer__logo img', '.brand-header img', '.category-header img',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function findChromium() {
  // Preferuj Playwrightem stažený Chromium; jinak nech Playwright rozhodnout.
  const envPath = process.env.PW_CHROME_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(base)) {
    const dir = fs.readdirSync(base).find(d => /^chromium-\d+/.test(d));
    if (dir) {
      const p = path.join(base, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined; // Playwright použije defaultní instalaci
}

function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // odstraň diakritiku
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extFromContentType(ct, url) {
  if (ct) {
    if (ct.includes('svg')) return 'svg';
    if (ct.includes('png')) return 'png';
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('gif')) return 'gif';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  }
  const m = (url || '').match(/\.(svg|png|webp|gif|jpe?g)(\?|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'img';
}

/** Dohledání adresy + IČO v ARES podle obchodního jména. */
async function aresLookup(name) {
  const url = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ obchodniJmeno: name, pocet: 5, start: 0 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = data.ekonomickeSubjekty || [];
    if (!list.length) return null;
    // Vezmi první aktivní záznam (bez data zániku), jinak první.
    const s = list.find(x => !x.datumZaniku) || list[0];
    return {
      ico: s.ico || '',
      nazev: s.obchodniJmeno || '',
      adresa: (s.sidlo && s.sidlo.textovaAdresa) || '',
    };
  } catch (e) {
    return null;
  }
}

/** Načte index /znacka/ a vrátí [{ name, url }]. */
async function collectBrandsFromIndex(page) {
  await page.goto(INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  try { fs.writeFileSync(path.join(DEBUG_DIR, 'index.html'), await page.content()); } catch (_) {}
  const brands = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    document.querySelectorAll('a[href*="/znacka/"]').forEach(a => {
      let href = a.getAttribute('href') || '';
      const text = (a.textContent || '').trim();
      if (!href) return;
      // absolutní URL
      if (href.startsWith('/')) href = location.origin + href;
      // vynech samotný index a kotvy
      const clean = href.split('#')[0].replace(/\/$/, '');
      if (clean.endsWith('/znacka') || !/\/znacka\/.+/.test(clean)) return;
      if (!text) return;
      if (seen.has(clean)) return;
      seen.add(clean);
      out.push({ name: text, url: clean });
    });
    return out;
  });
  return brands;
}

/** Seznam z brands.txt s odvozenými URL (fallback). */
function brandsFromFile() {
  const file = path.join(__dirname, 'brands.txt');
  const lines = fs.readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  return lines.map(name => ({ name, url: `${BASE}/znacka/${slugify(name)}` }));
}

async function scrapeBrand(page, brand, idx) {
  const res = await page.goto(brand.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const status = res ? res.status() : 0;
  await page.waitForTimeout(600);
  if (idx < 2) {
    try { fs.writeFileSync(path.join(DEBUG_DIR, `brand-${idx}.html`), await page.content()); } catch (_) {}
  }
  const info = await page.evaluate(({ DESC_SELECTORS, LOGO_SELECTORS }) => {
    const meta = (name) => {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
      return el ? (el.getAttribute('content') || '').trim() : '';
    };
    // popis
    let popis = '', popisZdroj = '';
    for (const s of DESC_SELECTORS) {
      const el = document.querySelector(s);
      if (el) {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t.length > 40) { popis = t; popisZdroj = s; break; }
      }
    }
    if (!popis) {
      popis = meta('og:description') || meta('description');
      if (popis) popisZdroj = 'meta';
    }
    // logo
    let logo = '', logoZdroj = '';
    for (const s of LOGO_SELECTORS) {
      const el = document.querySelector(s);
      if (el && (el.currentSrc || el.src)) { logo = el.currentSrc || el.src; logoZdroj = s; break; }
    }
    if (!logo) { logo = meta('og:image'); if (logo) logoZdroj = 'og:image'; }
    return { popis, popisZdroj, logo, logoZdroj };
  }, { DESC_SELECTORS, LOGO_SELECTORS });

  return { status, ...info };
}

async function downloadLogo(context, logoUrl, slug) {
  if (!logoUrl) return '';
  try {
    const resp = await context.request.get(logoUrl, { timeout: 30000 });
    if (!resp.ok()) return '';
    const ct = resp.headers()['content-type'] || '';
    const ext = extFromContentType(ct, logoUrl);
    const fname = `${slug}.${ext}`;
    fs.writeFileSync(path.join(LOGO_DIR, fname), await resp.body());
    return fname;
  } catch (e) {
    return '';
  }
}

function toCsv(rows) {
  const cols = ['znacka', 'url', 'popis', 'adresa', 'ico', 'logo_soubor', 'logo_url', 'zdroj_adresy', 'status'];
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = cols.join(';');
  const body = rows.map(r => cols.map(c => esc(r[c])).join(';')).join('\r\n');
  return '﻿' + head + '\r\n' + body + '\r\n';
}

(async () => {
  for (const d of [LOGO_DIR, DEBUG_DIR]) fs.mkdirSync(d, { recursive: true });

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({ userAgent: UA, locale: 'cs-CZ' });
  const page = await context.newPage();

  let brands;
  if (FROM_FILE) {
    brands = brandsFromFile();
    console.log(`Seznam z brands.txt: ${brands.length} značek`);
  } else {
    console.log('Načítám index /znacka/ ...');
    brands = await collectBrandsFromIndex(page);
    console.log(`Z indexu nalezeno ${brands.length} značek`);
    if (brands.length === 0) {
      console.log('Index nevrátil žádné odkazy (změna DOM / WAF). Fallback na brands.txt.');
      brands = brandsFromFile();
    }
  }
  if (LIMIT > 0) brands = brands.slice(0, LIMIT);

  const rows = [];
  for (let i = 0; i < brands.length; i++) {
    const b = brands[i];
    const slug = slugify(b.name);
    process.stdout.write(`[${i + 1}/${brands.length}] ${b.name} ... `);
    let rec = { znacka: b.name, url: b.url, popis: '', adresa: '', ico: '', logo_soubor: '', logo_url: '', zdroj_adresy: '', status: '' };
    try {
      const info = await scrapeBrand(page, b, i);
      rec.status = info.status;
      rec.popis = info.popis || '';
      rec.logo_url = info.logo || '';
      rec.logo_soubor = await downloadLogo(context, info.logo, slug);
    } catch (e) {
      rec.status = 'ERR:' + e.message.slice(0, 60);
    }

    if (USE_ARES) {
      const ares = await aresLookup(b.name);
      if (ares && ares.adresa) {
        rec.adresa = ares.adresa;
        rec.ico = ares.ico;
        rec.zdroj_adresy = 'ARES';
      }
      await sleep(350); // šetrné k ARES API
    }

    rows.push(rec);
    console.log(`status=${rec.status} logo=${rec.logo_soubor ? 'ano' : '-'} adresa=${rec.adresa ? 'ano' : '-'}`);

    // průběžné ukládání (kdyby to spadlo)
    fs.writeFileSync(path.join(OUT_DIR, 'vyrobci.json'), JSON.stringify(rows, null, 2));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'vyrobci.json'), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'vyrobci.csv'), toCsv(rows));

  const okLogo = rows.filter(r => r.logo_soubor).length;
  const okAdr = rows.filter(r => r.adresa).length;
  const okPopis = rows.filter(r => r.popis).length;
  console.log('\n=== HOTOVO ===');
  console.log(`Značek: ${rows.length} | popis: ${okPopis} | logo: ${okLogo} | adresa(ARES): ${okAdr}`);
  console.log(`Výstup: vyrobci.csv, vyrobci.json, loga/`);

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
