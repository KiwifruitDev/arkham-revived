// arkham-wbid-local-server
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev
// Helper functions

// Imports
import crypto from "crypto";
import chalk from "chalk";
import { Config } from "./config.js";

// Load config (yucky: two instances of config)
const config = new Config();

// Helper functions
function HtmlDate(addDate = null) {
    // Fri, 16 Jun 2023 19:23:21 GMT
    const date = new Date();
    if(addDate) {
        date.setDate(date.getDate() + addDate);
    }
    return date.toUTCString();
}

function HtmlEtag(body) {
    const hash = crypto.createHash("sha1");
    hash.update(body);
    return hash.digest("hex");
}

// Convert color strings to chalk colors
function Color(color, bg = false) {
    switch(color) {
        case "black":
            return bg ? chalk.bgBlack : chalk.black;
        case "red":
            return bg ? chalk.bgRed : chalk.red;
        case "green":
            return bg ? chalk.bgGreen : chalk.green;
        case "yellow":
            return bg ? chalk.bgYellow : chalk.yellow;
        case "blue":
            return bg ? chalk.bgBlue : chalk.blue;
        case "magenta":
            return bg ? chalk.bgMagenta : chalk.magenta;
        case "cyan":
            return bg ? chalk.bgCyan : chalk.cyan;
        case "white":
            return bg ? chalk.bgWhite : chalk.white;
        case "blackbright":
        case "gray":
        case "grey":
            return bg ? chalk.bgBlackBright : chalk.blackBright;
        case "redbright":
            return bg ? chalk.bgRedBright : chalk.redBright;
        case "greenbright":
            return bg ? chalk.bgGreenBright : chalk.greenBright;
        case "yellowbright":
            return bg ? chalk.bgYellowBright : chalk.yellowBright;
        case "bluebright":
            return bg ? chalk.bgBlueBright : chalk.blueBright;
        case "magentabright":
            return bg ? chalk.bgMagentaBright : chalk.magentaBright;
        case "cyanbright":
            return bg ? chalk.bgCyanBright : chalk.cyanBright;
        case "whitebright":
            return bg ? chalk.bgWhiteBright : chalk.whiteBright;
        default:
            return bg ? chalk.bgBlack : chalk.white;
    }
}

// Log function
function Log(port, message) {
    // Get identity by port
    let appconfig = null;
    for(let i = 0; i < config.apps.length; i++) {
        if(config.apps[i].port === port) {
            appconfig = config.apps[i];
            break;
        }
    }
    if (!appconfig) {
        console.log(message);
        return;
    }
    // Get identity
    let monospaceIdentity = appconfig.identity.toUpperCase();
    // Pad identity with spaces
    while(monospaceIdentity.length < appconfig.appnamelength) {
        monospaceIdentity += " ";
    }
    // Log to console with chalk colors
    const finishedMessage = `${monospaceIdentity} : ${message}`;
    // Is logging enabled?
    if(appconfig.log.enabled) {
        // Get color
        const fgcolor = Color(appconfig.log.fgcolor.toLowerCase());
        const bgcolor = Color(appconfig.log.bgcolor.toLowerCase(), true);
        console.log(`${fgcolor(bgcolor(finishedMessage))}`);
    }
    // Is saving logs enabled?
    if(appconfig.log.save) {
        // Get date
        const date = new Date();
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        // Get log path
        const logpath = `${appconfig.log.savepath}${appconfig.identity.toLowerCase()}-${year}-${month}-${day}.log`;
        // Create log path if it doesn't exist
        if(!fs.existsSync(appconfig.log.savepath)) {
            fs.mkdirSync(appconfig.log.savepath);
        }
        // Create log file if it doesn't exist
        if(!fs.existsSync(logpath)) {
            fs.writeFileSync(logpath, "");
        }
        // Append to log file
        fs.appendFileSync(logpath, `${finishedMessage}\n`);
    }
}

// ESM exports
export { HtmlDate, HtmlEtag, Log, Color };
