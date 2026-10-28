// Launch a task from anywhere in the control panel (Ctrl K): written in plain words, it becomes an issue for the next
// free agent or for one picked here, or goes to the CEO to plan into issues.
import { useMemo, useState } from 'react';
import { api } from '../api';
import { agentsOnRepo, isBusy, useStore } from '../store';
import { Panel } from '../ui/Panel';
import { ceoTask, shortName, taskIssue, type LaunchMode } from './panelData';

export function LaunchTask({ repoId: initial, onClose, onCeo }: { repoId?: string; onClose: () => void; onCeo: () => void }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const [text, setText] = useState('');
  const [repoId, setRepoId] = useState(initial ?? repos[0]?.id ?? '');
  const [mode, setMode] = useState<LaunchMode>('backlog');
  const [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const repo = repos.find((r) => r.id === repoId);
  const free = useMemo(() => agentsOnRepo(agents, repoId).filter((a) => a.role !== 'ceo' && !isBusy(a)), [agents, repoId]);
  const ready = !!text.trim() && !!repo && (mode !== 'agent' || free.some((a) => a.id === agentId));

  const submit = async () => {
    if (!ready || busy || !repo) return;
    setBusy(true);
    const toast = useStore.getState().pushToast;
    try {
      if (mode === 'ceo') {
        await api.messageCeo(ceoTask(shortName(repo.fullName), text));
        toast('success', 'Tarea enviada al CEO para que la planifique');
        onClose();
        onCeo();
        return;
      }
      const { title, body } = taskIssue(text);
      // The office toasts the new issue itself.
      await api.createIssue(repo.id, title, body, mode === 'agent' ? agentId : undefined);
      onClose();
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Lanzar tarea" onClose={onClose} className="cp-launch">
      <form
        className="cp-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        {repos.length === 0 && <p className="cp-empty">Conecta antes un proyecto para poder lanzarle tareas.</p>}
        <div className="cp-field">
          <label className="cp-label" htmlFor="cp-task">
            ¿Qué hay que hacer?
          </label>
          <textarea
            id="cp-task"
            className="cp-textarea"
            rows={5}
            autoFocus
            maxLength={8000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="P. ej. Añadir un buscador de facturas por fecha e importe en el área privada. Debe funcionar en móvil."
          />
          <div className="cp-hint">Escríbelo como se lo contarías a una persona. La primera frase será el título de la issue en GitHub.</div>
        </div>
        <div className="cp-field">
          <label className="cp-label" htmlFor="cp-task-repo">
            Proyecto
          </label>
          <select
            id="cp-task-repo"
            className="cp-select"
            value={repoId}
            onChange={(e) => {
              setRepoId(e.target.value);
              setAgentId('');
            }}
          >
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {shortName(r.fullName)}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="cp-form" style={{ border: 0, margin: 0, padding: 0, gap: 10 }}>
          <legend className="cp-label" style={{ marginBottom: 8 }}>
            ¿Quién se encarga?
          </legend>
          <label className="cp-opt">
            <input type="radio" name="cp-mode" checked={mode === 'backlog'} onChange={() => setMode('backlog')} />
            <span>
              <span style={{ fontWeight: 500 }}>El primer agente libre</span>
              <span className="cp-hint" style={{ display: 'block' }}>
                {repo?.autoAssign === false
                  ? 'Se queda en el backlog: este proyecto tiene la asignación automática desactivada.'
                  : 'Crea la issue y la coge el siguiente agente libre, que la construye, la pasa a QA y la deja lista para fusionar.'}
              </span>
            </span>
          </label>
          <label className="cp-opt">
            <input type="radio" name="cp-mode" checked={mode === 'agent'} onChange={() => setMode('agent')} />
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 500 }}>Un agente concreto</span>
              <span className="cp-hint" style={{ display: 'block' }}>
                {free.length ? 'Se la asignas directamente y empieza ya.' : 'Ahora mismo no hay ningún agente libre en este proyecto.'}
              </span>
              {mode === 'agent' && free.length > 0 && (
                <select className="cp-select" style={{ marginTop: 10 }} aria-label="Agente" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">Elige un agente libre…</option>
                  {free.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </label>
          <label className="cp-opt">
            <input type="radio" name="cp-mode" checked={mode === 'ceo'} onChange={() => setMode('ceo')} />
            <span>
              <span style={{ fontWeight: 500 }}>Que el CEO lo planifique</span>
              <span className="cp-hint" style={{ display: 'block' }}>
                El CEO la divide en issues con sus dependencias y las reparte. Sigue la conversación en su chat.
              </span>
            </span>
          </label>
        </fieldset>
        <div className="cp-modal-foot">
          <span className="cp-hint">Ctrl + Enter para lanzar</span>
          <button type="button" className="cp-btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="cp-btn cp-btn-primary" disabled={!ready || busy}>
            {busy ? 'Lanzando…' : 'Lanzar tarea'}
          </button>
        </div>
      </form>
    </Panel>
  );
}
