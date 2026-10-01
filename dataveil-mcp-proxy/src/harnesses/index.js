import { pi } from './pi.js';
import { opencode } from './opencode.js';
import { codex } from './codex.js';

export const harnesses = [pi, opencode, codex];
export function detectHarness(env = process.env) {
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return 'codex';
  if (env.OPENCODE === '1' || env.OPENCODE_PID) return 'opencode';
  return null;
}
