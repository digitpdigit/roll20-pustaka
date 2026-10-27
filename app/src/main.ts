import { app, BrowserWindow, session, WebContentsView, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import roll20Script from './inject/roll20CharSheet.js?raw';

if (started) {
    app.quit();
}

const isDev: boolean = !app.isPackaged;
let browserChildView: WebContentsView | undefined = undefined;
let mainWindow: BrowserWindow | undefined = undefined;

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1000,
        minHeight: 650,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    browserChildView = new WebContentsView();

    browserChildView.webContents.on('dom-ready', async () => {
        if (browserChildView) {
            const currentUrl = browserChildView.webContents.getURL();

            if (currentUrl.includes('https://app.roll20.net/characters/sheet/')) {
                browserChildView.webContents.executeJavaScript(roll20Script)
                    .then((result) => console.log('Script injection complete.'))
                    .catch((err) => console.error('Failed to inject script:', err));

                const wc = browserChildView.webContents;
                const dbg = wc.debugger;
                let wsText: string = '';

                try {
                    dbg.attach('1.3');
                } catch (err) {
                    console.error('Debugger attach failed: ', err);
                }

                dbg.sendCommand('Network.enable');

                dbg.on('message', async (event, method, params) => {
                    switch (method) {
                        case 'Network.webSocketCreated': {
                            break;
                        }

                        case 'Network.webSocketFrameSent': {
                            break;
                        }

                        case 'Network.webSocketClosed': {
                            break;
                        }

                        case 'Network.webSocketFrameReceived': {
                            const payload = params.response.payloadData;
                            wsText += payload;
                            try {
                                const parsedPayload = JSON.parse(wsText);
                                
                                //------------- PARSE DATA FOR ROLL20 WS -------------
                                try {
                                    if (parsedPayload.d.b.d) {
                                        console.log(JSON.stringify(parsedPayload.d.b.d, null, 2));
                                    }                                    
                                } catch (_) {}

                                wsText = '';
                            } catch (_) {
                                
                            }
                            break;
                        }

                        case 'Network.responseReceived': {
                            const { requestId, response } = params;
                            const url = response.url;
                            const mimeType = response.mimeType;

                            if (url.includes('https://dice.roll20.net/doroll')) {
                                if (mimeType.includes('json') || mimeType.includes('text') || url.includes('/api/')) {
                                    try {
                                        const bodyData = await dbg.sendCommand('Network.getResponseBody', { requestId });
                                        let bodyString: string = '';

                                        if (bodyData.base64Encoded) {
                                            bodyString = Buffer.from(bodyData.body, 'base64').toString('utf8');
                                        } else {
                                            bodyString = bodyData.body;
                                        }

                                        try {
                                            const parsedPayload = JSON.parse(bodyString);
                                            
                                            //------------- PARSE DATA FOR ROLL20 ROLLER -------------
                                            const data = JSON.parse(parsedPayload[Object.keys(parsedPayload)[0]].json);
                                            for (const roll of data.rolls) {
                                                console.log(roll.results.map((e: any) => e.v as number).join(' ')); //ROLL RESULT NOT INCLUDING MODIFIERS
                                            }                                            
                                        } catch (_) {}
                                    } catch (_) {}
                                }
                            }
                        }
                    }
                });

                wc.on('destroyed', () => {
                    if (dbg.isAttached()) {
                        dbg.detach();
                    }
                    wc.close();
                });
            }            
        }        
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(
            path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
        );
    }

    if (isDev) {
        mainWindow.webContents.openDevTools();
    } 
};

app.on('ready', () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const styleSrc = isDev ? "'self' 'unsafe-inline'" : "'self'";
        const scriptSrc = isDev ? "'self' 'unsafe-eval'" : "'self'";

        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    `default-src 'self'; 
                    script-src ${scriptSrc};
                    style-src ${styleSrc};
                    object-src 'none';
                    connect-src 'self' https://3mworkshop.org`
                ]
            }
        });
    });

    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

let setBoundsDebouncer: NodeJS.Timeout | undefined;
const setBounds = () => {
    if ((mainWindow) && (browserChildView)) {
        clearTimeout(setBoundsDebouncer);
        const [width, height] = mainWindow.getContentSize();

        setBoundsDebouncer = setTimeout(() => {            
            browserChildView?.setBounds({ x: 0, y: 60, width: width, height: height - 60 });
        }, 50);
    }
};

ipcMain.on('load-browser-child', (_, show: boolean, urlStart: string) => {
    if ((mainWindow) && (browserChildView)) {
        if (show) {
            if (!mainWindow.contentView.children.includes(browserChildView)) {
                mainWindow.contentView.addChildView(browserChildView);
                browserChildView.webContents.openDevTools();
                setBounds();
                
                let setBoundDebouncer;
                mainWindow.on('resize', setBounds);
                browserChildView.webContents.loadURL(urlStart);
            }
        } else if (mainWindow.contentView.children.includes(browserChildView)) {
            mainWindow.contentView.removeChildView(browserChildView);
            browserChildView.webContents.loadURL('about:blank');
        }
    }    
})