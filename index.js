// arkham-wbid-local-server
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev

// Imports
import { Config } from "./config.js";
import express from "express";
import fs from "fs";
import crypto, { createPrivateKey, randomUUID } from "crypto";
import { Log, LogServer } from "./helpers.js";
import Database from "better-sqlite3";
import getUuid from "uuid-by-string";
import dotenv from "dotenv";
import path from "path";
import SteamAuth from "node-steam-openid";
import https from "https";

// __dirname
const __dirname = path.resolve();

// Load .env uuid key
dotenv.config();
const uuidkey = process.env.ARKHAM_UUID_KEY;

// Load config
const config = new Config();

// Load motd.json (create if it doesn't exist)
if(!fs.existsSync("./motdcustom.json")) {
    // Base motd.json
    const motd = fs.existsSync("./motd.json") ? JSON.parse(fs.readFileSync("./motd.json")) : [
        {
            "published_at": new Date().toUTCString(),
            "_id": crypto.randomUUID(),
            "contents": null,
            "title": "Welcome to your very own custom Arkham Origins Online server!",
        },
        {
            "published_at": new Date().toUTCString(),
            "_id": crypto.randomUUID(),
            "contents": null,
            "title": "Edit these messages in motd.json to customize your server!",
        },
        {
            "published_at": new Date().toUTCString(),
            "_id": crypto.randomUUID(),
            "contents": null,
            "title": "Up to 10 messages can be sent to the client and displayed here in the main menu.",
        },
    ];
    // Write motd.json
    fs.writeFileSync("./motdcustom.json", JSON.stringify(motd, null, 4));
}
const motd = JSON.parse(fs.readFileSync("./motdcustom.json"));

// Load save.json (create if it doesn't exist)
if(!fs.existsSync("./save.json")) {
    // Read defaultsave.json if it exists
    if(fs.existsSync("./defaultsave.json")) {
        // Read defaultsave.json
        const defaultsave = JSON.parse(fs.readFileSync("./defaultsave.json"));
        // Write defaultsave.json to save.json
        fs.writeFileSync("./save.json", JSON.stringify(defaultsave, null, 4));
    } else {
        // Base save.json
        const basesave = {};
        // Write save.json
        fs.writeFileSync("./save.json", JSON.stringify(basesave, null, 4));
    }
}
const save = JSON.parse(fs.readFileSync("./save.json"));

// Database
const dbconfig = config.database;
const db = new Database(dbconfig.path, { verbose: dbconfig.debug ? console.log : null });
db.pragma('journal_mode = WAL');

// Delete users table (temporary, users aren't persistent yet)
if(dbconfig.wipe_on_start)
    db.exec("DROP TABLE users");

// Create users table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS users (uuid TEXT PRIMARY KEY, ipaddr TEXT, inventory TEXT, data TEXT, steamid TEXT)");

// Steam auth
const steam = new SteamAuth({
    realm: `http://${config.web.url}:${config.web.http.port}`,
    returnUrl: `http://${config.web.url}:${config.web.http.port}/auth/landing`,
    apiKey: process.env.STEAM_API_KEY
});

// Steam deletion
const steamdelete = new SteamAuth({
    realm: `http://${config.web.url}:${config.web.http.port}`,
    returnUrl: `http://${config.web.url}:${config.web.http.port}/auth/delete`,
    apiKey: process.env.STEAM_API_KEY
});

function recursiveweb(file) {
    // Get file stats
    const stats = fs.statSync(`./baseweb/${file}`);
    // If file is a directory
    if(stats.isDirectory()) {
        // Create directory
        fs.mkdirSync(`./web/${file}`);
        // Get directory contents
        const contents = fs.readdirSync(`./baseweb/${file}`);
        // Iterate through directory contents
        contents.forEach((content) => {
            // Recurse
            recursiveweb(`${file}/${content}`);
        });
    } else {
        // Copy to /web
        fs.copyFileSync(`./baseweb/${file}`, `./web/${file}`);
    }
}

// Copy baseweb folder to web
if(!fs.existsSync("./web")) {
    if(fs.existsSync("./baseweb")) {
        // Create web folder
        fs.mkdirSync("./web");
        // Copy baseweb folder to web
        const baseweb = fs.readdirSync("./baseweb");
        baseweb.forEach((file) => {
            recursiveweb(file);
        });
    }
}

// Create BASE app
const app = express();
const appconfig = config.app;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log requests
if(appconfig.debug) {
    app.use((req, res, next) => {
        // Log request
        LogServer(res.socket.localPort, req);
        // Next
        next();
    });
}

// Endpoint: /files/*.*
// Files are base64 encoded within a json object.
app.get("/files/*.*", function(req, res) {
    // Get file name
    const file = req.params[0];
    // Get file extension
    const ext = req.params[1];
    // Read file
    const data = fs.readFileSync(`${appconfig.public}${file}.${ext}`);
    // Encode file
    const encoded = data.toString("base64");
    // Build JSON response
    const response = {
        "data": encoded,
    };
    // Send response
    res.json(response);
});

// Endpoint: /auth/token
// Returns a UUID specific to the user's ticket (Steam, presumably)
app.post("/auth/token", function(req, res) {
    const redirect = false;
    // If redirect is true, we'll redirect to https://ozzypc-wbid.live.ws.fireteam.net/auth/token
    // Untested code!!!
    if(redirect) {
        res.redirect("https://ozzypc-wbid.live.ws.fireteam.net/auth/token");
        return;
    }
    // The uuid should be based on the ticket, the private key will be used to validate it.
    const uuid = getUuid(req.body.ticket);
    const token = {
        "token_type": "bearer",
        "access_token": uuid,
        "expires_in": 1000000,
        "refresh_token": "",
    };
    // Send response
    res.json(token);
});

// Endpoint: /motd
// Used with parameters ?channels.0=all&channels.1=all_no_wbid&channels.2=multiplayer&channels.3=multiplayer_no_wbid&country=US&page=1&per_page=10
// We're not parsing all of that, so we'll return a static response.
app.get("/motd", function(req, res) {
    // Build JSON response
    const motdresponse = {
        "total_count": motd.length > 10 ? 10 : motd.length, // maximum of 10 motd entries
        "next_page": 2,
        "items": motd,
        "page": 1,
        "pages": 1
    };
    // Send response
    res.json(motdresponse);
});

// Endpoint: /store/catalog/general
// Returns an empty object
app.get("/store/catalog/general", function(req, res) {
    // Build JSON response
    const store = {
        "items": {},
    };
    // Send response
    res.json(store);
});

// Endpoint: /store/offers
// Used with parameters ?page=1&vendor=0
// No parsing, just an empty object with pagination.
app.get("/store/offers", function(req, res) {
    // Build JSON response
    const offers = {
        "total_count": 0,
        "next_page": 0,
        "items": [],
        "page": 0,
        "pages": 0,
    };
    // Send response
    res.json(offers);
});

// Endpoint: /store/vouchers/transactions
// POST by the game
app.post("/store/vouchers/transactions", function(req, res) {
    // 200 OK
    res.status(200).send();
});

// Endpoint: /store/vouchers/
// PUT by the game
app.put("/store/vouchers/", function(req, res) {
    // 200 OK
    res.status(200).send();
});

// Endpoint: /users/[uuid]/[sub1]/[sub2]
// This is where settings and other user data is stored.
// The game may also PUT to this endpoint.
// We're going to save the data to a file, maybe in the future we'll use a database.
app.get("/users/:uuid/:subpage?/:subpage2?", function(req, res) {
    const urluuid = req.url.split("/")[2]; // req.query doesn't work here
    const subpage = req.url.split("/")[3];
    const subpage2 = req.url.split("/")[4];
    // Validate authorization header
    if(!req.headers.authorization) {
        // Send error
        res.status(400).send("Invalid authorization header");
        return;
    }
    // Get authorization header
    const auth = req.headers.authorization.split(" ");
    // Verify authorization header
    if(auth[0] != "Bearer") {
        // Send error
        res.status(400).send("Invalid authorization header");
        return;
    }
    // Get UUID
    const ticket = auth[1];
    // Create UUID from ticket using uuidkey
    let uuid = getUuid(`${uuidkey}:${ticket}`);
    // Ask database if IP address has a UUID linked to it
    let ipaddr = req.socket.remoteAddress;
    if(ipaddr) {
        if(ipaddr.startsWith("::ffff:")) {
            ipaddr = ipaddr.substring(7);
        }
        const prep = db.prepare("SELECT uuid FROM users WHERE ipaddr = ?");
        const data = prep.get(ipaddr);
        if(data) {
            uuid = data.uuid;
        }
    }
    // Log UUID
    Log(res.socket.localPort, `AUTH: ${uuid} (${ipaddr})`);
    if(urluuid === "me") {
        if(!subpage) {
            // Build JSON response with UUID
            const user = {
                "user_id": uuid,
            };
            // Send response
            res.json(user);
        } else if(subpage == "inventory") {
            // Query database for inventory
            const inventoryprep = db.prepare("SELECT inventory FROM users WHERE uuid = ?");
            const inventorylist = inventoryprep.get(uuid);
            let inventoryobj = null;
            // If inventory doesn't exist, create it
            if(!inventorylist || !inventorylist.inventory) {
                // Insert inventory into existing row
                const inventoryinsert = db.prepare("UPDATE users SET inventory = ? WHERE uuid = ?");
                inventoryobj = {};
                inventoryinsert.run(Buffer.from(JSON.stringify(inventoryobj)).toString("base64"), uuid);
            } else {
                // Inventory is a JSON object in base64, decode them
                inventoryobj = JSON.parse(Buffer.from(inventorylist.inventory, "base64").toString("utf-8"));
            }
            // Build JSON response
            const inventory = {
                "inventory": inventoryobj,
            };
            // Send response
            res.json(inventory);
        }
    } else if(subpage === "profile") {
        if(subpage2 === "private") {
            // Check if UUID matches the one in the URL
            if(uuid != urluuid) {
                // Send error
                res.status(400).send("Invalid UUID");
                // Log response
                LogServer(res.socket.localPort, res);
                return;
            }
            // Pull from database
            const dataprep = db.prepare("SELECT data FROM users WHERE uuid = ?");
            const data = dataprep.get(uuid);
            // Check if data exists
            if(!data || !data.data) {
                // Insert save into existing row
                const insert = db.prepare("UPDATE users SET data = ? WHERE uuid = ?");
                insert.run(Buffer.from(JSON.stringify(save)).toString("base64"), uuid);
                // Send response
                res.json(save);
                // Log response
                LogServer(res.socket.localPort, res);
                return;
            }
            // Data is base64 encoded, decode it
            const json = JSON.parse(Buffer.from(data.data, "base64").toString("utf-8"));
            // Send response
            res.json(json);
        } else {
            // unimplemented, return empty object
            Log(res.socket.localPort, `Unimplemented endpoint: ${req.url}`);
            res.json({});
        }
    } else {
        // unimplemented, return empty object
        Log(res.socket.localPort, `Unimplemented endpoint: ${req.url}`);
        res.json({});
    }
});

app.put("/users/:uuid/:subpage?/:subpage2?", function(req, res) {
    const urluuid = req.url.split("/")[2]; // req.query doesn't work here
    const subpage = req.url.split("/")[3];
    const subpage2 = req.url.split("/")[4];
    // Validate authorization header
    if(!req.headers.authorization) {
        // Send error
        res.status(400).send("Invalid authorization header");
        return;
    }
    // Get authorization header
    const auth = req.headers.authorization.split(" ");
    // Get UUID
    const ticket = auth[1];
    // Create UUID from ticket using uuidkey
    let uuid = getUuid(`${uuidkey}:${ticket}`);
    // Ask database if IP address has a UUID linked to it
    let ipaddr = req.socket.remoteAddress;
    if(ipaddr) {
        if(ipaddr.startsWith("::ffff:")) {
            ipaddr = ipaddr.substring(7);
        }
        const prep = db.prepare("SELECT uuid FROM users WHERE ipaddr = ?");
        const data = prep.get(ipaddr);
        if(data && data.uuid) {
            uuid = data.uuid;
        }
    }
    // Check if UUID matches the one in the URL
    if(uuid != urluuid) {
        // Send error
        res.status(400).send("Invalid UUID");
        return;
    }
    if(urluuid === "me") {
        // unimplemented, print out
        Log(res.socket.localPort, `Unimplemented endpoint: ${req.url}`);
    } else if(subpage === "profile") {
        if(subpage2 === "private") {
            // Verify authorization header
            if(auth[0] != "Bearer") {
                // Send error
                res.status(400).send("Invalid authorization header");
                // Log response
                LogServer(res.socket.localPort, res);
                return;
            }
            // Data is base64 encoded, encode it
            const encoded = Buffer.from(JSON.stringify(req.body)).toString("base64");
            // Update database
            const updateprep = db.prepare("UPDATE users SET data = ? WHERE uuid = ?");
            updateprep.run(encoded, uuid);
        } else {
            // unimplemented, print out
            Log(res.socket.localPort, `Unimplemented endpoint: ${req.url}`);
        }
    } else {
        // unimplemented, print out
        Log(res.socket.localPort, `Unimplemented endpoint: ${req.url}`);
    }
    // Send response
    res.status(204).send();
});

// Endpoint: /actions/:action
// Unknown...
// 404 handler
app.use(function(req, res, next) {
    // Send error
    res.status(404).send("Not found");
});

// Log responses
if(appconfig.debug) {
    app.use((req, res, next) => {
        // Log request
        LogServer(res.socket.localPort, res);
    });
}

// Web server
const web = new express();
const webconfig = config.web;

// Log requests
if(webconfig.debug) {
    web.use((req, res, next) => {
        // Log request
        LogServer(res.socket.localPort, req);
        // Next
        next();
    });
}

// Use folder
web.use(webconfig.public, express.static(webconfig.public));

// Account creation
web.get("/auth/landing", async (req, res) => {
    try {
        const user = await steam.authenticate(req);
        const steamid = user.steamid;
        // Get existing uuid for steamid
        const prep = db.prepare("SELECT uuid FROM users WHERE steamid = ?");
        const data = prep.get(steamid);
        let ipaddr = req.socket.remoteAddress;
        if(ipaddr.startsWith("::ffff:")) {
            ipaddr = ipaddr.substring(7);
        }
        if(data && data.uuid) {
            // Replace IP address with current one
            const updateprep = db.prepare("UPDATE users SET ipaddr = ? WHERE uuid = ?");
            updateprep.run(ipaddr, data.uuid);
            Log(res.socket.localPort, `USER: ${user.steamid} - IP: ${ipaddr}`);
        } else {
            // Store user's steamid with a new uuid
            const uuid = crypto.randomUUID();
            const insert = db.prepare("INSERT INTO users (uuid, steamid, ipaddr) VALUES (?, ?, ?)");
            insert.run(uuid, steamid, ipaddr);
            Log(res.socket.localPort, `USER: ${user.steamid} - UUID: ${uuid} - IP: ${ipaddr}`);
        }
        res.redirect(`/landing.html?avatar=${user.avatar.large}&persona=${user.username}&steamid=${user.steamid}`);
    } catch (error) {
        console.error(error);
        const message = "Steam authentication failed.";
        res.redirect(`/error.html?error=${message}&realerror=${error}`);
    }
});

// Account deletion
web.get("/auth/delete", async (req, res) => {
    let message;
    try {
        const user = await steamdelete.authenticate(req);
        const steamid = user.steamid;
        // Get existing uuid for steamid
        const prep = db.prepare("SELECT uuid FROM users WHERE steamid = ?");
        const data = prep.get(steamid);
        if(data && data.uuid) {
            // Delete user
            const deleteprep = db.prepare("DELETE FROM users WHERE uuid = ?");
            deleteprep.run(data.uuid);
            Log(res.socket.localPort, `USER: ${user.steamid} - DELETED`);
            res.redirect(`/deleted.html?avatar=${user.avatar.large}`);
        } else {
            // User doesn't exist
            Log(res.socket.localPort, `USER: ${user.steamid} - NOT FOUND`);
            message = "User not found.";
            res.redirect(`/error.html?error=${message}`);
        }
    } catch (error) {
        console.error(error);
        message = "Steam authentication failed.";
        res.redirect(`/error.html?error=${message}&realerror=${error}`);
    }
});

// Steam OpenID
web.get("/auth", async (req, res) => {
    const redirectUrl = await steam.getRedirectUrl();
    return res.redirect(redirectUrl);
});

// Request deletion
web.get("/delete", async (req, res) => {
    let redirectUrl = await steamdelete.getRedirectUrl();
    return res.redirect(redirectUrl);
});

// Path handler
web.get(/^(.+)$/, function(req, res) {
    // Root: /index.html
    if(req.params[0] === "/")
        req.params[0] = "/index.html";
    // Send response
    const url = path.join(__dirname, webconfig.public, req.params[0]);
    if(fs.existsSync(url)) {
        res.sendFile(url);
    } else {
        // 404.html
        res.status(404).sendFile(path.join(__dirname, webconfig.public, "404.html"));
    }
});

// Log responses
if(webconfig.debug) {
    web.use((req, res, next) => {
        // Log request
        LogServer(res.socket.localPort, res);
    });
}

// Start servers
function done(cfg) {
    if(cfg.debug) {
        Log(cfg.https.enabled ? cfg.https.port : cfg.http.port, `Listening on port ${cfg.https.enabled ? cfg.https.port : cfg.http.port}`);
    }
}
if(!appconfig.https.enabled) {
    app.listen(appconfig.http.port, () => {
        done(appconfig);
    });
} else {
    https.createServer({
        key: fs.readFileSync(appconfig.https.key),
        cert: fs.readFileSync(appconfig.https.cert)
    }, app).listen(appconfig.http.port, () => {
        done(appconfig);
    });
}
if(!webconfig.https.enabled) {
    web.listen(webconfig.http.port, () => {
        done(webconfig);
    });
} else {
    https.createServer({
        key: fs.readFileSync(webconfig.https.key),
        cert: fs.readFileSync(webconfig.https.cert)
    }, web).listen(webconfig.port, () => {
        done(webconfig);
    });
}
