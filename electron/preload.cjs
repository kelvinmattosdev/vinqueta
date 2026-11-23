const { contextBridge, ipcRenderer } = require('electron');
const call = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('vinqueta', Object.freeze({
  openAuthorGitHub: call('app:author-github'),
  checkUpdates: call('updates:check'),
  acknowledgeChangelog: call('updates:acknowledge'),
  openUpdate: call('updates:open'),
  installUpdate: call('updates:install'),
  status: call('app:status'), login: call('api:login'), logout: call('api:logout'),
  autoLogin: call('api:auto-login'),
  importConfig: call('app:import-config'),
  resetWarnings: call('app:reset-warnings'),
  onConfirmation: callback => {
    const listener = (_event, input) => callback(input);
    ipcRenderer.on('app:confirmation', listener);
    return () => ipcRenderer.removeListener('app:confirmation', listener);
  },
  respondConfirmation: input => ipcRenderer.send('app:confirmation-response', input),
  orders: call('api:orders'), items: call('api:items'), generate: call('api:generate'),
  history: call('jobs:list'), preview: call('jobs:preview'),
  generatePrices: call('price:generate'),
  renderPricePreview: call('price:preview'),
  importIntegration: call('integration:import'),
  portalOrders: call('portal:orders'), portalDownload: call('portal:download'),
  exportJob: call('jobs:export'), printers: call('print:list'), print: call('print:job'),
}));
