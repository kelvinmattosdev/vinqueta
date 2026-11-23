const { ipcRenderer } = require('electron');
const phases = {
  download: 'Baixando a nova versão…',
  verify: 'Verificando o pacote…',
  install: 'Instalando a atualização…',
  restart: 'Reabrindo o Vinqueta…',
};
ipcRenderer.on('update-window:progress', (_event, phase, percent) => {
  document.getElementById('phase').textContent = phases[phase];
  document.getElementById('percent').textContent = `${percent}%`;
  document.getElementById('progress').value = percent;
});
