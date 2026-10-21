import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Чтение базы ExaHotelFree.
 * Файлы *.dat (снимки таблиц) и *.ts (транзакции журнала) — это 4 байта заголовка
 * и XML, сжатый zlib. Каждая запись — элемент с атрибутами: <R ID="…" Name="…"/>.
 */

export interface ExaElem {
  tag: string;
  a: Record<string, string>;
}

export interface ExaPayload {
  tables: Record<string, Record<string, string>[]>;
  journal: ExaElem[][];
}

export interface ExaSource {
  dataDir: string;
  version: string;
  lastChange: string;
}

const TABLES = ['Rooms', 'Clients', 'Orders', 'OrderLiving'];

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export function decodeExaFile(file: string): string {
  const buf = fs.readFileSync(file);
  return zlib.inflateSync(buf.subarray(4)).toString('utf8').replace(/^\uFEFF/, '');
}

export function parseElements(xml: string): ExaElem[] {
  const out: ExaElem[] = [];
  for (const m of xml.matchAll(/<([\w.]+)\s([^>]*?)\/>/g)) {
    const a: Record<string, string> = {};
    for (const am of m[2].matchAll(/([\w.]+)="([^"]*)"/g)) a[am[1]] = decodeEntities(am[2]);
    out.push({ tag: m[1], a });
  }
  return out;
}

/** Ищет базу ExaHotelFree на этом компьютере (сначала версия 9, затем 8). */
export function findExaDatabase(): ExaSource | null {
  const candidates = [
    { dir: path.join(process.env.LOCALAPPDATA ?? '', 'ExaHotelFree', 'EvalDB', 'Data'), version: '9' },
    { dir: path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'ExaHotelFree', 'Data'), version: '8' },
    { dir: path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ExaHotelFree', 'Data'), version: '9' },
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c.dir, 'Orders.dat'))) {
      const latest = fs
        .readdirSync(c.dir)
        .map((f) => fs.statSync(path.join(c.dir, f)).mtime)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return { dataDir: c.dir, version: c.version, lastChange: latest?.toISOString() ?? '' };
    }
  }
  return null;
}

export function readExaDatabase(dataDir: string): ExaPayload {
  const tables: ExaPayload['tables'] = {};
  for (const t of TABLES) {
    const rows: Record<string, string>[] = [];
    // Основная таблица и архивы (OrdersArch, OrdersArch2).
    for (const f of [`${t}.dat`, `${t}Arch.dat`, `${t}Arch2.dat`]) {
      const p = path.join(dataDir, f);
      if (!fs.existsSync(p)) continue;
      for (const e of parseElements(decodeExaFile(p))) if (e.tag === 'R' && e.a.ID) rows.push(e.a);
    }
    tables[t] = rows;
  }
  const journal = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => parseElements(decodeExaFile(path.join(dataDir, f))));
  return { tables, journal };
}
