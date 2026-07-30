# Scraper výrobců / značek z vitalita.cz

Získá ke každému výrobci ze stránky <https://www.vitalita.cz/znacka/>:

- **popis** – krátký text ze stránky výrobce (fallback `og:description` / meta description),
- **logo** – stažené do složky `loga/`,
- **adresu + IČO** – dohledané v oficiálním rejstříku **ARES** podle názvu firmy.

## Proč to není hotové rovnou v repu

Prostředí Claude Code, ve kterém se skript psal, má **vypnutý přístup k webu**
(egress proxy blokuje `vitalita.cz` i `ares.gov.cz`), takže scrape tam nešlo
spustit. Skript proto spusť u sebe na počítači, kde web funguje.

## Instalace a spuštění

Potřebuješ Node.js 18+.

```bash
cd scraper
npm install                 # nainstaluje Playwright
npx playwright install chromium   # stáhne prohlížeč (jen poprvé)

node scrape.js              # projde celý index /znacka/ a zpracuje všechny značky
```

### Užitečné přepínače

```bash
node scrape.js --limit 10   # jen prvních 10 značek (rychlý test)
node scrape.js --no-ares    # bez dohledávání adres v ARES
node scrape.js --from-file  # seznam vezme z brands.txt (odvodí URL ze slugu)
```

## Výstup

| Soubor          | Popis                                                        |
|-----------------|--------------------------------------------------------------|
| `vyrobci.json`  | strukturovaná data (průběžně se ukládají i během běhu)       |
| `vyrobci.csv`   | tabulka pro Excel – oddělovač `;`, UTF-8 s BOM               |
| `loga/`         | stažená loga jako `<slug>.<přípona>`                          |
| `debug/`        | HTML indexu + prvních značek pro doladění selektorů          |

Sloupce: `znacka`, `url`, `popis`, `adresa`, `ico`, `logo_soubor`, `logo_url`,
`zdroj_adresy`, `status`.

## Doladění (důležité)

Přesné CSS selektory pro **popis** a **logo** se mohou lišit podle aktuální
šablony webu. Skript zkouší několik variant a jako fallback bere `og:`/meta
tagy. Po prvním běhu:

1. Otevři `debug/brand-0.html` a najdi, v jakém elementu je popis a logo.
2. Uprav pole `DESC_SELECTORS` a `LOGO_SELECTORS` na začátku `scrape.js`.
3. Spusť znovu.

## Adresy (ARES)

Adresa a IČO se hledají v [ARES](https://ares.gov.cz) podle názvu značky přes
veřejné REST API (bez klíče). U zahraničních značek (Bayer, Teva, STADA…)
ARES vrátí českou pobočku/distributora, nebo nic – takové řádky si projdi ručně
a adresu dohledej na webu výrobce. Sloupec `zdroj_adresy` říká, odkud adresa je.

## `brands.txt`

Záložní seznam všech značek (stav ze stránky /znacka/). Skript ho použije jen
s přepínačem `--from-file` nebo když se nepodaří načíst index.
