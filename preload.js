'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  getOpacity: () => ipcRenderer.invoke('opacity:get'),
  setOpacity: (v) => ipcRenderer.invoke('opacity:set', v),
  nudgeOpacity: (d) => ipcRenderer.invoke('opacity:nudge', d),
  setClickThrough: (v) => ipcRenderer.invoke('clickthrough:set', v),
  toggleClickThrough: () => ipcRenderer.invoke('clickthrough:toggle'),
  getClickThrough: () => ipcRenderer.invoke('clickthrough:get'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('alwaysontop:toggle'),
  getAlwaysOnTop: () => ipcRenderer.invoke('alwaysontop:get'),
  setAspectLock: (v) => ipcRenderer.invoke('aspect:set', v),
  saveVideo: (url) => ipcRenderer.invoke('state:saveVideo', url),
  gripEnter: () => ipcRenderer.invoke('grip:enter'),
  gripLeave: () => ipcRenderer.invoke('grip:leave'),
  beginWindowMove: () => ipcRenderer.invoke('window:beginMove'),
  endWindowMove: () => ipcRenderer.invoke('window:endMove'),
  onInit: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('state:init', handler);
    return () => ipcRenderer.removeListener('state:init', handler);
  },
  onOpacityChanged: (cb) => {
    const handler = (_e, v) => cb(v);
    ipcRenderer.on('opacity:changed', handler);
    return () => ipcRenderer.removeListener('opacity:changed', handler);
  },
  onClickThroughChanged: (cb) => {
    const handler = (_e, v) => cb(v);
    ipcRenderer.on('clickthrough:changed', handler);
    return () => ipcRenderer.removeListener('clickthrough:changed', handler);
  },
  onAlwaysOnTopChanged: (cb) => {
    const handler = (_e, v) => cb(v);
    ipcRenderer.on('alwaysontop:changed', handler);
    return () => ipcRenderer.removeListener('alwaysontop:changed', handler);
  },
});
