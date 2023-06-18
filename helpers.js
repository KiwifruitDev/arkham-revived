// arkham-wbid-local-server
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev
// Helper functions

// Imports
import fs from "fs";


// Log function
function Log(port, message) {
    // Log to console
    const finishedMessage = `${port} : ${message}`;
    console.log(finishedMessage);
    // Get date
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    // Get log path
    const rootpath = "./logs/";
    const logpath = `${rootpath}${port}-${year}-${month}-${day}.log`;
    // Create log path if it doesn't exist
    if(!fs.existsSync(rootpath)) {
        fs.mkdirSync(rootpath);
    }
    // Create log file if it doesn't exist
    if(!fs.existsSync(logpath)) {
        fs.writeFileSync(logpath, "");
    }
    // Append to log file
    fs.appendFileSync(logpath, `${finishedMessage}\n`);
}

// Log req/res function
function LogServer(port, reqres) {
    // Is request or response?
    const isRequest = reqres.hasOwnProperty("method");
    // Log to console
    Log(port, `${isRequest ? (reqres.method + " ") : (reqres.statusMessage ? (reqres.statusMessage + " ") : "")}${isRequest ? reqres.url : reqres.statusCode}`);
}

// ESM exports
export { Log, LogServer };
