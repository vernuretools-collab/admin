const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  openGallery: () => ipcRenderer.invoke('desktop:openGallery'),
  listScreenshots: (filters) => ipcRenderer.invoke('desktop:listScreenshots', filters),
  listEmployees: () => ipcRenderer.invoke('desktop:listEmployees'),
  signedUrl: (storagePath) => ipcRenderer.invoke('desktop:signedUrl', storagePath),
  adminLogin: (credentials) => ipcRenderer.invoke('desktop:adminLogin', credentials),
})
