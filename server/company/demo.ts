// Deterministic demo execution: generated evidence is explicitly labelled as simulated.
import type { SpecialistExecutor } from './service.ts';
export const demoSpecialistExecutor: SpecialistExecutor = {
  mode: 'demo',
  async execute({ task, profile, knowledge, signal }) {
    if (signal.aborted) throw new Error('Ejecución cancelada.');
    const isSocial = task.title.startsWith('Contenido para');
    const isProposal = task.title.includes('Propuesta comercial');
    const sections = isSocial ? ['Texto: Descubre cómo Saredigital puede ayudarte a avanzar con procesos digitales más claros.', 'Pieza propuesta: demostración breve del servicio, adaptada al formato del canal.', 'Llamada a la acción: solicita una conversación para definir tus necesidades.', 'Programación: pendiente de revisión y aprobación específica de publicación.'] : isProposal ? ['Alcance: analizar la necesidad, acordar el resultado y preparar una propuesta detallada.', 'Entregables: diagnóstico, propuesta de solución y plan de trabajo.', 'Presupuesto: pendiente de validación comercial; no se inventan importes.', 'Próximo paso: revisión humana y confirmación del alcance con el contacto.'] : ['Plan de trabajo: definir el alcance y las personas responsables.', 'Pasos: revisar las fuentes autorizadas, preparar el resultado y registrar las decisiones.', 'Evidencia: este documento es un resultado simulado para probar el flujo de revisión.', 'Seguimiento: el responsable confirma el resultado y autoriza el siguiente paso.'];
    return { title: task.title, kind: isSocial ? 'social_content' : isProposal ? 'proposal' : 'document', content: `SIMULACIÓN DEMO — sin acceso a servicios externos ni ejecución de un modelo.\n\nObjetivo: ${task.objective}\n\n${sections.join('\n\n')}\n\nCriterio de finalización: ${task.completionCriteria}\n\nCalidad: ${profile.qualityCriteria.join('; ')}\n\nFuentes de empresa autorizadas: ${knowledge.map((k) => k.title).join(', ') || 'ninguna'}.`, costEuros: 0 };
  },
};
