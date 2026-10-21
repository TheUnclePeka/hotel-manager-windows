/**
 * HotelManager для Windows (Electron).
 * Интерфейс — та же сборка React, что и в Android-приложении (apps/ui).
 * Главный процесс отвечает за то, чего нет в браузере: защищённое хранение ключей,
 * проверку сертификата сервера, печать, файлы, уведомления, трей и чтение базы ExaHotel.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, safeStorage, session, shell, Tray } from 'electron';
import { findExaDatabase, readExaDatabase } from './exa-reader';
import { verifyPinnedCertificate } from './server-trust';

// Keep the existing encrypted profile after the display-name change.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'HotelManager'));

const isDev = Boolean(process.env.HOTEL_MANAGER_DEV_URL);
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// ─── Ресурсы установки ──────────────────────────────────────────────────────

function resource(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, '..', 'resources', name);
}

function readServerConfig(): { url?: string } { return {}; }

function pinKey(address:string):string {
  const url=new URL(address);
  if(url.protocol!=='https:'||url.username||url.password) throw new Error('Нужен HTTPS-адрес');
  return `certificate.${url.hostname}`;
}
function setupCertificatePinning() {
  session.defaultSession.setCertificateVerifyProc((request,callback)=>{
    try {
      const expected=readSecure()[`certificate.${request.hostname}`];
      if(!expected) {callback(-3);return;} // System CA validation for public certificates.
      callback(verifyPinnedCertificate(request.certificate.data,request.hostname,expected)?0:-2);
    } catch {callback(-2);}
  });
}

// ─── Защищённое хранилище (Windows DPAPI через safeStorage) ─────────────────

const securePath = () => path.join(app.getPath('userData'), 'secure.json');

function readSecure(): Record<string, string> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище Windows недоступно');
  if (!fs.existsSync(securePath())) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(securePath(), 'utf8')) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) out[k] = safeStorage.decryptString(Buffer.from(v, 'base64'));
    return out;
  } catch {
    throw new Error('Не удалось прочитать защищённое хранилище. Сохраните профиль перед восстановлением.');
  }
}

function writeSecure(data: Record<string, string>) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище Windows недоступно');
  const enc: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) enc[k] = safeStorage.encryptString(v).toString('base64');
  const tmp=securePath()+'.tmp';
  fs.writeFileSync(tmp, JSON.stringify(enc), { mode: 0o600,flush:true });
  fs.renameSync(tmp,securePath());
}

// ─── Окно и трей ────────────────────────────────────────────────────────────

function iconPath() {
  return resource(process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Hotel Manager',
    icon: iconPath(),
    backgroundColor: '#0d1b22',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win?.show());

  // Диагностика (только при заданных переменных окружения): консоль интерфейса и снимок окна.
  if (process.env.HOTEL_MANAGER_DEBUG) {
    win.webContents.on('console-message', (e) => console.log(`[ui:${e.level}] ${e.message}`));
  }
  const shot = process.env.HOTEL_MANAGER_SCREENSHOT;
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        fs.writeFileSync(shot, img.toPNG());
        quitting = true;
        app.quit();
      }, Number(process.env.HOTEL_MANAGER_SCREENSHOT_DELAY ?? 5000));
    });
  }
  if (isDev) void win.loadURL(process.env.HOTEL_MANAGER_DEV_URL!);
  else void win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  // Внешние ссылки (WhatsApp, Telegram) — в системном браузере или приложении.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel|sms|tg|whatsapp):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate',(event)=>event.preventDefault());
  win.on('focus', () => win?.webContents.send('hotelmanager:focus'));
  // Закрытие окна сворачивает программу в трей: уведомления продолжают приходить.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function showWindow() {
  if (!win) createWindow();
  win!.show();
  win!.focus();
}

function createTray() {
  // tray.png + tray@1.5x.png + tray@2x.png — Electron подбирает размер под масштаб экрана.
  const icon = nativeImage.createFromPath(resource('tray.png'));
  if (icon.isEmpty()) console.error('Не найден значок трея', resource('tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Hotel Manager');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть «Hotel Manager»', click: showWindow },
      { type: 'separator' },
      {
        label: 'Выйти',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showWindow);
}

// ─── Уведомления ────────────────────────────────────────────────────────────

interface Scheduled {
  id: number;
  at: string;
  title: string;
  body: string;
}
const timers = new Map<number, NodeJS.Timeout>();
const shown = new Set<number>();

function notify(title: string, body: string) {
  const n = new Notification({ title, body, icon: iconPath() });
  n.on('click', showWindow);
  n.show();
}

function schedule(items: Scheduled[]) {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const now = Date.now();
  for (const it of items) {
    const delay = new Date(it.at).getTime() - now;
    // Таймеры ставятся на ближайшие сутки; список обновляется интерфейсом при любом изменении данных.
    if (delay <= 0 || delay > 24 * 3600_000 || shown.has(it.id)) continue;
    timers.set(
      it.id,
      setTimeout(() => {
        shown.add(it.id);
        notify(it.title, it.body);
      }, delay),
    );
  }
}

// ─── Печать и файлы ─────────────────────────────────────────────────────────

async function htmlWindow(html: string): Promise<BrowserWindow> {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  const file = path.join(os.tmpdir(), `hotelmanager-${crypto.randomUUID()}.html`);
  fs.writeFileSync(file, html, 'utf8');
  await w.loadFile(file);
  setTimeout(() => fs.rm(file, { force: true }, () => {}), 60_000);
  return w;
}

async function printHtml(html: string) {
  const w = await htmlWindow(html);
  await new Promise<void>((resolve) => {
    w.webContents.print({ silent: false, printBackground: true }, () => resolve());
  });
  w.destroy();
}

async function savePdf(html: string, fileName: string): Promise<boolean> {
  const res = await dialog.showSaveDialog(win!, {
    defaultPath: path.join(app.getPath('documents'), fileName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return false;
  const w = await htmlWindow(html);
  const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
  w.destroy();
  fs.writeFileSync(res.filePath, pdf);
  void shell.openPath(res.filePath);
  return true;
}

async function saveFile(fileName: string, base64: string): Promise<boolean> {
  const ext = path.extname(fileName).slice(1);
  const res = await dialog.showSaveDialog(win!, {
    defaultPath: path.join(app.getPath('documents'), fileName),
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'));
  void shell.openPath(res.filePath);
  return true;
}

// ─── Обновление ─────────────────────────────────────────────────────────────

// ─── IPC ────────────────────────────────────────────────────────────────────

function registerIpc() {
  ipcMain.handle('secure:get', (_e, key: string) => readSecure()[key] ?? null);
  ipcMain.handle('secure:set', (_e, key: string, value: string) => writeSecure({ ...readSecure(), [key]: value }));
  ipcMain.handle('secure:remove', (_e, key: string) => {
    const d = readSecure();
    delete d[key];
    writeSecure(d);
  });
  ipcMain.handle('server:default', () => readServerConfig().url ?? null);
  ipcMain.handle('server:pin', (_e,url:string) => readSecure()[pinKey(url)]??null);
  ipcMain.handle('server:trust', (_e,url:string,fingerprint:string) => {
    if(!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error('Некорректный отпечаток сертификата');
    writeSecure({...readSecure(),[pinKey(url)]:fingerprint.toLowerCase()});
    setupCertificatePinning();
  });
  ipcMain.handle('notify', (_e, title: string, body: string) => notify(title, body));
  ipcMain.handle('schedule', (_e, items: Scheduled[]) => schedule(items));
  ipcMain.handle('print:html', (_e, html: string) => printHtml(html));
  ipcMain.handle('print:pdf', (_e, html: string, fileName: string) => savePdf(html, fileName));
  ipcMain.handle('file:save', (_e, fileName: string, base64: string) => saveFile(fileName, base64));
  ipcMain.handle('open:external', (_e, url: string) => {
    if (/^(https?|mailto|tel|sms|tg|whatsapp):/i.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle('exa:find', () => findExaDatabase());
  ipcMain.handle('exa:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Папка Data базы ExaHotelFree', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    if (fs.existsSync(path.join(dir, 'Orders.dat'))) return dir;
    if (fs.existsSync(path.join(dir, 'Data', 'Orders.dat'))) return path.join(dir, 'Data');
    void dialog.showMessageBox(win!, { type: 'warning', message: 'В выбранной папке нет файлов базы ExaHotelFree (Orders.dat).' });
    return null;
  });
  ipcMain.handle('exa:read', (_e, dir: string) => readExaDatabase(dir));
  ipcMain.handle('update:install', () => { throw new Error('Подписанные обновления пока недоступны'); });
  ipcMain.handle('tray:tooltip', (_e, text: string) => tray?.setToolTip(text));
  ipcMain.handle('hello:available', () => false);
  ipcMain.handle('hello:verify', () => false);
}

// ─── Запуск ─────────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.setAppUserModelId('org.hotelmanager.desktop');
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    setupCertificatePinning();
    registerIpc();
    createWindow();
    createTray();
  });
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => {
    /* программа остаётся в трее */
  });
}
