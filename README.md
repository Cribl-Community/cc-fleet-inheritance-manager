# Fleet Inheritance Manager

A Cribl App for visualizing and managing fleet pack inheritance relationships.

## Summary

Fleet Inheritance Manager helps Cribl Stream administrators understand how packs are inherited across their fleet infrastructure. It provides clear visibility into which packs are deployed to which fleets, and what knowledge objects (pipelines, routes, functions, etc.) are contained within those packs.

## What This App Does

Provide visibility into pack inheritance across Fleets and help administrators understand which packs and knowledge objects are inherited by each Fleet.

### Key capabilities

- **Fleet Inventory View** — Display all configured fleets with detailed metadata
- **Pack Explorer** — Browse all available packs with version, author, and tag information
- **Inheritance Hierarchy** — Visualize the complete inheritance chain from Fleets → Packs → Knowledge Objects
- **Search and Filter** — Quickly find specific fleets or packs across your environment
- **Knowledge Object Catalog** — View all functions, pipelines, routes, and other knowledge objects within each pack

### Intended users

- Stream Administrators
- Platform Owners
- Operations Teams
- Architects

### Works with

- Cribl Stream (4.18.0+)

## When To Use This App

Use Fleet Inheritance Manager when you need to:

- Understand which packs are deployed to which fleets
- Determine the scope of a pack update or deletion
- Plan changes to fleet configuration
- Audit pack dependencies and relationships
- Document pack inheritance for compliance

## Before You Install

### Requirements

- **Required Cribl product**: Cribl Stream 4.18.0 or later
- **Required permissions**: Read-only access to groups, packs, and knowledge objects
- **Supported deployment types**: Leader/standalone deployments

### No external systems or APIs required

This app only communicates with your local Cribl Stream instance via documented APIs.

## Installation

### Install From Marketplace (Recommended)

1. Go to **Apps** in your Cribl Stream Leader or standalone deployment
2. Select **Marketplace**
3. Search for "Fleet Inheritance Manager"
4. Click **Install** and complete setup

### If Not In Marketplace

1. Visit the GitHub releases page
2. Download the latest `.tgz` file
3. In Cribl, go to **Apps** → **Import from file**
4. Upload the `.tgz` and complete installation

## Configuration

This app is **read-only** and requires no configuration after installation. Simply install and open it to begin exploring your fleet inheritance.

| Setting | Required | Description | Example | Scope |
|---|---|---|---|---|
| None | N/A | This app requires no per-user or per-app configuration. | N/A | N/A |

## How To Use

### Typical Workflow

1. **Open the app** from the Apps page
2. **Navigate to Fleets** tab to see all configured fleets
3. **Select a fleet** to view its details and configuration
4. **Navigate to Packs** tab to browse all available packs
5. **Navigate to Inheritance** tab to visualize the complete pack inheritance hierarchy
6. **Use search and filters** to find specific fleets or packs

### First-Run Checklist

- [ ] Verify you can see all expected fleets in the **Fleets** tab
- [ ] Confirm packs are loading in the **Packs** tab
- [ ] Test the **Inheritance** view by expanding a fleet to see its packs

## Permissions

This app is **read-only**. It does not modify any configuration or data.

### Cribl API Endpoints Used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/products/stream/groups` | List all Fleet Groups |
| GET | `/products/stream/groups/{id}` | Get Fleet details and pack relationships |
| GET | `/packs` | List all Packs in the environment |
| GET | `/packs/{id}` | Get Pack metadata and details |
| GET | `/p/{pack}/functions` | Get Functions within a Pack |
| GET | `/p/{pack}/pipelines` | Get Pipelines within a Pack |
| GET | `/p/{pack}/routes` | Get Routes within a Pack |

All calls are read-only (`GET`). No configuration is created, modified, or deleted.

## External API Access

This app makes **no external API calls**. It only communicates with your local Cribl Stream instance.

### Default Configuration

- No external proxies configured
- No external domains accessed

## Data and Storage

This app stores **no persistent data**. All information is fetched on-demand from your Cribl Stream instance.

- **No KV store usage**
- **No persistent cache**
- **No user data collected**
- **No session data persisted**

Each time you refresh the app, it fetches current data from your Cribl Stream Leader.

## Support

This app is built by [Author Name/Team] and is community-supported.

For issues, feature requests, or questions:
- **GitHub Issues**: [Repository URL]/issues
- **Email**: [Contact Email]

## Known Limitations

- **Knowledge Objects**: Currently displays Functions, Pipelines, and Routes. Other object types may be added in future releases.
- **Large Environments**: Performance may degrade with very large numbers of fleets (100+) or packs (500+). Pagination/virtualization improvements planned.
- **Real-time Updates**: The app does not automatically refresh when fleet or pack configuration changes in the leader. Refresh the app to see latest data.

## Troubleshooting

### The App Opens But Shows No Fleets

**Possible causes:**
- No fleets are configured in your Cribl Stream instance
- Missing permissions to read the `/products/stream/groups` API

**Solution:**
- Verify you have a fleet configured in Cribl Stream
- Check that your user role has read access to groups and fleets
- Try refreshing the app

### Packs or Knowledge Objects Don't Show

**Possible causes:**
- Packs not deployed to your environment
- API timeout on large environments
- Missing permissions to read pack APIs

**Solution:**
- Verify packs exist in your Cribl Stream environment
- Try searching for specific packs instead of loading all
- Check your user permissions

### The App Won't Load

**Possible causes:**
- Incompatible Cribl Stream version
- Browser compatibility issue
- Missing required permissions

**Solution:**
- Verify you're running Cribl Stream 4.18.0 or later
- Try a different browser (Chrome, Firefox, Safari)
- Check the browser console for error messages

## Development

To build and develop this app:

```bash
npm install
npm run dev          # Start dev server with hot reload
npm run build        # Build for production
npm run lint         # Run linter
npm run package      # Create deployable .tgz archive
```

The app is built with:
- **React 19** for the UI framework
- **TypeScript 6** for type safety
- **Vite 8** for fast development and building
- **Capra Design System** for consistent UI

### Project Layout

```text
src/
  main.tsx           ← Entry point
  App.tsx            ← Main app component with routing
  types.ts           ← TypeScript type definitions
  api.ts             ← Cribl API integration
  hooks.ts           ← React hooks for data fetching
  App.css            ← Application styling
  components/        ← React components
    FleetsView.tsx       ← Fleet inventory view
    PacksView.tsx        ← Pack explorer
    InheritanceView.tsx  ← Hierarchy visualization
    LoadingState.tsx     ← Loading/empty state UI
    ErrorBoundary.tsx    ← Error handling

config/
  policies.yml       ← Cribl API permissions
  proxies.yml        ← External domain declarations
```

## Versioning and Releases

- Versions follow **semantic versioning** (MAJOR.MINOR.PATCH)
- Releases are tagged in Git
- Each release includes a `.tgz` package for installation

## Contributing

Contributions welcome! Please:

1. Open an issue to discuss proposed changes
2. Fork and create a feature branch
3. Submit a pull request with clear description
4. Ensure tests pass and code is documented

## License

This app is licensed under the terms in [LICENSE](./LICENSE).

## App Metadata

| Field | Value |
|---|---|
| App Name | Fleet Inheritance Manager |
| App ID | fleet-inheritance-manager |
| Version | 1.0.0 |
| Author | Nate Wood |
| Support Model | community-built |
| License | [See LICENSE](./LICENSE) |
| Product Tags | stream |
| Category | Administration |
| Audience | admin, platform-owner |
| Requires External Access | No |
