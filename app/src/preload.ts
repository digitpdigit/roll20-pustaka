import { contextBridge, ipcRenderer } from 'electron';
import type { CreateItemInput, LibraryItem, UpdateItemFields } from './library/types';

const browserAPI = {
    loadBrowserChild: (show: boolean, url: string) => ipcRenderer.send('load-browser-child', show, url),
};

const libraryAPI = {
    list: (): Promise<LibraryItem[]> => ipcRenderer.invoke('library:list'),
    putAudio: ({
        bytes,
        originalName,
    }: {
        bytes: Uint8Array;
        originalName: string;
    }): Promise<{ fileHash: string }> => ipcRenderer.invoke('library:putAudio', { bytes, originalName }),
    readAudio: ({ fileHash }: { fileHash: string }): Promise<Uint8Array> =>
        ipcRenderer.invoke('library:readAudio', { fileHash }),
    create: (item: CreateItemInput): Promise<LibraryItem> => ipcRenderer.invoke('library:create', item),
    update: ({
        id,
        fields,
    }: {
        id: string;
        fields: UpdateItemFields;
    }): Promise<LibraryItem> => ipcRenderer.invoke('library:update', { id, fields }),
    rename: ({ id, name }: { id: string; name: string }): Promise<LibraryItem> =>
        ipcRenderer.invoke('library:rename', { id, name }),
    delete: ({ id }: { id: string }): Promise<{ ok: true }> => ipcRenderer.invoke('library:delete', { id }),
};

contextBridge.exposeInMainWorld('browserAPI', browserAPI);
contextBridge.exposeInMainWorld('libraryAPI', libraryAPI);

export type BrowserAPI = typeof browserAPI;
export type LibraryAPI = typeof libraryAPI;
