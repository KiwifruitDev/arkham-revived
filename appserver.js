// arkham-wbid-local-server
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev
// App server class

// Imports
import express from "express";
import fs from "fs";
import crypto, { randomUUID } from "crypto";
import { Log } from "./helpers.js";
import Database from "better-sqlite3";
import getUuid from "uuid-by-string";
import dotenv from "dotenv";

let uuidkey = process.env.ARKHAM_UUID_KEY;

const db = new Database("./database.db") //, { verbose: console.log });
db.pragma('journal_mode = WAL');

// Create users table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS users (uuid TEXT PRIMARY KEY, inventory TEXT, data TEXT)");

// Log req/res function
function LogServer(port, reqres) {
    // Is request or response?
    const isRequest = reqres.hasOwnProperty("method");
    // Log to console
    Log(port, `${isRequest ? reqres.method : reqres.statusMessage} ${isRequest ? reqres.url : reqres.statusCode}`);
}

// App server class
class AppServer {
    // Constructor
    constructor(config) {
        // Create express app
        this.app = express();
        // Use JSON body parser
        this.app.use(express.json());
        // And HTML form body parser
        this.app.use(express.urlencoded({ extended: true }));
        // Endpoint: /files/*.*
        // Files are base64 encoded within a json object.
        this.app.get("/files/*.*", function(req, res) {
            // Log request
            LogServer(res.socket.localPort, req);
            // Get file name
            const file = req.params[0];
            // Get file extension
            const ext = req.params[1];
            // Read file
            const data = fs.readFileSync(`${config.public}${file}.${ext}`);
            // Encode file
            const encoded = data.toString("base64");
            // Build JSON response
            const response = {
                "data": encoded,
            };
            // Send response
            res.json(response);
            // Log response
            LogServer(res.socket.localPort, res);
        });
        // Endpoint: /auth/token
        // Returns a UUID specific to the user's ticket (Steam, presumably)
        this.app.post("/auth/token", function(req, res) {
            // Log request
            LogServer(res.socket.localPort, req);
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
            // Log response
            LogServer(res.socket.localPort, res);
        });
        // Endpoint: /motd
        // Used with parameters ?channels.0=all&channels.1=all_no_wbid&channels.2=multiplayer&channels.3=multiplayer_no_wbid&country=US&page=1&per_page=10
        // We're not parsing all of that, so we'll return a static response.
        this.app.get("/motd", function(req, res) {
            // Log request
            LogServer(res.socket.localPort, req);
            // Build JSON response
            const motd = {
                "total_count": 1,
                "next_page": 2,
                "items": [
                    {
                        "published_at": "Fri, 6 Jun 2023 04:10:17 GMT",
                        "_id": "81427673-396b-440c-9bc3-aa3d8ce67462",
                        "contents": null,
                        "title": "Welcome to the Arkham Revival custom server! Join our Discord server at https://discord.gg/jxkkkv5Ysu",
                    },
                ], 
                "page": 1,
                "pages": 1
            };
            // Send response
            res.json(motd);
            // Log response
            LogServer(res.socket.localPort, res);
        });
        // Endpoint: /store/catalog/general
        // Returns an empty object
        this.app.get("/store/catalog/general", function(req, res) {
            // Log request
            LogServer(res.socket.localPort, req);
            // Build JSON response
            const store = {
                "items": {},
            };
            // Send response
            res.json(store);
            // Log response
            LogServer(res.socket.localPort, res);
        });
        // Endpoint: /store/offers
        // Used with parameters ?page=1&vendor=0
        // No parsing, just an empty object with pagination.
        this.app.get("/store/offers", function(req, res) {
            // Log request
            LogServer(res.socket.localPort, req);
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
            // Log response
            LogServer(res.socket.localPort, res);
        });
        // Endpoint: /users/[uuid]/[sub1]/[sub2]
        // This is where settings and other user data is stored.
        // The game may also PUT to this endpoint.
        // We're going to save the data to a file, maybe in the future we'll use a database.
        this.app.get("/users/:uuid/:subpage?/:subpage2?", function(req, res) {
            // Log request
            LogServer(res.socket.localPort, req);
            const urluuid = req.url.split("/")[2]; // req.query doesn't work here
            const subpage = req.url.split("/")[3];
            const subpage2 = req.url.split("/")[4];
            // Validate authorization header
            if(!req.headers.authorization) {
                // Send error
                res.status(400).send("Invalid authorization header");
                // Log response
                LogServer(res.socket.localPort, res);
                return;
            }
            // Get authorization header
            const auth = req.headers.authorization.split(" ");
            // Verify authorization header
            if(auth[0] !== "Bearer") {
                // Send error
                res.status(400).send("Invalid authorization header");
                // Log response
                LogServer(res.socket.localPort, res);
                return;
            }
            // Get UUID
            const ticket = auth[1];
            // Create UUID from ticket using uuidkey (it should be the same every time)
            let uuid = getUuid(`${config.uuidkey}:${ticket}`);
            Log(res.socket.localPort, `Auth: ${uuid}`);
            if(urluuid === "me") {
                if(!subpage) {
                    // Add to database if it doesn't exist
                    const dataprep = db.prepare("SELECT * FROM users WHERE uuid = ?");
                    const data = dataprep.get(uuid);
                    if(!data) {
                        const prep = db.prepare("INSERT INTO users (uuid) VALUES (?)");
                        prep.run(uuid);
                    }
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
                    if(!inventorylist.inventory) {
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
                    if(uuid !== urluuid) {
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
                    if(!data.data) {
                        // Nothing's here
                        res.json({});
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
            // Log response
            LogServer(res.socket.localPort, res);
        });
        this.app.put("/users/:uuid/:subpage?/:subpage2?", function(req, res) {
            // Log request
            LogServer(res.socket.localPort, req);
            const urluuid = req.url.split("/")[2]; // req.query doesn't work here
            const subpage = req.url.split("/")[3];
            const subpage2 = req.url.split("/")[4];
            // Validate authorization header
            if(!req.headers.authorization) {
                // Send error
                res.status(400).send("Invalid authorization header");
                // Log response
                LogServer(res.socket.localPort, res);
                return;
            }
            // Get authorization header
            const auth = req.headers.authorization.split(" ");
            // Get UUID
            const ticket = auth[1];
            // Create UUID from ticket using uuidkey (it should be the same every time)
            let uuid = getUuid(`${config.uuidkey}:${ticket}`);
            Log(res.socket.localPort, `Auth: ${uuid}`);
            // Check if UUID matches the one in the URL
            if(uuid !== urluuid) {
                // Send error
                res.status(400).send("Invalid UUID");
                // Log response
                LogServer(res.socket.localPort, res);
                return;
            }
            if(urluuid === "me") {
                // unimplemented, print out
                Log(res.socket.localPort, `Unimplemented endpoint: ${req.url}`);
            } else if(subpage === "profile") {
                if(subpage2 === "private") {
                    // Verify authorization header
                    if(auth[0] !== "Bearer") {
                        // Send error
                        res.status(400).send("Invalid authorization header");
                        // Log response
                        LogServer(res.socket.localPort, res);
                        return;
                    }
                    // Pull from database
                    const dataprep = db.prepare("SELECT data FROM users WHERE uuid = ?");
                    const data = dataprep.get(uuid);
                    // Check if data exists
                    if(!data) {
                        // Send error
                        res.status(400).send("Invalid UUID");
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
            // Log response
            LogServer(res.socket.localPort, res);
        });
        // Endpoint: /WbAccountManagement.asmx
        this.app.post("/WbAccountManagement.asmx", function(req, res) {
            // Log request
            LogServer(res.socket.localPort, req);
            // Send empty asmx without any data
            res.send(`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
</soap:Body>
</soap:Envelope>`);
            // Log response
            LogServer(res.socket.localPort, res);
        });
        // 404 handler
        this.app.use(function(req, res, next) {
            // Log request
            LogServer(res.socket.localPort, req);
            // Send error
            res.status(404).send("Not found");
            // Log response
            LogServer(res.socket.localPort, res);
        });
    }
    // Start app server
    start(port) {
        // Listen callback
        this.app.listen(port, function() {
            Log(port, `Listening on port ${port}`);
        });
    }
}

// ESM exports
export { AppServer };