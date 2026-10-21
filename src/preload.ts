/** Мост между интерфейсом и главным процессом: window.hotelmanager (см. apps/ui/src/lib/platform.ts). */
import { contextBridge, ipcRenderer } from 'electron';

const focusListeners: (() => void)[] = [];
ipcRenderer.on('hotelmanager:focus', () => focusListeners.forEach((cb) => cb()));

contextBridge.exposeInMainWorld('hotelmanager', {
  version: process.env.npm_package_version ?? '',
  secureGet: (key: string) => ipcRenderer.invoke('secure:get', key),
  secureSet: (key: string, value: string) => ipcRenderer.invoke('secure:set', key, value),
  secureRemove: (key: string) => ipcRenderer.invoke('secure:remove', key),
  defaultServer: () => ipcRenderer.invoke('server:default'),
  trustServer: (url:string,fingerprint:string) => ipcRenderer.invoke('server:trust',url,fingerprint),
  certificatePin: (url:string) => ipcRenderer.invoke('server:pin',url),
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
  schedule: (items: unknown[]) => ipcRenderer.invoke('schedule', items),
  printHtml: (html: string, _title: string) => ipcRenderer.invoke('print:html', html),
  savePdf: (html: string, fileName: string) => ipcRenderer.invoke('print:pdf', html, fileName),
  saveFile: (fileName: string, base64: string) => ipcRenderer.invoke('file:save', fileName, base64),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
  exaFind: () => ipcRenderer.invoke('exa:find'),
  exaPick: () => ipcRenderer.invoke('exa:pick'),
  exaRead: (dir: string) => ipcRenderer.invoke('exa:read', dir),
  downloadAndInstall: (url: string, token: string, fileName: string) => ipcRenderer.invoke('update:install', url, token, fileName),
  onFocus: (cb: () => void) => focusListeners.push(cb),
  setTrayTooltip: (text: string) => void ipcRenderer.invoke('tray:tooltip', text),
  windowsHelloAvailable: () => ipcRenderer.invoke('hello:available'),
  windowsHelloVerify: (_reason: string) => ipcRenderer.invoke('hello:verify'),
});
