import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const windowsList = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$names = @(Get-CimInstance Win32_Printer | ForEach-Object { $_.Name })
ConvertTo-Json -InputObject $names -Compress
`;
const windowsPrint = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$inputData = [Console]::ReadLine() | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class VinquetaSpooler {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class Doc {
    public string Name = "Vinqueta";
    public string Output = null;
    public string Type = "RAW";
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", ExactSpelling=true, CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", ExactSpelling=true, CharSet=CharSet.Unicode, SetLastError=true)]
  static extern int StartDocPrinter(IntPtr printer, int level, [In] Doc doc);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr printer, byte[] bytes, int length, out int written);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr printer);
  [DllImport("winspool.drv")] static extern bool AbortPrinter(IntPtr printer);
  [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr printer);
  public static int Send(string name, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(name, out h, IntPtr.Zero)) throw new Win32Exception();
    int id = 0;
    bool completed = false;
    try {
      id = StartDocPrinter(h, 1, new Doc());
      if (id <= 0 || !StartPagePrinter(h)) throw new Win32Exception();
      int written;
      if (!WritePrinter(h, bytes, bytes.Length, out written) || written != bytes.Length
          || !EndPagePrinter(h) || !EndDocPrinter(h)) throw new Win32Exception();
      completed = true;
      return id;
    } finally {
      if (id > 0 && !completed) AbortPrinter(h);
      ClosePrinter(h);
    }
  }
}
'@
[VinquetaSpooler]::Send($inputData.printer, [IO.File]::ReadAllBytes($inputData.file))
`;

function powershell(script, input, timeout) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const work = exec(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { timeout, windowsHide: true });
  if (input) {
    work.child.stdin.on('error', () => {});
    work.child.stdin.end(`${JSON.stringify(input)}\n`);
  }
  return work;
}

export async function listPrinters() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await powershell(windowsList, null, 10000);
      const names = JSON.parse(stdout);
      return Array.isArray(names) ? [...new Set(names.filter(name => typeof name === 'string' && name.length <= 256))] : [];
    }
    const { stdout } = await exec('/usr/bin/lpstat', ['-p'], { timeout: 5000, env: { ...process.env, LC_ALL: 'C' } });
    return [...stdout.matchAll(/^printer (\S+)/gm)].map(m => m[1]);
  } catch { return []; }
}

export async function submitRaw(printer, file) {
  if (process.platform === 'win32') {
    const { stdout } = await powershell(windowsPrint, { printer, file }, 30000);
    if (!/^\d+$/.test(stdout.trim())) throw new Error('Resposta inesperada da fila.');
    return `Trabalho ${stdout.trim()}.`;
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(printer)) throw new Error('Nome de fila inválido.');
  const { stdout } = await exec('/usr/bin/lp', ['-d', printer, '-o', 'raw', '--', file], { timeout: 15000 });
  return stdout.trim() || 'Envio aceito.';
}
