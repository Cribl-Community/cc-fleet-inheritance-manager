# Fleet Inheritance Manager

A Cribl App for visualizing fleet and pack inheritance, finding fleets whose pack contents have drifted, and bringing them back in sync.

## Summary

Fleet Inheritance Manager helps Cribl administrators understand how packs flow through their Stream and Edge fleet hierarchy. It shows which fleets run each pack, whether a fleet's copy is local, inherited, or locally modified, and which fleets have pack contents (pipelines, routes, and lookups) that differ from the rest. From the same place you can edit pack contents and metadata, copy contents between fleets, and commit and deploy the result.

## What This App Does

### Key capabilities

- **Home screen** — In-app guide with features, a how-to workflow, and the full permission list. Select the app icon in the header to return to it at any time.
- **Fleet hierarchy** — Expandable parent/child tree of Stream and Edge fleets with product filters, search, and fleet details (type, deployed version, last deploy and config update).
- **Pack explorer** — Search packs by name, ID, description, tags, or fleet, then choose the fleet to work in.
- **Content-identical grouping** — Fleets running a pack are grouped when their pipelines and routes match and their lookup files are the same size. Each group lists exactly what differs, and fleets that could not be fully read are shown separately.
- **Make identical** — Copy pipelines, routes, and lookup files from a reference fleet so a drifting fleet matches it again.
- **Knowledge object editing** — Edit pipeline definitions, route entries, and lookup rows inline, and optionally apply the same change to other fleets.
- **Pack metadata publishing** — Edit display name, description, author, and tags, then publish a new version to one or many fleets. All published fleets share one version number.
- **Commit and deploy** — Commit pending pack changes and deploy them to the affected fleets, with per-fleet results and retry for failures.
- **Inheritance charts** — Detailed tree, levels, lineage, and Sankey views of the fleet hierarchy, with per-fleet pack status (local, inherited, inherited and modified).
- **Safe by default** — Every change needs an explicit click and a confirmation that names the affected fleets, and unsaved edits are guarded when leaving the Packs page.

### Intended users

- Stream Administrators
- Platform Owners
- Operations Teams
- Architects

### Works with

- Cribl Stream and Cribl Edge fleets (4.18.0+)

## When To Use This App

Use Fleet Inheritance Manager when you need to:

- Understand which packs are deployed to which fleets, and where each fleet inherits them from
- Find fleets whose copy of a pack has drifted from the others
- Bring drifting fleets back in line without re-uploading packs by hand
- Make the same pipeline, route, or lookup change across several fleets
- Update pack metadata and roll a new version out to many fleets at once
- Audit pack inheritance before planning a change

## Before You Install

### Requirements

- **Required Cribl product**: Cribl Stream / Edge 4.18.0 or later
- **Required permissions**: The app declares the Cribl API permissions listed under [Permissions](#permissions). They include write access to packs, pack contents, version control, and deploy, which the app only uses after you confirm an action.
- **Supported deployment types**: Distributed deployments with a Leader and one or more fleets

### No external systems or APIs required

This app only communicates with your Cribl Leader through documented Cribl APIs.

## Installation

### Install From Marketplace (Recommended)

1. Go to **Apps** in your Cribl Leader
2. Select **Marketplace**
3. Search for "Fleet Inheritance Manager"
4. Click **Install**, review the declared permissions, and complete setup
5. Share the app with the users or teams who should manage fleet packs

### If Not In Marketplace

1. Download the latest `.tgz` package for the app
2. In Cribl, go to **Apps** → **Import from file**
3. Upload the `.tgz`, review the declared permissions, and complete installation

## Configuration

The app requires no configuration after installation. Open it and start from the home screen.

| Setting | Required | Description | Example | Scope |
|---|---|---|---|---|
| None | N/A | This app requires no per-user or per-app configuration. | N/A | N/A |

## How To Use

### Typical Workflow

1. **Open the app** from the Apps page. The home screen summarizes features, workflow, and permissions.
2. **Fleets** — Confirm all expected Stream and Edge fleets are visible and review the hierarchy.
3. **Packs** — Pick a pack, then pick the fleet you want to work in. Pack contents load only after a fleet is selected.
4. **Review content groups** — See which fleets have identical pack contents and what differs in the others.
5. **Fix drift** — Use **Make identical to** on a drifting group, or open a pipeline, route, or lookup to edit it directly. Use **Also apply to** to repeat an edit on other fleets.
6. **Publish metadata** (optional) — Edit pack metadata and publish. The confirmation lists every fleet and the version bump.
7. **Commit and deploy** — Push the changes out to fleets. Child fleets that inherit a pack update after the deploy.
8. **Inheritance** — Verify each fleet shows the expected local or inherited pack status.

### First-Run Checklist

- [ ] The home screen opens and the app icon returns you to it from any tab
- [ ] All expected fleets appear in the **Fleets** tab
- [ ] Packs load in the **Packs** tab and contents appear after selecting a fleet
- [ ] The **Inheritance** tab shows your fleet hierarchy

## Permissions

The app declares the Cribl API permissions below in `config/policies.yml`. When an admin shares the app, these are granted for requests made through the app. Browsing only uses `GET`. Every write requires an explicit action and a confirmation that names the affected fleets.

### Declared Cribl API Permissions

| Area | API paths | Methods | Used for |
|---|---|---|---|
| Fleets | `/products/stream/groups`, `/products/stream/groups/*`, `/products/edge/groups`, `/products/edge/groups/*` | GET | List fleets and read fleet details and hierarchy |
| Packs | `/packs`, `/packs/*` | GET, PUT, PATCH, DELETE | Read packs, upload edited pack archives, and upgrade packs |
| Fleet packs | `/m/:gid/packs`, `/m/:gid/packs/*` | GET, PUT, POST, PATCH, DELETE | Read, upload, reinstall, and upgrade a pack within a specific fleet |
| Pack export | `/packs/*/export`, `/m/:gid/packs/*/export` | GET | Export a pack, including local changes, before republishing or copying it |
| Pack contents | `/p/*`, `/m/:gid/p/*` | GET, PATCH, POST | Read and edit pipelines, routes, and lookups; add a pipeline a fleet is missing |
| Version control | `/version/status`, `/version/commit` | GET, POST | Check for pending changes and commit them |
| Deploy | `/products/stream/groups/*/deploy`, `/products/edge/groups/*/deploy`, `/master/groups/*/deploy` | PATCH | Deploy committed changes to fleets |

### Write Operations

| Action in the app | Method and endpoint | Confirmation |
|---|---|---|
| Publish pack metadata | `PUT /m/{fleet}/packs` (upload) then `PATCH /m/{fleet}/packs/{pack}` | Yes, lists fleets and version |
| Make identical / copy contents | `POST /m/{fleet}/packs` (force reinstall), or `PATCH`/`POST` on `/m/{fleet}/p/{pack}/pipelines`, `/routes`, and `/system/lookups` | Yes, names source and target fleets |
| Edit a pipeline or route | `PATCH /m/{fleet}/p/{pack}/pipelines/{id}` or `/routes/{table}` | Yes |
| Edit lookup rows | `PATCH /m/{fleet}/p/{pack}/system/lookups/{id}/content` (falls back to rewriting the lookup file) | Yes |
| Commit | `POST /version/commit` | Yes |
| Deploy | `PATCH /products/{stream,edge}/groups/{fleet}/deploy` or `/master/groups/{fleet}/deploy` | Yes |

The app never deletes packs, fleets, or knowledge objects. Lookup rows are only removed when you delete them in the lookup editor and confirm.

## External API Access

This app makes **no external API calls**. It only communicates with your Cribl Leader.

### Default Configuration

- No external proxies configured
- No external domains accessed

## Data and Storage

This app stores **no persistent data**. All information is fetched on demand from your Cribl Leader.

- **No KV store usage**
- **No persistent cache**
- **No user data collected**
- **No session data persisted**

Each time a view loads, it reads current data from the Leader. Changes you make are written to Cribl configuration, not to the app.

## Support

This app is built by Nate Wood and is community-supported.

## Known Limitations

- **Knowledge objects**: The app shows and compares pipelines, routes, and lookups. Pack functions and other object types are not shown.
- **Lookup comparison**: Lookup files are compared by file size only. Rows, descriptions, and tags are not compared.
- **Inherited packs**: A child fleet that inherits a pack from its parent cannot be exported on its own. Its contents are read from the parent, and it updates only after the parent's changes are committed and deployed.
- **Large environments**: Performance may degrade with very large numbers of fleets (100+) or packs (500+).
- **Real-time updates**: The app does not refresh automatically when configuration changes on the Leader. Reload the view to see the latest data.

## Troubleshooting

### The App Opens But Shows No Fleets

**Possible causes:**
- No Stream or Edge fleets are configured
- The app was not shared with you by an admin, so its declared permissions are not granted

**Solution:**
- Verify Stream or Edge fleets exist on the Leader
- Ask an admin to share the app with you
- Reload the app

### Packs or Pack Contents Don't Show

**Possible causes:**
- No fleet is selected in the Packs tab yet
- The pack is not installed on any fleet
- A request timed out in a large environment

**Solution:**
- Select a fleet after selecting a pack
- Verify the pack exists on at least one fleet
- Check the error message shown in the panel and retry

### Publish, Copy, or Deploy Fails for Some Fleets

**Possible causes:**
- The fleet inherits the pack from a parent and has no copy of its own
- The fleet was changed by someone else since the view loaded

**Solution:**
- Review the per-fleet results and use retry for failed fleets
- For inheriting child fleets, change the parent fleet, then commit and deploy

### The App Won't Load

**Possible causes:**
- Cribl version older than 4.18.0
- Browser compatibility issue

**Solution:**
- Verify you're running Cribl Stream / Edge 4.18.0 or later
- Try a different browser (Chrome, Firefox, Safari)
- Check the browser console for error messages

## Development

To build and develop this app:

```bash
npm install
npm run dev                  # Start dev server with hot reload
npm run build                # Type-check and build for production
node --test src/*.test.ts    # Run unit tests
npm run lint                 # Run linter
npm run package              # Bump the patch version and create a deployable .tgz archive
```

The app is built with:
- **React 19** for the UI framework
- **TypeScript 6** for type safety
- **Vite 8** for fast development and building
- **Capra Design System** for consistent UI

### Project Layout

```text
src/
  main.tsx               ← Entry point and theme bridge
  App.tsx                ← Header, navigation tabs, and routes
  api.ts                 ← Cribl API integration (read, publish, copy, commit, deploy)
  hooks.ts               ← React hooks for data fetching
  types.ts               ← TypeScript type definitions
  fingerprint.ts         ← Content fingerprints for fleet comparison
  packArchive.ts         ← Read and rewrite .crbl pack archives
  lookupCsv.ts           ← Lookup CSV row edits
  packSource.ts          ← Pack source helpers
  App.css                ← Application styling
  *.test.ts              ← Unit tests (node --test)
  components/
    HomeView.tsx             ← Home screen (features, how-to, permissions)
    AppIcon.tsx              ← App logo (links to home)
    FleetsView.tsx           ← Fleet hierarchy
    PacksView.tsx            ← Pack comparison, editing, publish, deploy
    InheritanceView.tsx      ← Inheritance charts
    KnowledgeObjectGroups.tsx
    FleetProductBadge.tsx
    LoadingState.tsx
    ErrorBoundary.tsx

public/
  app-icon.svg           ← App icon (browser tab)

config/
  policies.yml           ← Cribl API permissions
  proxies.yml            ← External domain declarations (none)
```

## Versioning and Releases

- Versions follow **semantic versioning** (MAJOR.MINOR.PATCH)
- `npm run package` bumps the patch version; use `-- --minor`, `-- --major`, or `-- --version X.Y.Z` for other bumps
- Each release is distributed as a `.tgz` package

## Contributing

Contributions welcome! Please:

1. Open an issue to discuss proposed changes
2. Fork and create a feature branch
3. Submit a pull request with clear description
4. Ensure `npm run build` and `node --test src/*.test.ts` pass

## License

License terms have not been published yet.

## App Metadata

| Field | Value |
|---|---|
| App Name | Fleet Inheritance Manager |
| App ID | fleet-inheritance-manager |
| Version | 1.0.0 |
| Author | Nate Wood |
| Support Model | community-built |
| License | Not yet specified |
| Product Tags | stream, edge |
| Category | Administration |
| Audience | admin, platform-owner |
| Requires External Access | No |
| Modifies Configuration | Yes, after user confirmation |
