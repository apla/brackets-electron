#!/usr/bin/env electron

import { app, BrowserWindow, ipcMain } from "electron";
import * as _ from "lodash";
import * as logger from "./logger";
import * as path from "path";
import * as utils from "./utils";
import * as shellConfig from "./shell-config";
import * as shellState from "./shell-state";
import * as SocketServer from "./socket-server"; // Implementation of Brackets' shell server

const appInfo = require("./package.json");

const log = logger.get("ipc-log");
ipcMain.on("log", function (event, ...args) {
    log.info(...args);
});

// Report crashes to electron server
// TODO: doesn't work
// electron.crashReporter.start();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the javascript object is GCed.
const wins: Electron.BrowserWindow[] = [];

// fetch window position values from the window and save them to config file
function _saveWindowPosition(sync: boolean, win: Electron.BrowserWindow) {
    const size = win.getSize();
    const pos = win.getPosition();
    shellConfig.set("window.posX", pos[0]);
    shellConfig.set("window.posY", pos[1]);
    shellConfig.set("window.width", size[0]);
    shellConfig.set("window.height", size[1]);
    shellConfig.set("window.maximized", win.isMaximized());
    if (sync) {
        shellConfig.saveSync();
    } else {
        shellConfig.save();
    }
}
const saveWindowPositionSync = _.partial(_saveWindowPosition, true);
const saveWindowPosition = _.debounce(_.partial(_saveWindowPosition, false), 100);

// Quit when all windows are closed.
app.on("window-all-closed", function () {
    app.quit();
});

// Start the socket server used by Brackets'
const socketServerLog = logger.get("socket-server");
SocketServer.start(function (err: Error, port: number) {
    if (err) {
        shellState.set("socketServer.state", "ERR_NODE_FAILED");
        socketServerLog.error("failed to start: " + utils.errToString(err));
    } else {
        shellState.set("socketServer.state", "NO_ERROR");
        shellState.set("socketServer.port", port);
        socketServerLog.info("started on port " + port);
    }
});

export function openBracketsWindow(query: {} | string = {}) {

    // compose path to brackets' index file
    const indexPath = "file://" + path.resolve(__dirname, "www", "index.html");

    // build a query for brackets' window
    let queryString = "";
    if (_.isObject(query) && !_.isEmpty(query)) {
        const queryObj = query as _.Dictionary<string>;
        queryString = "?" + _.map(queryObj, function (value, key) {
            return key + "=" + encodeURIComponent(value);
        }).join("&");
    } else if (_.isString(query)) {
        const queryStr = query as string;
        const io1 = queryStr.indexOf("?");
        const io2 = queryStr.indexOf("#");
        if (io1 !== -1) {
            queryString = queryStr.substring(io1);
        } else if (io2 !== -1) {
            queryString = queryStr.substring(io2);
        } else {
            queryString = "";
        }
    }

    const indexUrl = indexPath + queryString;

    const winOptions = {
        title: appInfo.productName,
        icon: path.resolve(__dirname, "res", "appicon.png"),
        x: shellConfig.getNumber("window.posX"),
        y: shellConfig.getNumber("window.posY"),
        width: shellConfig.getNumber("window.width"),
        height: shellConfig.getNumber("window.height"),
        webPreferences: {
            nodeIntegration: false,
            preload: path.resolve(__dirname, "preload.js")
        }
    };

    // create the browser window
    const win = new BrowserWindow(winOptions);
    wins.push(win);

    // load the index.html of the app
    win.loadURL(indexUrl);
    if (shellConfig.get("window.maximized")) {
        win.maximize();
    }

    // emitted when the window is closed
    win.on("closed", function () {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        const io = wins.indexOf(win);
        if (io !== -1) { wins.splice(io, 1); }
    });

    // this is used to remember the size from the last time
    // emitted before the window is closed
    win.on("close", function () {
        saveWindowPositionSync(win);
    });
    win.on("maximize", function () {
        saveWindowPosition(win);
    });
    win.on("unmaximize", function () {
        saveWindowPosition(win);
    });
    win.on("resize", function () {
        saveWindowPosition(win);
    });
    win.on("move", function () {
        saveWindowPosition(win);
    });

    return win;
}

// This method will be called when Electron has done everything
// initialization and ready for creating browser windows.
app.on("ready", function () {
    openBracketsWindow();
});

export function getMainWindow() {
    return wins[0];
};

export function restart(query: {} | string) {
    while (wins.length > 0) {
        const win = wins.shift();
        if (win) { win.close(); }
    }
    openBracketsWindow(query);
};
