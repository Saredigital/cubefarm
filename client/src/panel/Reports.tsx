// A project's analysis reports (issues labelled swarm:analysis): read here instead of on GitHub, and handed to the
// CEO to turn into work. The list comes with the snapshot; a report's text is fetched when it's opened.
import { useState } from 'react';
import type { RepoView, ReportView } from '../../../shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { Markdown } from '../ui/Markdown';
import { ago } from './panelData';

function Report({ repo, r }: { repo: RepoView; r: ReportView }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const load = () => {
    if (text !== null) return;
    api.report(repo.id, r.issue).then(
      (x) => setText(x.text),
      () => setFailed(true),
    );
  };
  const toCeo = async () => {
    setSending(true);
    try {
      await api.reportToCeo(repo.id, r.issue);
      useStore.getState().pushToast('success', 'Informe enviado al CEO: te contestará en su chat');
    } catch {
      // toasted
    } finally {
      setSending(false);
    }
  };
  return (
    <details className="cp-card cp-card-pad cp-report" onToggle={(e) => e.currentTarget.open && load()}>
      <summary>
        <b>
          #{r.issue} {r.title}
        </b>
        <span className="cp-muted cp-small">
          {' '}
          · {r.agentName} · {ago(r.at, Date.now())}
        </span>
        <div className="cp-muted cp-small cp-report-excerpt">{r.excerpt}</div>
      </summary>
      {failed && !text && <p className="cp-muted cp-small">No se ha podido cargar el informe.</p>}
      {!failed && text === null && <p className="cp-muted cp-small">Cargando…</p>}
      {text !== null && <Markdown text={text} className="cp-report-text" />}
      <div className="cp-actions" style={{ marginTop: 12 }}>
        {!repo.localPath && (
          <a className="cp-btn" href={`${repo.url}/issues/${r.issue}`} target="_blank" rel="noreferrer">
            Ver en GitHub
          </a>
        )}
        <button className="cp-btn cp-btn-primary" disabled={sending} onClick={() => void toCeo()}>
          {sending ? 'Enviando…' : 'Enviar al CEO'}
        </button>
      </div>
    </details>
  );
}

export function Reports({ repo }: { repo: RepoView }) {
  const all = useStore((s) => s.reports);
  const reports = all.filter((r) => r.repoId === repo.id);
  return (
    <section>
      <div className="cp-section-title">
        <span className="cp-muted cp-small">Los análisis terminados de este proyecto. Lanza uno con «+ Lanzar tarea» → Analizar, o pídeselo al CEO. «Enviar al CEO» le pide que convierta las conclusiones en trabajo.</span>
      </div>
      {reports.length === 0 ? <p className="cp-empty">Todavía no hay informes en este proyecto.</p> : reports.map((r) => <Report key={r.id} repo={repo} r={r} />)}
    </section>
  );
}
