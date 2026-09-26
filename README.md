# wow-tracker

A World of Warcraft: Forever character progression tracker for **the Craft family**.
It pulls from the Blizzard Battle.net API so you don't have to update anything by hand.

| Character | Class | Professions | In-game name |
|---|---|---|---|
| **Warr Craft** (Warcraft) | Shaman | Herbalism / Alchemy | `Warrcraft` |
| **Star Craft** (StarCraft) | Hunter | Skinning / Leatherworking | `Starcraft` |
| **Mine Craft** (Minecraft) | Rogue | Mining / Engineering | `Minecraft` |
| **Witch Craft** (witchcraft) | Mage | Tailoring / Enchanting | `Witchcraft` |

It tracks race, class, level, professions and their skill, other skills (weapon skills,
defense, secondary professions), gear in every slot (with Wowhead tooltips) and talent spec.

## How it works

```
GitHub Action (every 3 h) ──> Blizzard API ──> data/characters.json ──> index.html (GitHub Pages)
```

Your Blizzard **client secret must never be in the web page**, because anyone could read it.
So a GitHub Action holds the secret, fetches the data on a schedule and commits it to
`data/`. The HTML page just reads that file. This also avoids browser CORS problems with
Blizzard's login endpoint.

## Setup

### 1. Create the Blizzard API client

On <https://develop.battle.net/access/clients> → **Create Client**:

| Field | What to enter |
|---|---|
| Client Name | Something unique, e.g. `craft-family-tracker` |
| Redirect URLs | Leave blank. This app only uses the client-credentials flow, not user login |
| Service URL | `https://<your-github-username>.github.io/wow-tracker/` (or tick *I do not have a service URL*) |
| Intended Use | `Personal tracker that shows my own WoW Forever characters' level, gear, talents and professions. Data is fetched every few hours by a GitHub Action and shown on a static GitHub Pages site.` |

Save, then copy the **Client ID** and **Client Secret**.

### 2. Add them to GitHub as secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

- `BLIZZARD_CLIENT_ID`
- `BLIZZARD_CLIENT_SECRET`

### 3. Turn on GitHub Pages

Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)`.
(Free GitHub accounts need the repo to be public for Pages.)

### 4. Fill in your characters

Edit `characters.config.json` and set `name` and `realm` for each character once they
exist in-game. Leave `realm` empty and that character just shows the manual values.

### 5. Run it

Actions tab → **Update character data** → **Run workflow**. After that it runs every
3 hours, and whenever you change `characters.config.json`.

## Important: WoW Forever API status

WoW Forever launches **4 November 2026**, and as of late September 2026 **Blizzard has
not published a Profile API namespace for it yet**. The tracker is ready for when they do:

- `namespace` in `characters.config.json` defaults to a guess, `profile-classicforever-{region}`.
  When Blizzard announces the real one, change that one line.
- Forever uses **rulesets instead of realms**, so the realm slug the API wants may look
  different. Put whatever Blizzard's armory URL uses into `realm`.
- The API has never provided **weapon skills / defense**, and the Classic flavours may not
  return **professions** either. Those come from the `manual` section of the config.
  API values always win when present, and the page labels each character as *API* or *Manual*.
- If a refresh fails, the last good API data is kept, so the page never goes blank.

To test another namespace without editing the config:

```bash
BLIZZARD_NAMESPACE=profile-classic1x-eu BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... \
  node scripts/fetch-characters.mjs
```

## Running locally

```bash
# optional: refresh data (needs Node 18+)
BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... node scripts/fetch-characters.mjs

# view the site
python3 -m http.server 8000   # then open http://localhost:8000
```

You can also double-click `index.html`. It loads `data/characters.js`, so it works without a server.

## Files

- `index.html`, `css/style.css`, `js/app.js`: the web app
- `characters.config.json`: roster, region, API namespace, manual fallbacks
- `scripts/fetch-characters.mjs`: Blizzard API fetcher (no dependencies)
- `data/characters.json` / `.js`: generated data, don't edit by hand
- `.github/workflows/update-data.yml`: scheduled refresh
