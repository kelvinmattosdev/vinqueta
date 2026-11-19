import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Uso: npm run setup:protocol -- /caminho/CriptografiaUtil.cs');
const code = await readFile(source, 'utf8');
const key = code.match(/private static string CHAVE\s*=\s*"([^"]+)"/)?.[1];
if (!key) throw new Error('A chave de compatibilidade não foi encontrada no arquivo indicado.');
await mkdir('.local', { recursive: true, mode: 0o700 });
await writeFile(resolve('.local/protocol.json'), JSON.stringify({ key }), { mode: 0o600 });
console.log('Protocolo importado localmente. Nenhuma credencial de usuário foi armazenada.');
