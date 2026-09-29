import { Text } from '@capra/core';
import { BoxArchive, BranchesOutlined, FleetOutlined } from '@capra/icons';
import { Link } from 'react-router-dom';
import { AppIcon } from './AppIcon';

const SECTIONS = [
  {
    path: '/fleets',
    label: 'Fleets',
    Icon: FleetOutlined,
    summary: 'Browse every Stream and Edge fleet as a parent/child tree and inspect fleet details.',
  },
  {
    path: '/packs',
    label: 'Packs',
    Icon: BoxArchive,
    summary: 'Compare a pack across fleets, edit its contents, keep fleets in sync, then commit and deploy.',
  },
  {
    path: '/inheritance',
    label: 'Inheritance',
    Icon: BranchesOutlined,
    summary: 'Visualize how fleets inherit from each other and where packs are local, inherited, or modified.',
  },
];

const FEATURES = [
  {
    title: 'Fleet hierarchy',
    detail: 'Expandable parent/child tree of Stream and Edge fleets with product filters, search, and deployment details.',
  },
  {
    title: 'Content-identical grouping',
    detail:
      'Fleets running a pack are grouped when their pipelines, routes, and lookup files match, with a list of what differs.',
  },
  {
    title: 'Make identical',
    detail: 'Copy pipelines, routes, and lookups from a reference fleet so a drifting fleet matches it again.',
  },
  {
    title: 'Knowledge object editing',
    detail: 'Edit pipelines, route entries, and lookup rows inline, and optionally apply the same change to other fleets.',
  },
  {
    title: 'Pack metadata publishing',
    detail: 'Edit display name, description, author, and tags, then publish a new version to one or many fleets.',
  },
  {
    title: 'Commit and deploy',
    detail: 'Commit pending pack changes and deploy them to the affected fleets, with per-fleet results and retry.',
  },
  {
    title: 'Inheritance charts',
    detail: 'Detailed tree, levels, lineage, and Sankey views of the fleet hierarchy with per-fleet pack status.',
  },
  {
    title: 'Safe by default',
    detail: 'Every change needs an explicit click and a confirmation, and unsaved edits are guarded when leaving a page.',
  },
];

const STEPS = [
  'Open Fleets to confirm all expected Stream and Edge fleets are visible and to review the hierarchy.',
  'Open Packs, pick a pack, then pick the fleet you want to work in. Nothing loads until a fleet is selected.',
  'Review the content-identical groups to find fleets whose copy of the pack has drifted.',
  'Use "Make identical to" on a drifting group, or open a pipeline, route, or lookup to edit it directly.',
  'Edit pack metadata if needed, then publish. The confirmation lists every fleet and the version bump.',
  'Commit and deploy so the changes reach the fleets. Inheriting child fleets update after the deploy.',
  'Open Inheritance to verify each fleet now shows the expected local or inherited pack status.',
];

const PERMISSIONS: { area: string; paths: string; methods: string; purpose: string }[] = [
  {
    area: 'Fleets',
    paths: '/products/stream/groups, /products/edge/groups (and /*)',
    methods: 'GET',
    purpose: 'List fleets and read fleet details and hierarchy.',
  },
  {
    area: 'Packs',
    paths: '/packs, /packs/*',
    methods: 'GET, PUT, PATCH',
    purpose: 'Read packs, upload edited pack archives, and upgrade packs.',
  },
  {
    area: 'Fleet packs',
    paths: '/m/:gid/packs, /m/:gid/packs/*',
    methods: 'GET, PUT, POST, PATCH',
    purpose: 'Read, upload, reinstall, and upgrade a pack within a specific fleet.',
  },
  {
    area: 'Pack export',
    paths: '/packs/*/export, /m/:gid/packs/*/export',
    methods: 'GET',
    purpose: 'Export a pack (including local changes) before republishing or copying it.',
  },
  {
    area: 'Pack contents',
    paths: '/p/*, /m/:gid/p/*',
    methods: 'GET, PATCH, POST',
    purpose: 'Read and edit pipelines, routes, and lookups; add a pipeline a fleet is missing.',
  },
  {
    area: 'Version control',
    paths: '/version/status, /version/commit',
    methods: 'GET, POST',
    purpose: 'Check for pending changes and commit them.',
  },
  {
    area: 'Deploy',
    paths: '/products/{stream,edge}/groups/*/deploy, /master/groups/*/deploy',
    methods: 'PATCH',
    purpose: 'Deploy committed changes to fleets.',
  },
];

export function HomeView() {
  return (
    <div className="home-view">
      <section className="panel home-hero">
        <AppIcon size={56} />
        <div>
          <Text as="h2" variant="heading-md">
            Welcome to Fleet Inheritance Manager
          </Text>
          <div className="section-copy">
            <Text variant="body-sm-normal" color="secondary">
              See how packs flow through your Cribl fleet hierarchy, spot fleets whose pack contents have drifted, and
              bring them back in line from one place. Select the app icon at any time to return to this page.
            </Text>
          </div>
        </div>
      </section>

      <section className="home-card-grid" aria-label="Sections">
        {SECTIONS.map(({ path, label, Icon, summary }) => (
          <Link key={path} to={path} className="panel home-card">
            <div className="home-card-title">
              <Icon size="md" />
              <Text as="h3" variant="heading-sm">
                {label}
              </Text>
            </div>
            <Text variant="body-sm-normal" color="secondary">
              {summary}
            </Text>
          </Link>
        ))}
      </section>

      <section className="panel">
        <Text as="h3" variant="heading-sm">
          Features
        </Text>
        <ul className="home-feature-list">
          {FEATURES.map(({ title, detail }) => (
            <li key={title}>
              <Text variant="body-sm-semibold">{title}</Text>
              <Text variant="body-sm-normal" color="secondary">
                {detail}
              </Text>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <Text as="h3" variant="heading-sm">
          How to use
        </Text>
        <ol className="home-steps">
          {STEPS.map((step) => (
            <li key={step}>
              <Text variant="body-sm-normal">{step}</Text>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <Text as="h3" variant="heading-sm">
          Permissions
        </Text>
        <div className="section-copy">
          <Text variant="body-sm-normal" color="secondary">
            The app declares these Cribl API permissions. When an admin shares the app, they are granted for requests made
            through it. Read-only browsing only uses GET; every write requires an explicit action and confirmation.
          </Text>
        </div>
        <div className="home-table-wrapper">
          <table className="home-table">
            <thead>
              <tr>
                <th scope="col">Area</th>
                <th scope="col">API paths</th>
                <th scope="col">Methods</th>
                <th scope="col">Used for</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(({ area, paths, methods, purpose }) => (
                <tr key={area}>
                  <td>{area}</td>
                  <td>
                    <code>{paths}</code>
                  </td>
                  <td>{methods}</td>
                  <td>{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="home-notes">
          <li>
            <Text variant="body-sm-normal" color="secondary">
              No external services are contacted. All requests go to your Cribl Leader.
            </Text>
          </li>
          <li>
            <Text variant="body-sm-normal" color="secondary">
              No data is stored by the app. Everything is read live from Cribl each time a view loads.
            </Text>
          </li>
        </ul>
      </section>
    </div>
  );
}
