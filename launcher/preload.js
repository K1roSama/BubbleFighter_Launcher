const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  settings: () => ipcRenderer.invoke('settings:read'),
  save: values => ipcRenderer.invoke('settings:save', values),
  authenticate: values => ipcRenderer.invoke('account:authenticate', values),
  logout: () => ipcRenderer.invoke('account:logout'),
  launch: () => ipcRenderer.invoke('game:launch'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  setBackground: color => ipcRenderer.invoke('window:setBackground', {color}),
  selectClientExecutable: () => ipcRenderer.invoke('client:selectExecutable'),
  clientStatus: values => ipcRenderer.invoke('client:status', values),
  onGameState: callback => {
    const listener = (_event, state) => callback(Boolean(state && state.running));
    ipcRenderer.on('game:state', listener);
    return () => ipcRenderer.removeListener('game:state', listener);
  }
});
