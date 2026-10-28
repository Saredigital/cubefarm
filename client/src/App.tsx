import { lazy, Suspense, useEffect } from 'react';
import { useMode } from './pocket/mode';
import { Captions, LiveRegions } from './ui/CaptionStrip';
import { ConfirmDialog } from './ui/Confirm';
import { refreshCompanyPublic } from './company/public';
import './company/company.css';

// Each loads only when it's shown: a phone in pocket mode never fetches the panel, nor a computer pocket mode.
const Pocket = lazy(() => import('./pocket/Pocket'));
const ControlPanel = lazy(() => import('./panel/ControlPanel'));
const CompanyWorkspace = lazy(() => import('./company/CompanyWorkspace').then((m) => ({ default: m.CompanyWorkspace })));

export function App() {
  const mode = useMode((s) => s.mode);
  const standalone = new URLSearchParams(location.search).has('company');
  useEffect(() => {
    const controller = new AbortController();
    void refreshCompanyPublic(controller.signal);
    const timer = setInterval(() => { if (!document.hidden) void refreshCompanyPublic(controller.signal); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  if (standalone) return <main className="company-standalone"><Suspense fallback={<div className="app-loading">Cargando la gestión de empresa…</div>}><CompanyWorkspace embedded /></Suspense><LiveRegions /></main>;
  return (
    <>
      <Suspense fallback={<div className="app-loading">Cargando el panel…</div>}>{mode === 'pocket' ? <Pocket /> : <ControlPanel />}</Suspense>
      <ConfirmDialog />
      <Captions />
      <LiveRegions />
    </>
  );
}
