import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { nodeExecutable, runConfigure, runStatus } from '../dataveil-mcp-proxy/src/configure.js';

const scriptPath = fileURLToPath(new URL('../dataveil-mcp-proxy/src/index.js', import.meta.url));

export default function dataveilExtension(pi: ExtensionAPI) {
  pi.registerCommand('dataveil', {
    description: 'DataVeil setup, configuration status, or session gateway',
    handler: async (args, ctx) => {
      const action = args.trim() || 'status';
      if (!ctx.hasUI) throw new Error('DataVeil commands require a Pi UI; use the terminal CLI for status');
      const ui = {
        input: (title: string, placeholder?: string) => ctx.ui.input(title, placeholder),
        select: (title: string, options: string[]) => ctx.ui.select(title, options),
      };
      try {
        if (action === 'setup') {
          const result = await runConfigure('pi', { scriptPath, ui, cwd: ctx.cwd });
          ctx.ui.notify(result.status === 'cancelled' ? 'DataVeil setup cancelled.' :
            `DataVeil configured: ${result.name}. Run /reload to connect. Runtime protection has not been verified.`, 'info');
        } else if (action === 'status') {
          ctx.ui.notify(await runStatus({ harnessKey: 'pi', scriptPath, cwd: ctx.cwd, ui }), 'info');
        } else if (action === 'gateway') {
          const profilesPath = join(ctx.cwd, 'dataveil-profiles.json');
          if (!existsSync(profilesPath)) throw new Error(`Create ${profilesPath} with named stdio MCP backends first`);
          pi.registerMcpServer('dataveil', {
            command: nodeExecutable(ctx.cwd),
            args: [scriptPath, '--gateway'],
            env: { DATAVEIL_PROFILES_FILE: profilesPath, DATAVEIL_PII_MODE: 'block', DATAVEIL_ENABLED: 'true' },
            exposure: 'codemode',
          });
          ctx.ui.notify('DataVeil gateway registered for this session. Use dataveil_connect to select a profile and dataveil_status to inspect routing and policy.', 'info');
        } else throw new Error('Usage: /dataveil setup|status|gateway');
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
    },
  });
}
