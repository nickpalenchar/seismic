import { HttpRoute } from '../httpRoute';


export interface HealthView {
  service: 'seismic';
  status: 'ok';
}

/**
 * Whether Seismic answers here: the desktop shell asks this before a window opens on a workspace
 * (desktop/src/desks/remote.rs). A device that is not paired gets the gate's `401 notPaired`
 * instead, which the shell takes as Seismic too.
 */
export class Health extends HttpRoute {
  readonly path = '/api/v1/health';

  override GET = (): HealthView => ({ service: 'seismic', status: 'ok' });
}
