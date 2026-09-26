import { execFile } from 'node:child_process';
import type { FolderGuard } from '../shared/types';
import { logger } from './log';

const log = logger('guard');

/*
 * Windows Defender "Controlled folder access" blocks unknown programs from writing
 * to Desktop, Documents, Videos, Pictures and Music. It is off by default, but when
 * someone has it on, every download into those folders fails. We can detect it, and
 * with the person's consent (the normal admin prompt) add PlayzAnime to its allow list.
 */

function powershell(command: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout) => resolve(err ? '' : String(stdout).trim()),
    );
  });
}

export async function folderGuard(): Promise<FolderGuard> {
  if (process.platform !== 'win32') return 'off';
  const out = await powershell('(Get-MpPreference).EnableControlledFolderAccess');
  if (out === '0') return 'off';
  if (out === '1') return 'on';
  if (out === '2') return 'audit';
  return 'unknown';
}

/**
 * Adds the given programs (the app and ffmpeg) to the allow list. Windows shows its
 * own admin prompt; nothing changes unless the person approves it there.
 */
export async function allowThroughGuard(programs: string[]): Promise<boolean> {
  if (process.platform !== 'win32') return true;
  const list = programs
    .filter(Boolean)
    .map((p) => `'${p.replace(/'/g, "''")}'`)
    .join(',');
  // Each program is added on its own, so one bad path can't cost the others.
  const inner = `foreach ($p in @(${list})) { try { Add-MpPreference -ControlledFolderAccessAllowedApplications $p } catch {} }`;
  // The elevated script travels base64-encoded, so no quoting in the paths can break it.
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const command =
    `try { Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile','-EncodedCommand','${encoded}' -ErrorAction Stop; 'ok' } catch { 'declined' }`;
  const out = await powershell(command, 120_000);
  log.info(`folder access allow-list request: ${out || 'no answer'}`);
  return out === 'ok';
}
