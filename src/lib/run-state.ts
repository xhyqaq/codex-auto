import { writeJsonAtomic } from './fs.js';
import { runStatePath } from './paths.js';

export type ManagedRunStatus = 'running' | 'exited' | 'failed' | 'recovery_failed';

export type ManagedRunState = {
  version: 1;
  runId: string;
  pid: number;
  workspaceDir: string;
  startedAt: string;
  updatedAt: string;
  status: ManagedRunStatus;
  currentAccount: string;
  currentSessionId: string | null;
  sessionBindingLost: boolean;
};

export async function writeManagedRunState(
  appHome: string,
  state: Omit<ManagedRunState, 'version' | 'updatedAt'> & { updatedAt?: string }
): Promise<void> {
  await writeJsonAtomic(runStatePath(appHome, state.runId), {
    ...state,
    version: 1,
    updatedAt: state.updatedAt ?? new Date().toISOString()
  });
}
