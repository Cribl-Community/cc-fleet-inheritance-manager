import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Text } from '@capra/core';
import { FleetOutlined, BoxOutlined, GitBranchOutlined } from '@capra/icons';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FleetsView } from './components/FleetsView';
import { PacksView } from './components/PacksView';
import { InheritanceView } from './components/InheritanceView';
import './App.css';

function NavigationTabs() {
  const location = useLocation();
  const basePath = window.CRIBL_BASE_PATH || '/';

  const tabs = [
    { path: '/', label: 'Fleets', icon: FleetOutlined },
    { path: '/packs', label: 'Packs', icon: BoxOutlined },
    { path: '/inheritance', label: 'Inheritance', icon: GitBranchOutlined },
  ];

  return (
    <div className="nav-tabs">
      {tabs.map(tab => {
        const isActive = location.pathname === (tab.path === '/' ? '/' : tab.path);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`nav-tab ${isActive ? 'active' : ''}`}
            style={{
              padding: '0.75rem 1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              textDecoration: 'none',
              color: 'inherit',
              borderBottom: isActive ? '3px solid var(--ds-text-primary)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <Icon size="sm" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function AppContent() {
  return (
    <div className="app-container">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '1.5rem' }}>📦</div>
          <div>
            <Text as="h1" variant="heading">
              Fleet Inheritance Manager
            </Text>
            <Text variant="body-sm" style={{ opacity: 0.7 }}>
              Visualize and manage fleet pack inheritance
            </Text>
          </div>
        </div>
      </header>

      <NavigationTabs />

      <main className="app-main">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<FleetsView />} />
            <Route path="/packs" element={<PacksView />} />
            <Route path="/inheritance" element={<InheritanceView />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  const basePath = window.CRIBL_BASE_PATH || '/';
  const [themeBridgeReady, setThemeBridgeReady] = useState(false);

  // Install theme bridge to sync with host dark/light mode
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as { type?: string; theme?: 'light' | 'dark' } | null;
      if (data?.type !== 'CRIBL_APP_LAYOUT') return;
      if (data.theme !== 'light' && data.theme !== 'dark') return;
      document.body.classList.toggle('dark', data.theme === 'dark');
    };

    window.addEventListener('message', handleMessage);
    setThemeBridgeReady(true);

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <BrowserRouter basename={basePath}>
      <AppContent />
    </BrowserRouter>
  );
}
