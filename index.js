// arkham-revived
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev

// Imports
const express = require("express");
const fse = require("fs-extra");
const Database = require("better-sqlite3");
const getUuid = require("uuid-by-string");
const https = require("https");
const http = require("http");
const xmljs = require("xml-js");
const js2xml = xmljs.js2xml;
const xml2js = xmljs.xml2js;

// If usercfg folder doesn't exist, copy basecfg to usercfg
if(!fse.existsSync("./usercfg")) {
    if(fse.existsSync("./basecfg")) {
        fse.copySync("./basecfg", "./usercfg");
    } else {
        // Warn user
        console.log("WARNING: basecfg folder is missing! Re-install is recommended.");
        process.exit(1);
    }
}
// Load usercfg
const config = JSON.parse(fse.readFileSync("./usercfg/config.json"));
const motd = JSON.parse(fse.readFileSync("./usercfg/motd.json"));
const store = JSON.parse(fse.readFileSync("./usercfg/store.json"));
const credits = JSON.parse(fse.readFileSync("./usercfg/credits.json"));
const catalog = JSON.parse(fse.readFileSync("./usercfg/catalog.json"));
const save = JSON.parse(fse.readFileSync("./usercfg/save.json"));
const netvars = fse.readFileSync("./usercfg/netvars.dat").toString("base64");
const baseinventory = JSON.parse(fse.readFileSync("./usercfg/inventory.json"));

// Database
const db = new Database("./usercfg/database.db", { verbose: config.debug ? console.log : null });
db.pragma('journal_mode = WAL');

// Delete users table if wipe_on_start is true
if(config.database.wipe_on_start)
{
    db.exec("DROP TABLE users");
}

// Create users table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS users (uuid TEXT PRIMARY KEY, inventory TEXT, data TEXT, consoleid TEXT, consoleticket TEXT, ip TEXT)");

// Create app and configure
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: "text/xml" }));

// Log requests
if(config.debug) {
    app.use((req, res, next) => {
        // Log request
        console.log(`${req.method} ${req.url}`);
        // Next
        next();
    });
}

// Endpoint: /files/netvars.dat
// Game info stored in base64
app.get("/files/netvars.dat", function(req, res) {
    // Build JSON response
    const response = {
        "data": netvars,
    };
    // Send response
    res.json(response);
});

// Endpoint: /auth/token
// Returns a UUID specific to the user's ticket (Steam, presumably)
app.post("/auth/token", function(req, res) {
    // Validate authorization header
    if(!req.headers.authorization) {
        // Send error
        res.status(400).send("Invalid authorization header");
        return;
    }
    // Get authorization header
    const auth = req.headers.authorization.split(" ");
    // Verify authorization header
    if(auth[0] != "Basic") {
        // Send error
        res.status(400).send("Invalid authorization header");
        return;
    }
    // Find UUID by ticket header
    const ticketHeader = req.body.ticket.split("_")[0].split("-")[0];;
    const uuidDb = db.prepare("SELECT uuid FROM users WHERE consoleticket = ?").get(ticketHeader);
    let uuid;
    if(!uuidDb) {
        // Try looking by ip
        const ipDb = db.prepare("SELECT uuid FROM users WHERE ip = ?").get(req.ip);
        if(ipDb) {
            // Use this uuid
            uuid = ipDb.uuid;
        } else {
            // Create new UUID
            uuid = getUuid(ticketHeader);
        }
    } else {
        // Get UUID from database
        uuid = uuidDb.uuid;
    }
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
    // Send response
    res.json(motd);
});

// Endpoint: /store/catalog/general
// Game catalog
app.get("/store/catalog/general", function(req, res) {
    // Send response
    res.json(catalog);
});

// Endpoint: /store/offers
// Used with parameters ?page=1&vendor=0 or ?page=1&vendor=4
app.get("/store/offers", function(req, res) {
    // Check if vendor is 0 or 4
    if(req.query.vendor == 4) {
        res.json(credits);
    } else {
        res.json(store);
    }
});

// Endpoint: /store/vouchers/transactions
// POST by the game
app.post("/store/vouchers/transactions", function(req, res) {
    // Free vouchers from the game
    const vouchers = [
        "e8fd70ec-f3ec-519b-8b57-70518c4c4f74",
        "640144eb-7862-5186-90d0-606211ec2271",
        "54d80a04-cfbc-51a4-91a1-a88a5c96e7ea",
        "82a9febc-5f11-57db-8464-2ed2b4df74f9",
    ];
    if(!vouchers.includes(req.body.voucher_id)) {
        // Send error
        res.status(400).send("Invalid voucher ID");
        return;
    }
    // This doesn't follow API spec, but just use the offer_id as the transaction_id
    const transactionid = req.body.voucher_id;
    // Build JSON response
    const response = {
        "transaction_id": transactionid,
    };
    // 201 Created
    res.status(201).json(response);
});

// Endpoint: /store/purchases/transactions
// POST by the game
app.post("/store/purchases/transactions", function(req, res) {
    // This doesn't follow API spec, but just use the offer_id as the transaction_id
    const transactionid = req.body.offer_id;
    // Build JSON response
    const response = {
        "transaction_id": transactionid,
    };
    // 201 Created
    res.status(201).json(response);
});

// Transactions
function Transaction(req, res) {
    // We don't check transaction IDs, but at least ensure it's there
    if(!req.params.transactionid) {
        // Send error
        res.status(400).send("Invalid transaction ID");
        return;
    }
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
    // Create UUID from ticket
    let uuid = ticket;
    // Check if UUID is in database
    const uuidDb = db.prepare("SELECT uuid FROM users WHERE uuid = ?").get(uuid);
    if(!uuidDb) {
        // Report a server error
        console.log(`ERROR: UUID ${uuid} not found in database!`);
        res.status(500).send("Internal server error");
        return;
    }
    // Log UUID
    console.log(`VOUCHER: ${req.params.transactionid} (${uuid}`);
    const unlocks = {
        "items": {},
    };
    let replace = true;
    try {
        switch(req.params.transactionid) {
            case "2f93daeb-d68f-4b28-80f4-ace882587a13":
                // Assortment of consumables
                let consumables = [];
                // Get consumables
                for(let key in catalog.items) {
                    const item = catalog.items[key];
                    if(item.data && item.data.gangland_is_consumable == "1") {
                        consumables.push(key);
                    }
                }
                // Pick 5 random consumables
                const consumablecount = 5;
                for(let i = 0; i < consumablecount; i++) {
                    const item = consumables[Math.floor(Math.random() * consumables.length)];
                    if(unlocks.items[item]) {
                        unlocks.items[item] += 1;
                    } else {
                        unlocks.items[item] = 1;
                    }
                }
                replace = false;
                break;
        }
    } catch (e) {
        console.log(e);
    }
    const inventoryprep = db.prepare("SELECT inventory FROM users WHERE uuid = ?");
    const inventorylist = inventoryprep.get(uuid);
    let inventoryobj = baseinventory;
    // Check if inventory exists
    if(inventorylist && inventorylist.inventory) {
        inventoryobj = JSON.parse(inventorylist.inventory);
    }
    // Add items to inventory
    for(let itemid in unlocks.items) {
        // Add item to inventory item count (or create it)
        if(inventoryobj.inventory[itemid]) {
            inventoryobj.inventory[itemid] += unlocks.items[itemid];
        } else {
            inventoryobj.inventory[itemid] = unlocks.items[itemid];
        }
    }
    // Update inventory
    const inventory = JSON.stringify(inventoryobj);
    const inventoryupdate = db.prepare("UPDATE users SET inventory = ? WHERE uuid = ?");
    inventoryupdate.run(inventory, uuid);
    // 201 Created
    res.status(201).json(unlocks);
}

// Endpoint: /store/vouchers/:transactionid
// PUT by the game
app.put("/store/vouchers/:transactionid", Transaction);

// Endpoint: /store/purchases/:transactionid
// PUT by the game
app.put("/store/purchases/:transactionid", Transaction);

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
    // Create UUID from ticket
    let uuid = ticket;
    // Log UUID
    console.log(`AUTH: ${uuid}`);
    if(urluuid === "me") {
        if(!subpage) {
            // Build JSON response with UUID
            const user = {
                "user_id": uuid,
            };
            // Send response
            res.json(user);
        } else if(subpage == "inventory") {
            // Check if UUID is in database
            const uuidDb = db.prepare("SELECT uuid FROM users WHERE uuid = ?").get(uuid);
            if(!uuidDb) {
                // Report a server error
                console.log(`ERROR: UUID ${uuid} not found in database!`);
                res.status(500).send("Internal server error");
                return;
            }
            let inventoryobj = baseinventory;
            let reset = false;
            // Query database for inventory
            const inventoryprep = db.prepare("SELECT inventory FROM users WHERE uuid = ?");
            const inventorylist = inventoryprep.get(uuid);
            // If inventory doesn't exist, create it
            if(!inventorylist || !inventorylist.inventory) {
                // Insert inventory into existing row
                const inventoryinsert = db.prepare("UPDATE users SET inventory = ? WHERE uuid = ?");
                inventoryinsert.run(JSON.stringify(inventoryobj), uuid);
            } else {
                // Inventory is a JSON object
                inventoryobj = JSON.parse(inventorylist.inventory);
                reset = true;
            }
            // Send response
            res.json(inventoryobj);
        }
    } else if(subpage === "profile") {
        // Check if UUID is in database
        const uuidDb = db.prepare("SELECT uuid FROM users WHERE uuid = ?").get(uuid);
        if(!uuidDb) {
            // Report a server error
            console.log(`ERROR: UUID ${uuid} not found in database!`);
            res.status(500).send("Internal server error");
            return;
        }
        if(subpage2 === "private") {
            // Check if UUID matches the one in the URL
            if(uuid != urluuid) {
                // Send error
                res.status(400).send("Invalid UUID");
                return;
            }
            // Pull from database
            const dataprep = db.prepare("SELECT data FROM users WHERE uuid = ?");
            const data = dataprep.get(uuid);
            let json = save;
            // Check if data exists
            if(!data || !data.data) {
                // Insert save into existing row
                const insert = db.prepare("UPDATE users SET data = ? WHERE uuid = ?");
                insert.run(JSON.stringify(json), uuid);
            } else {
                // Save is a JSON object
                json = JSON.parse(data.data);
            }
            // Send response
            res.json(json);
        } else {
            // unimplemented, return empty object
            console.log(`Unimplemented endpoint: ${req.url}`);
            res.json({});
        }
    } else {
        // unimplemented, return empty object
        console.log(`Unimplemented endpoint: ${req.url}`);
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
    // Create UUID from ticket
    let uuid = ticket;
    if(urluuid === "me") {
        if(subpage === "wbnet") {
            // log whatever's in the body
            console.log(req.body);
            res.json({
                message: "No WBNet user linked",
                code: 2600,
            });
            return;
        } else {
            // unimplemented, print out
            console.log(`Unimplemented endpoint: ${req.url}`);
        }
    } else if(subpage === "profile") {
        // Check if UUID is in database
        const uuidDb = db.prepare("SELECT uuid FROM users WHERE uuid = ?").get(uuid);
        if(!uuidDb) {
            // Report a server error
            console.log(`ERROR: UUID ${uuid} not found in database!`);
            res.status(500).send("Internal server error");
            return;
        }
        // Check if UUID matches the one in the URL
        if(uuid != urluuid) {
            // Send error
            res.status(400).send("Invalid UUID");
            return;
        }
        if(subpage2 === "private") {
            // Verify authorization header
            if(auth[0] != "Bearer") {
                // Send error
                res.status(400).send("Invalid authorization header");
                return;
            }
            // Check body JSON to ensure .data.AccountXPLevel >= 24
            if(!req.body.data || !req.body.data.AccountXPLevel || req.body.data.AccountXPLevel < 24) {
                // Send error
                res.status(400).send("Invalid body");
                return;
            }
            // Check AccountXPLevel
            if(req.body.data && req.body.data.AccountXPLevel < 24) {
                // Just set it
                req.body.data.AccountXPLevel = 24;
                // Log to console
                console.log("Account XP level set");
            }
            if(req.body.data && req.body.data.baneXPLevel < 24) {
                // Just set it
                req.body.data.baneXPLevel = 24;
                // Log to console
                console.log("Bane XP level set");
            }
            // Check jokerXPLevel
            if(req.body.data && req.body.data.jokerXPLevel < 24) {
                // Just set it
                req.body.data.jokerXPLevel = 24;
                // Log to console
                console.log("Joker XP level set");
            }
            // Update database
            const updateprep = db.prepare("UPDATE users SET data = ? WHERE uuid = ?");
            updateprep.run(JSON.stringify(req.body), uuid);
        } else {
            // unimplemented, print out
            console.log(`Unimplemented endpoint: ${req.url}`);
        }
    } else {
        // unimplemented, print out
        console.log(`Unimplemented endpoint: ${req.url}`);
    }
    // Send response
    res.status(204).send();
});

// Endpoint: /actions/:action
// Unknown...

// SOAP functions
function DummyFunc(name, args) {
    console.log(name);
    console.log(args);
}

const wbmanagement = {
    LookupWbid: function(args, callback) {
        DummyFunc("LookupWbid", args);
        // Verify realm
        //args.realm == "STEAM" && 
        if(args.title == "OZZY" && args.uniqueId) {
            // Create or set UUID in database using characters before / in consoleTicket
            const ticketHeader = args.consoleTicket.split("/")[0].split("+")[0];
            const uuid = getUuid(ticketHeader);
            // Create entry if it doesn't exist
            const user = db.prepare("SELECT * FROM users WHERE consoleid = ?").get(args.consoleId);
            if(!user) {
                // Create entry
                const prep = db.prepare("INSERT INTO users (uuid, inventory, data, consoleid, consoleticket, ip) VALUES (?, ?, ?, ?, ?, ?)");
                prep.run(uuid, JSON.stringify(baseinventory), JSON.stringify(save), args.consoleId, ticketHeader, args.ip);
            } else {
                // Update console ID and ticket
                const prep = db.prepare("UPDATE users SET consoleticket = ?, uuid = ?, ip = ? WHERE consoleid = ?");
                prep.run(ticketHeader, uuid, args.consoleId, args.ip);
            }
            /*
            return {
                LookupWbidResult: args.realm + "_" + args.consoleId + "@" + "example.com"
            };
            */
        }
        return {};
    },
    AssociateWbid: function(args, callback) {
        DummyFunc("AssociateWbid", args);
        return {};
    },
    DisassociateWbid: function(args, callback) {
        DummyFunc("DisassociateWbid", args);
        return {};
    },
    CreateAccount: function(args, callback) {
        DummyFunc("CreateAccount", args);
        return {};
    },
    CreateAccountAndAssociate: function(args, callback) {
        DummyFunc("CreateAccountAndAssociate", args);
        return {};
    },
    ResetPassword: function(args, callback) {
        DummyFunc("ResetPassword", args);
        return {};
    },
    StartWBPasswordReset: function(args, callback) {
        DummyFunc("StartWBPasswordReset", args);
        return {};
    },
    StartWBPasswordResetFromConsole: function(args, callback) {
        DummyFunc("StartWBPasswordResetFromConsole", args);
        return {};
    },
    FinishWBPasswordReset: function(args, callback) {
        DummyFunc("FinishWBPasswordReset", args);
        return {};
    },
    GetSubscriptionInformation: function(args, callback) {
        DummyFunc("GetSubscriptionInformation", args);
        return {
            GetSubscriptionInformationResult: {
                WbidAccountId: getUuid(args.consoleId + ":accountid"),
                SubscriptionId: getUuid(args.consoleId + ":subscriptionid"),
                AccountId: getUuid(args.consoleId + ":accountid"),
                Entitlements: [] // ??? I couldn't source a dump of this, may be used for DLC
            }
        };
    }
};

// Pretty much half-implemented SOAP server
// No WDSL because the soap package does not immediately support the official one.
// The game doesn't call it, so it's not needed.
function SOAPPost(req, res) {
    // Get XML as JSON
    const xml = xml2js(req.body);
    let soapreq = {
        name: "",
        args: {}
    };
    for(let i = 0; i < xml.elements.length; i++) {
        for(let j = 0; j < xml.elements[i].elements.length; j++) {
            soapreq.name = xml.elements[i].elements[j].elements[0].name;
            for(let k = 0; k < xml.elements[i].elements[j].elements[0].elements.length; k++) {
                if(xml.elements[i].elements[j].elements[0].elements[k].elements != undefined) {
                    for(let l = 0; l < xml.elements[i].elements[j].elements[0].elements[k].elements.length; l++) {
                        soapreq.args[xml.elements[i].elements[j].elements[0].elements[k].name] = xml.elements[i].elements[j].elements[0].elements[k].elements[l].text;
                    }
                } else {
                    soapreq.args[xml.elements[i].elements[j].elements[0].elements[k].name] = xml.elements[i].elements[j].elements[0].elements[k].text;
                }
            }
        }
    }
    let xmlres = {
        declaration: {
            attributes: {
                version: "1.0",
                encoding: "utf-8"
            }
        },
        elements: [{
            type: "element",
            name: "soap:Envelope",
            attributes: {
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                "xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
                "xmlns:soap": "http://schemas.xmlsoap.org/soap/envelope/"
            },
            elements: [{
                type: "element",
                name: "soap:Body",
                elements: []
            }]
        }]
    };
    let soapres = {
        name: "",
        args: {}
    };
    // Content type
    res.set("Content-Type", "text/xml");
    let fault = false;
    // Call SOAP function
    if(wbmanagement[soapreq.name]) {
        soapres.name = soapreq.name + "Response";
        // Add IP address to args
        let args = soapreq.args;
        args.ip = req.ip;
        soapres.args = wbmanagement[soapreq.name](args);
        // Empty check
        if(Object.keys(soapres.args).length === 0) {
            fault = true;
            res.status(500);
        } else {
            // Build XML response
            xmlres.elements[0].elements[0].elements.push({
                type: "element",
                name: soapres.name,
                elements: []
            });
            for(let key in soapres.args) {
                xmlres.elements[0].elements[0].elements[0].elements.push({
                    type: "element",
                    name: key,
                    elements: [{
                        type: "text",
                        text: soapres.args[key]
                    }]
                });
            }
        }
    } else {
        fault = true;
        res.status(500);
    }
    if(fault) {
        // Build XML fault
        xmlres.elements[0].elements[0].elements.push({
            type: "element",
            name: "soap:Fault",
            elements: [
                {
                    type: "element",
                    name: "soap:Code",
                    elements: [{
                        type: "text",
                        text: "soap:Receiver"
                    }]
                },
                {
                    type: "element",
                    name: "soap:Reason",
                    elements: [{
                        type: "text",
                        text: "Unhandled exception ---> The provided SteamTicketInformation ticket has expired."
                    }]
                },
                {
                    type: "element",
                    name: "soap:Node",
                    elements: [{
                        type: "text",
                        text: "Turbine.Ams.Steam.SteamAuthenticationProvider.ValidateExternalTicket_worker"
                    }]
                },
                {
                    type: "element",
                    name: "detail",
                    elements: [
                        {
                            type: "element",
                            name: "exceptiontype",
                            elements: [{
                                type: "text",
                                text: "Turbine.Security.TicketExpiredException"
                            }]
                        },
                        {
                            type: "element",
                            name: "errorcode",
                            elements: [{
                                type: "text",
                                text: "0xA01B000C"
                            }]
                        }
                    ]
                }
            ]
        });
    }
    // Send response
    res.send(js2xml(xmlres));
}

app.post("/CLS/WbAccountManagement.asmx", SOAPPost);
app.post("/CLS/WbSubscriptionManagement.asmx", SOAPPost);

// Start servers
function done() {
    if(config.debug) {
        console.log(`WEB: Listening on port ${config.host.https_enabled ? config.host.https_port : config.host.http_port}`);
    }
}
let server;
let server_passthrough;
if(!config.host.https_enabled) {
    server = app.listen(config.host.http_port, () => {
        done();
    });
} else {
    server = https.createServer({
        key: fse.readFileSync(`./usercfg/${config.host.https_key}`),
        cert: fse.readFileSync(`./usercfg/${config.host.https_cert}`),
    }, app).listen(config.host.https_port, () => {
        done();
    });
    server.on("tlsClientError", err => {
        if(config.debug) {
            console.error(err);
        }
    });
    server.on("connection", socket => {
        socket.on("error", err => {
            if(config.debug) {
                console.error(err);
            }
        });
        socket.on("data", data => {
            if(config.debug) {
                console.log(`WEB: TLS read ${data.length} bytes`);
            }
        });
    });
}
if(config.host.localhost_passthrough_enabled) {
    // Passthrough server
    server_passthrough = http.createServer(app).listen(config.host.localhost_passthrough_port, () => {
        if(config.debug) {
            console.log(`WEB: Passthrough on port ${config.host.localhost_passthrough_port}`);
        }
    });
}

// Connection storage
let connections = [];
server.on('connection', connection => {
    connections.push(connection);
    connection.on('close', () => {
        connections = connections.filter(curr => curr !== connection);
    });
});
if(config.host.localhost_passthrough_enabled) {
    server_passthrough.on('connection', connection => {
        connections.push(connection);
        connection.on('close', () => {
            connections = connections.filter(curr => curr !== connection);
        });
    });
}

// Closing
function Close(param) {
    if(param instanceof Error)
        console.error(param);
    // Log
    if(config.debug)
        console.log("Shutting down...");
    // Close database
    db.close();
    // Close connections
    connections.forEach((connection) => {
        connection.destroy();
    });
    // Close server
    server.close();
    if(config.localhost_passthrough_enabled)
        server_passthrough.close();
    // Exit
    process.exit();
}

process.on("SIGINT", Close);
process.on("SIGTERM", Close);
process.on("SIGUSR1", Close);
process.on("SIGUSR2", Close);
process.on("uncaughtException", Close);
process.on("unhandledRejection", Close);
