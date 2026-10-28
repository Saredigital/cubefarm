// Pocket mode's Approvals tab: everything waiting on the manager's decision. Team changes (new agents and let-gos, the
// phone's cards), stuck PRs with the Kanban's Retry QA / Send back / Merge / Close, and passed PRs on floors that don't
// merge on their own.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { QaView, RepoView } from '../../../shared/types';
import { qaCardNote } from '../qaCard';
import { confirmDialog } from '../ui/Confirm';
import { Resume } from '../ui/Phone';
import { waitingOnYou } from './pocketData';

function PrCard({ repo, qa, ready }: { repo: RepoView; qa: QaView; ready?: boolean }) {
  const author = useStore((s) => (qa.devAgentId ? s.agents[qa.devAgentId] : undefined));
  const [busy, setBusy] = useState(false);
  const pr = repo.pulls.find((p) => p.number === qa.prNumber);
  if (!pr) return null;
  const { note, tone } = qaCardNote(qa, pr, repo.autoMerge);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  };
  const merge = async () => {
    const ok = await confirmDialog(
      ready
        ? { icon: '🎉', title: `¿Hacer merge de la PR #${pr.number}?`, body: `«${pr.title}» ha superado QA. Se fusionará con squash en ${repo.defaultBranch}.`, confirm: 'Squash y merge' }
        : { tone: 'warn', title: `¿Hacer merge de la PR #${pr.number} sin QA?`, body: `«${pr.title}» no ha superado QA. ¿La fusionas igualmente en ${repo.defaultBranch}?`, confirm: 'Merge igualmente' },
    );
    if (ok) await act(() => api.mergePull(repo.id, pr.number));
  };
  const sendBack = async () => {
    let text = '';
    const ok = await confirmDialog({
      icon: '🔧',
      title: `¿Devolver la PR #${pr.number} para corregirla?`,
      body: (
        <>
          <p>Su autor, o cualquier agente libre, la corrige con lo que encontró QA, y luego se vuelve a probar.</p>
          <input maxLength={1000} placeholder="Nota opcional para quien la corrija" aria-label="Nota para quien la corrija" onChange={(e) => (text = e.target.value)} />
        </>
      ),
      confirm: 'Devolver',
    });
    if (ok) await act(() => api.sendBack(repo.id, pr.number, text.trim() || undefined));
  };
  const close = async () => {
    const ok = await confirmDialog({ tone: 'danger', title: `¿Cerrar la PR #${pr.number}?`, body: `«${pr.title}» se cerrará sin hacer merge. La rama se queda en GitHub.`, confirm: 'Cerrar PR' });
    if (ok) await act(() => api.closePull(repo.id, pr.number));
  };
  return (
    <div className={`pk-card pk-pr kcard-${tone ?? 'plain'}`} style={{ ['--accent' as string]: repo.color }}>
      <div className="pk-pr-head">
        <span className="floor-badge">{repo.floor}</span>
        <div className="grow">
          <a href={pr.url} target="_blank" rel="noreferrer">
            <b>PR #{pr.number}</b>
          </a>{' '}
          {pr.title}
          <div className="muted small">
            {repo.fullName.split('/')[1]}
            {author ? ` · de ${author.name}` : ''} · ronda {qa.round} · {note}
          </div>
        </div>
      </div>
      {qa.summary && <div className="small pk-pr-summary">{qa.summary}</div>}
      {qa.commentUrl && (
        <a className="small" href={qa.commentUrl} target="_blank" rel="noreferrer">
          Informe de QA ↗
        </a>
      )}
      <div className="pk-actions">
        {!ready && (
          <button className="btn btn-small btn-good" disabled={busy} onClick={() => void act(() => api.sendToQa(repo.id, pr.number))}>
            Repetir QA
          </button>
        )}
        {!ready && (
          <button className="btn btn-small" disabled={busy} onClick={() => void sendBack()}>
            Devolver
          </button>
        )}
        <button className={`btn btn-small ${ready ? 'btn-good' : ''}`} disabled={busy || pr.isDraft} onClick={() => void merge()}>
          {ready ? 'Merge' : 'Merge igualmente'}
        </button>
        <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void close()}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

export function Approvals() {
  const repos = useStore((s) => s.repos);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  const w = waitingOnYou(repos, qa, requests);
  const nothing = w.requests.length + w.stuck.length + w.ready.length === 0;
  return (
    <div className="pk-page">
      {nothing && <p className="pk-empty">Nada espera tu respuesta. El equipo sigue trabajando y tu móvil se enterará cuando eso cambie.</p>}
      {w.requests.length > 0 && <h3 className="pk-h">👥 Cambios en el equipo</h3>}
      {w.requests.map((r) => (
        <Resume key={r.id} req={r} />
      ))}
      {w.stuck.length > 0 && <h3 className="pk-h">⚠️ Pull requests que te necesitan</h3>}
      {w.stuck.map((s) => (
        <PrCard key={`${s.repo.id}#${s.qa.prNumber}`} repo={s.repo} qa={s.qa} />
      ))}
      {w.ready.length > 0 && <h3 className="pk-h">✅ Listas para merge</h3>}
      {w.ready.map((s) => (
        <PrCard key={`${s.repo.id}#${s.qa.prNumber}`} repo={s.repo} qa={s.qa} ready />
      ))}
    </div>
  );
}
