import { create } from 'zustand';
import type { CompanyPublicView } from '../../../shared/company';

// Only this deliberately minimal projection may be read by the shared office.
export const useCompanyPublic = create<{ view: CompanyPublicView | null; error: string | null }>(() => ({ view: null, error: null }));
export async function refreshCompanyPublic(signal?: AbortSignal) {
  try {
    const response = await fetch('/api/company/public', { signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('No se ha podido cargar el directorio de departamentos.');
    const view = await response.json() as CompanyPublicView;
    useCompanyPublic.setState({ view, error: null });
  } catch (error) {
    if (!signal?.aborted) useCompanyPublic.setState({ error: error instanceof Error ? error.message : 'Error de conexión.' });
  }
}
export const companyDepartmentOnFloor = (floor: number) => useCompanyPublic.getState().view?.departments.find((d) => !d.archived && d.floor === floor);
export const companyTopFloor = () => Math.max(0, ...(useCompanyPublic.getState().view?.departments.filter((d) => !d.archived).map((d) => d.floor) ?? []));
