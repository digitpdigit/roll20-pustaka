import { BrowserAPI, LibraryAPI } from './preload';

declare global {
    interface Window {
        browserAPI: BrowserAPI
        libraryAPI: LibraryAPI
    }
}