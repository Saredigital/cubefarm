import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID, type RepoView } from '../../../shared/types';
import { ProjectPicker } from './ProjectPicker';

// First run: who you are, the company, your CEO and your first project. Every field has a default, so
// "Skip" (or just pressing Next) gets a working office.

const COMPANIES = ['Pixel & Pine', 'Byte Bakery', 'Night Owl Software', 'Tiny Rocket Co.', 'Moonbeam Works', 'Happy Path Inc.', 'Merge Conflict Ltd.', 'Quokka Labs', 'Blue Kettle Studio', 'Paper Plane Software'];
const CEO_NAMES = ['Morgan', 'Avery', 'Jordan', 'Riley', 'Quinn', 'Harper', 'Rowan', 'Sasha', 'Casey', 'Jamie', 'Alex', 'Robin'];
const TIES = ['#e63946', '#3a86ff', '#06d6a0', '#ffbe0b', '#9b5de5', '#fb5607'];
const STEPS = ['Bienvenida', 'Tú', 'Tu CEO', 'Primer proyecto', 'Listo'];

const pickOther = <T,>(list: T[], current: T) => {
  const rest = list.filter((x) => x !== current);
  return rest[Math.floor(Math.random() * rest.length)];
};

/** A little portrait of the CEO in their suit. */
function CeoPortrait({ color, look }: { color: string; look: 'feminine' | 'masculine' }) {
  return (
    <svg viewBox="0 0 120 120" className="ceo-portrait" aria-hidden="true">
      <circle cx="60" cy="60" r="58" fill="#e6dcff" stroke="#1f1d2b" strokeWidth="3" />
      {look === 'feminine' && <ellipse cx="60" cy="58" rx="27" ry="32" fill="#2b2118" stroke="#1f1d2b" strokeWidth="2.5" />}
      <path d="M22 118 C24 88 40 80 60 80 C80 80 96 88 98 118 Z" fill="#2b2d42" stroke="#1f1d2b" strokeWidth="3" />
      <path d="M50 81 L60 96 L70 81 Z" fill="#f8f9fa" />
      <path d="M57 84 L63 84 L65 108 L60 113 L55 108 Z" fill={color} stroke="#1f1d2b" strokeWidth="1.5" />
      <circle cx="60" cy="52" r="22" fill="#f1c27d" stroke="#1f1d2b" strokeWidth="3" />
      <path d="M38 50 C38 30 82 30 82 50 C74 40 46 40 38 50 Z" fill="#2b2118" stroke="#1f1d2b" strokeWidth="2" />
      <circle cx="52" cy="54" r="2.6" fill="#1f1d2b" />
      <circle cx="68" cy="54" r="2.6" fill="#1f1d2b" />
      <path d="M53 62 Q60 68 67 62" fill="none" stroke="#1f1d2b" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function SetupWizard() {
  const user = useStore((s) => s.user);
  const demo = useStore((s) => s.demo);
  const ghReady = useStore((s) => s.ghReady);
  const ghError = useStore((s) => s.ghError);
  const ceoAgent = useStore((s) => s.agents[CEO_ID]);
  const maxAgents = useStore((s) => s.settings.maxAgents);

  const [step, setStep] = useState(0);
  const [managerName, setManagerName] = useState('');
  const [companyName, setCompanyName] = useState(() => COMPANIES[Math.floor(Math.random() * COMPANIES.length)]);
  const [ceoName, setCeoName] = useState(ceoAgent?.name ?? 'Morgan');
  const [ceoLook, setCeoLook] = useState<'feminine' | 'masculine'>(ceoAgent?.look ?? 'masculine');
  const [ceoColor, setCeoColor] = useState(ceoAgent?.color ?? TIES[0]);
  const [scaling, setScaling] = useState<'approve' | 'auto'>('approve');
  const [project, setProject] = useState<RepoView | null>(null);
  const [busy, setBusy] = useState(false);

  const me = managerName.trim() || user || 'Jefe';
  const ceo = ceoName.trim() || 'Morgan';
  const company = companyName.trim() || COMPANIES[0];

  const save = () => api.setup({ managerName: me, companyName: company, scaling, ceoName: ceo, ceoLook, ceoColor });
  const finish = async () => {
    setBusy(true);
    try {
      await save();
      await api.updateSettings({ setupDone: true, tutorialStep: -1 });
    } catch {
      setBusy(false); // api() already toasted
    }
  };
  const next = async () => {
    if (step === 2) {
      setBusy(true);
      try {
        await save(); // so the CEO already knows everyone's names when they study the first project
      } catch {
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setStep(step + 1);
  };

  return (
    <div className="start">
      <div className="start-card wizard">
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <span key={s} className={`wizard-dot ${i === step ? 'wizard-dot-on' : i < step ? 'wizard-dot-done' : ''}`} title={s} />
          ))}
        </div>

        {step === 0 && (
          <>
            <img className="start-logo" src="/icons/icon.svg" alt="" />
            <h1>sareoffice</h1>
            <p className="start-tag">El panel de control de tu empresa de software: proyectos, agentes de código de IA y tareas en un solo sitio.</p>
            <ul className="start-list">
              <li>🗂️ Cada proyecto tiene su equipo de agentes de código, que construye y prueba sus issues de GitHub.</li>
              <li>🧠 Un CEO estudia cada proyecto, planifica el trabajo que pides y decide el tamaño de cada equipo. Tú apruebas cada contratación.</li>
              <li>✋ Lanzas tareas, ves cada terminal en directo y apruebas lo que importa desde el panel.</li>
            </ul>
            {!ghReady && ghError && <div className="term-error small">⚠️ {ghError}</div>}
            <button className="btn btn-big" onClick={() => setStep(1)}>
              Vamos a montar tu empresa
            </button>
            <div className="start-meta">
              <button className="linkish" onClick={finish} disabled={busy}>
                Saltar la configuración y usar los valores por defecto
              </button>
              {demo && <span className="pill pill-demo">MODO DEMO</span>}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="wizard-icon">🧑‍💼</div>
            <h2>¿Quién manda aquí?</h2>
            <p className="start-tag">Tú. Tú diriges la empresa; los agentes teclean.</p>
            <label className="field">
              <span>Tu nombre</span>
              <input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder={user ?? 'Jefe'} autoFocus />
            </label>
            <label className="field">
              <span>Nombre de la empresa</span>
              <div className="row" style={{ margin: 0 }}>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={COMPANIES[0]} />
                <button type="button" className="btn btn-small" title="Sugerir otro nombre" onClick={() => setCompanyName(pickOther(COMPANIES, companyName))}>
                  🎲
                </button>
              </div>
            </label>
            <p className="muted small">Puedes cambiar ambos cuando quieras en Ajustes.</p>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Conoce a tu CEO</h2>
            <div className="ceo-setup">
              <CeoPortrait color={ceoColor} look={ceoLook} />
              <div className="grow">
                <label className="field">
                  <span>Nombre</span>
                  <div className="row" style={{ margin: 0 }}>
                    <input value={ceoName} onChange={(e) => setCeoName(e.target.value)} placeholder="Morgan" autoFocus />
                    <button type="button" className="btn btn-small" title="Sugerir otro nombre" onClick={() => setCeoName(pickOther(CEO_NAMES, ceoName))}>
                      🎲
                    </button>
                  </div>
                </label>
                <div className="row">
                  <label className="toggle">
                    <input type="radio" checked={ceoLook === 'feminine'} onChange={() => setCeoLook('feminine')} /> 👩 Ella
                  </label>
                  <label className="toggle">
                    <input type="radio" checked={ceoLook === 'masculine'} onChange={() => setCeoLook('masculine')} /> 👨 Él
                  </label>
                  <span className="spacer" />
                  {TIES.map((c) => (
                    <button key={c} type="button" className={`swatch ${c === ceoColor ? 'swatch-on' : ''}`} style={{ background: c }} onClick={() => setCeoColor(c)} title="Color de la corbata" />
                  ))}
                </div>
                <div className="muted small">Claude Opus 5.5 con esfuerzo xhigh: quien más piensa de toda la empresa.</div>
              </div>
            </div>
            <p className="start-tag" style={{ margin: '12px 0 6px' }}>
              {ceo} estudia cada proyecto, escribe su lista de comprobación de QA, convierte el trabajo que pides en issues de GitHub y decide el tamaño de cada equipo.
            </p>
            <label className="toggle block">
              <input type="radio" checked={scaling === 'approve'} onChange={() => setScaling('approve')} />
              <span>
                <b>Pregúntame antes de cada cambio de equipo</b> (recomendado). Los candidatos esperan en Aprobaciones.
              </span>
            </label>
            <label className="toggle block">
              <input type="radio" checked={scaling === 'auto'} onChange={() => setScaling('auto')} />
              <span>
                <b>Deja que {ceo} cambie los equipos</b> por su cuenta, hasta {maxAgents} agentes por proyecto.
              </span>
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Tu primer proyecto</h2>
            {project ? (
              <div className="wizard-done">
                <div className="wizard-icon">🎉</div>
                <p>
                  <b>{project.fullName}</b> ya está conectado.
                </p>
                <p className="muted">
                  {ceo} lo está estudiando ahora mismo y te escribirá cuando sepa qué tamaño debe tener el equipo. Ya hay un agente en el equipo.
                </p>
              </div>
            ) : (
              <>
                <p className="start-tag">Elige una de tus carpetas de proyecto, un repositorio de GitHub o empieza algo nuevo. Todos los proyectos tienen que estar en GitHub: el equipo trabaja con issues y pull requests.</p>
                <ProjectPicker onConnected={setProject} />
              </>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <div className="wizard-icon">🏢</div>
            <h2>{company} abre sus puertas</h2>
            <ul className="start-list">
              <li>
                🧠 {ceo}{project ? ` está estudiando ${project.fullName.split('/')[1]}` : ' está esperando tu primer proyecto'}.{' '}
                {scaling === 'approve' ? 'Los cambios de equipo esperan tu visto bueno.' : `Los cambios de equipo de hasta ${maxAgents} agentes por proyecto se aplican solos.`}
              </li>
              <li>➕ Pulsa Lanzar tarea (o Ctrl K) para darle trabajo a un agente libre o pedirle a {ceo} que lo planifique.</li>
              <li>💬 Chatea con {ceo} y revisa lo que espera tu aprobación desde la barra lateral.</li>
            </ul>
            <button className="btn btn-big" onClick={finish} disabled={busy}>
              {busy ? 'Preparando el panel…' : 'Entrar en el panel'}
            </button>
          </>
        )}

        {step > 0 && step < 4 && (
          <div className="wizard-nav">
            <button className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>
              ← Atrás
            </button>
            <span className="spacer" />
            {step === 3 && !project && (
              <button className="linkish" onClick={() => setStep(4)}>
                Lo añadiré más tarde
              </button>
            )}
            {(step !== 3 || project) && (
              <button className="btn btn-good" onClick={() => void next()} disabled={busy}>
                Siguiente →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
