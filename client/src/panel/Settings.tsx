// The control panel's Settings: the manager's tabs (projects and the office's update, the CEO, the team, issues, the
// office settings), mission control and accessibility, each a tab.
import { useState } from 'react';
import { useStore } from '../store';
import { AccessibilitySettings } from '../ui/AccessibilitySettings';
import { CeoTab, FloorsTab, IssuesTab, SettingsTab, TeamTab } from '../ui/ManagerTabs';
import { OpsTab } from '../ui/MissionConsole';

type Tab = 'general' | 'projects' | 'team' | 'ceo' | 'ops' | 'issues' | 'access';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');
  const alarms = useStore((s) => s.ops.alarms.length + s.doctor.length);
  const tabs: [Tab, string][] = [
    ['general', 'General'],
    ['projects', 'Proyectos'],
    ['team', 'Equipo'],
    ['ceo', 'CEO'],
    ['ops', `Centro de control${alarms ? ` (${alarms})` : ''}`],
    ['issues', 'Issues'],
    ['access', 'Accesibilidad'],
  ];
  return (
    <>
      <header className="cp-header">
        <div className="cp-header-text">
          <h1>Ajustes</h1>
          <div className="cp-sub">Cómo trabajan los agentes y el CEO, los proyectos, el equipo, la nube, la voz y las notificaciones.</div>
        </div>
      </header>
      <div className="cp-tabs" role="tablist" aria-label="Ajustes">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="cp-legacy" role="tabpanel" aria-label={tabs.find(([k]) => k === tab)?.[1]}>
        {tab === 'general' && <SettingsTab />}
        {tab === 'projects' && <FloorsTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'ceo' && <CeoTab />}
        {tab === 'ops' && <OpsTab />}
        {tab === 'issues' && <IssuesTab />}
        {tab === 'access' && (
          <div className="tab-grid a11y-grid">
            <AccessibilitySettings />
          </div>
        )}
      </div>
    </>
  );
}
