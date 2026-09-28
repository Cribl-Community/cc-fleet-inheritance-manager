import { Alert, Text } from '@capra/core';
import { BoxArchive, BranchesOutlined, FleetOutlined } from '@capra/icons';
import { useState } from 'react';
import { NavLink, Navigate, Route, RouterProvider, Routes, createBrowserRouter } from 'react-router-dom';
import { hasCriblApiUrl } from './api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FleetsView } from './components/FleetsView';
import { InheritanceView } from './components/InheritanceView';
import { PacksView } from './components/PacksView';
import './App.css';

function NavigationTabs() {
  const tabs = [
    { path: '/', label: 'Fleets', Icon: FleetOutlined },
    { path: '/packs', label: 'Packs', Icon: BoxArchive },
    { path: '/inheritance', label: 'Inheritance', Icon: BranchesOutlined },
  ];

  return (
    <nav className="nav-tabs" aria-label="Primary">
      {tabs.map(({ path, label, Icon }) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          className={({ isActive }) => `nav-tab${isActive ? ' nav-tab-active' : ''}`}
        >
          <Icon size="sm" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function AppContent() {
  const standaloneMode = !hasCriblApiUrl();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-header-title">
          <div className="app-header-icon" aria-hidden="true">
            <BoxArchive size="md" />
          </div>
          <div>
            <Text as="h1" variant="heading-lg">
              Fleet Inheritance Manager
            </Text>
            <div className="app-subtitle">
              <Text variant="body-sm-normal" color="secondary">
                Visualize fleet, pack, and knowledge object inheritance.
              </Text>
            </div>
          </div>
        </div>
        {standaloneMode ? (
          <div className="app-banner">
            <Alert appearance="warning" title="Standalone dev mode">
              The UI will render on localhost, but live Cribl data requires Cribl live preview or
              an injected <code>CRIBL_API_URL</code>.
            </Alert>
          </div>
        ) : null}
      </header>

      <NavigationTabs />

      <main className="app-main">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<FleetsView />} />
            <Route path="/packs" element={<PacksView layout="action-bar" />} />
            <Route path="/packs-preview" element={<Navigate to="/packs" replace />} />
            <Route path="/inheritance" element={<InheritanceView />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  // A data router is required for useBlocker (leave-page confirmation in the Packs tab).
  const [router] = useState(() =>
    createBrowserRouter([{ path: '*', element: <AppContent /> }], { basename: window.CRIBL_BASE_PATH ?? '/' }),
  );

  return <RouterProvider router={router} />;
}
