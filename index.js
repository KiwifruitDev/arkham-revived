// arkham-revived
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev

// Imports
import express from "express";
import fse from "fs-extra";
import crypto from "crypto";
import Database from "better-sqlite3";
import getUuid from "uuid-by-string";
import dotenv from "dotenv";
import path from "path";
import SteamAuth from "node-steam-openid";
import https from "https";
import http from "http";
import { js2xml, xml2js } from "xml-js";
import axios from "axios";
import qs from "qs";
import geoip from "geoip-lite";
import { REST, Routes, Client, GatewayIntentBits, ActivityType, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

// __dirname
const __dirname = path.resolve();

// Load .env uuid key
dotenv.config();
let uuidkey = process.env.ARKHAM_UUID_KEY;
let steamapikey = process.env.STEAM_API_KEY;
let discordapplicationid = process.env.DISCORD_CLIENT_ID;
let discordapplicationsecret = process.env.DISCORD_CLIENT_SECRET;
let discordbottoken = process.env.DISCORD_BOT_TOKEN;

// If either key is missing, give a stern warning and exit
if(!uuidkey || !steamapikey) {
    console.log(`WARNING: Environment variables ${!uuidkey ? "ARKHAM_UUID_KEY" : ""}${!uuidkey && !steamapikey ? " and " : ""}${!steamapikey ? "STEAM_API_KEY" : ""} are missing! Create .env if it doesn't exist and add these variables.`);
    console.log("Please refer to the README for more information.");
    process.exit(1);
}

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
const persistentmigrationsave = JSON.parse(fse.readFileSync("./usercfg/persistentmigrationsave.json"));

// Database
const db = new Database("./usercfg/database.db", { verbose: config.debug ? console.log : null });
db.pragma('journal_mode = WAL');

// Delete users table if wipe_on_start is true
if(config.database.wipe_on_start)
    db.exec("DROP TABLE users");

// Create users table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS users (uuid TEXT PRIMARY KEY, ipaddr TEXT, inventory TEXT, data TEXT, steamid TEXT, steampersona TEXT, migrating BOOLEAN, migration_start_time INTEGER, credentials TEXT, ticket TEXT, deleting BOOLEAN, delete_start_time INTEGER, wbid TEXT, migrations INTEGER, persistent BOOLEAN, location TEXT, discordid TEXT)");

// Scheduled actions
let scheduled_actions = [];

// Steam auth
const steam = new SteamAuth({
    realm: `${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}`,
    returnUrl: `${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}/auth/landing`,
    apiKey: steamapikey
});

// Steam deletion
const steamdelete = new SteamAuth({
    realm: `${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}`,
    returnUrl: `${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}/auth/delete`,
    apiKey: steamapikey
});

// Discord bot
let rest;
let discord_client;
if(config.discord_bot.enabled) {
    rest = new REST({ version: '10' }).setToken(discordbottoken);

    // Build commands
    const commands = new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Create an invite link for members to join your game.')
        .addStringOption(option =>
            option.setName('authserver')
            .setDescription('The auth server you are using.')
            .addChoices(
                { name: 'Official', value: 'official' },
                { name: 'Arkham: Revived', value: 'revived' },
                { name: 'Unknown', value: 'unk' },
            )
            .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('lobbyname')
            .setDescription('An optional name for your invite.')
        )
        .addStringOption(option =>
            option.setName('map')
            .setDescription('Which map would you like to display?')
            .addChoices(
                { name: 'Any Map', value: 'any' },
                { name: 'Wayne Chemical Plant', value: 'mp_wcp' },
                { name: 'Blackgate Prison', value: 'mp_prison' },
                { name: 'Joker\'s Funhouse', value: 'mp_funhouse' },
                { name: 'Wonder City Robot Factory', value: 'mp_robotfactory' },
            )
        );

    // Generate MD5 of commands
    const commands_json = commands.toJSON();
    const commands_md5 = crypto.createHash("md5").update(JSON.stringify(commands_json)).digest("hex");

    // If commands_md5 does not match config commands_md5, reload Discord commands
    if(config.discord_bot.commands_md5 != commands_md5) {
        if(config.debug)
            console.log("BOT: commands_md5 mismatch, reloading commands");
        // Update config commands_md5
        config.discord_bot.commands_md5 = commands_md5;
        // Save config
        fse.writeFileSync("./usercfg/config.json", JSON.stringify(config, null, 4));
        // Reload commands
        rest.put(Routes.applicationCommands(discordapplicationid), { body: [commands.toJSON()] })
            .then(() => {
                if(config.debug)
                    console.log('BOT: Reloaded application (/) commands')
            })
            .catch(console.error);
    }

    // Create Discord client
    discord_client = new Client({ intents: [GatewayIntentBits.Guilds | GatewayIntentBits.GuildIntegrations] });
    
    // Ready
    discord_client.once('ready', () => {
        if(config.debug)
            console.log(`BOT: Logged in as ${discord_client.user.username}#${discord_client.user.discriminator}`);
        discord_client.user.setStatus(config.discord_bot.status);
        let activity_type = ActivityType.Playing;
        switch(config.discord_bot.activity_type.toLowerCase()) {
            case "competing":
                activity_type = ActivityType.Competing;
                break;
            case "listening":
                activity_type = ActivityType.Listening;
                break;
            case "streaming":
                activity_type = ActivityType.Streaming;
                break;
            case "watching":
                activity_type = ActivityType.Watching;
                break;
        }
        discord_client.user.setActivity(config.discord_bot.activity, { type: activity_type });
    });

    // Interaction
    discord_client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        switch(interaction.commandName)
        {
            case "ping":
                await interaction.reply({ content: "Pong!" });
                break;
            case "invite":
                // Reply with typing
                const delayed = await interaction.deferReply();
                // Get steamid by discordid
                const prep = db.prepare("SELECT steamid FROM users WHERE discordid = ?");
                const data = prep.get(interaction.user.id);
                if(data && data.steamid) {
                    const summaryurl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamapikey}&steamids=${data.steamid}`;
                    let response = await axios.get(summaryurl);
                    if(response.data && response.data.response && response.data.response.players && response.data.response.players[0]) {
                        const summary = response.data.response.players[0];
                        if(summary.lobbysteamid !== undefined) {
                            const inviteurl = `${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}/joinlobby?lobbyid=${summary.lobbysteamid}&steamid=${data.steamid}`;
                            let embed = new EmbedBuilder()
                                .setColor('#2196F3')
                                .setTitle(`Join ${interaction.options.getString('lobbyname') ? "\"" + interaction.options.getString('lobbyname') + "\"" : interaction.user.globalName + '\'s Lobby'}`)
                                .setFooter({
                                    text: `Lobby ID: ${summary.lobbysteamid} • Steam ID: ${data.steamid}`,
                                })
                                .setAuthor({
                                    name: `${summary.personaname}`,
                                    iconURL: `${summary.avatarmedium}`,
                                    url: `${summary.profileurl}`
                                })
                            let set_thumb = false;
                            let description = "";
                            if(interaction.options.getString('map')) {
                                let map = interaction.options.getString('map');
                                if(config.discord_bot.maps[map]) {
                                    embed.setThumbnail(config.discord_bot.maps[map].thumbnail);
                                    description = config.discord_bot.maps[map].name;
                                    set_thumb = true;
                                }
                            }
                            if(!set_thumb)
                            {
                                embed.setThumbnail(config.discord_bot.maps.any.thumbnail);
                                description = config.discord_bot.maps.any.name;
                            }
                            const authserver = interaction.options.getString('authserver');
                            let prettyserver = "Unknown";
                            switch(authserver) {
                                case "official":
                                    prettyserver = "Official";
                                    break;
                                case "revived":
                                    prettyserver = "Arkham: Revived";
                                    break;
                            }
                            embed.setDescription(`Click [here](${inviteurl}) to launch the game and join the lobby.\n*Do not attempt to join your own lobby as a host.*`);
                            embed.setFields([
                                {
                                    name: 'Map',
                                    value: description,
                                    inline: true
                                },
                                {
                                    name: 'Auth Server',
                                    value: prettyserver,
                                    inline: true
                                }
                            ]);
                            await delayed.edit({ content: "", embeds: [embed] });
                        } else {
                            await delayed.edit({ content: `<@${interaction.user.id}>, you are not in a lobby. Create a lobby in-game and try again.`, ephemeral: true });
                        }
                    } else {
                        await delayed.edit({ content: `<@${interaction.user.id}>, an error occurred while fetching your Steam profile.`, ephemeral: true });
                    }
                } else {
                    await delayed.edit({ content: `<@${interaction.user.id}>, you are not linked to a Steam account. You must sign in at least once in-game before linking your Discord account.`, ephemeral: true });
                }
        }
    });

    // Login
    discord_client.login(discordbottoken);
}
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
    const redirect = false;
    // If redirect is true, we'll redirect to https://ozzypc-wbid.live.ws.fireteam.net/auth/token
    // Untested code!!!
    if(redirect) {
        res.redirect("https://ozzypc-wbid.live.ws.fireteam.net/auth/token");
        return;
    }
    // The uuid should be based on the ticket, the private key will be used to validate it.
    let uuid = getUuid(req.body.ticket);
    const token = {
        "token_type": "bearer",
        "access_token": uuid,
        "expires_in": 1000000,
        "refresh_token": "",
    };
    // Ask database if IP address has a UUID linked to it
    let ipaddr = req.socket.remoteAddress;
    let authorized = false;
    if(ipaddr) {
        ipaddr = ipaddr.replace("::ffff:", ""); // fix for IPv4
        ipaddr = ipaddr.replace("::1", "127.0.0.1"); // fix for localhost
        ipaddr = ipaddr.replace("127.0.0.1", config.localhost); // override localhost
        const prep = db.prepare("SELECT uuid FROM users WHERE ipaddr = ?");
        const data = prep.get(ipaddr);
        if(data) {
            uuid = data.uuid;
            authorized = true;
        }
    }
    // Check if uuid account exists
    if(authorized) {
        // Set ticket
        db.prepare("UPDATE users SET ticket = ?, credentials = ? WHERE uuid = ?").run(req.body.ticket, auth[1], uuid);
    }
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
    let authorized = false;
    let steamname = "Not Logged In";
    let steamid = "Please restart the game in order to log in.";
    let discordid = "Discord account is not linked.";
    if(ipaddr) {
        ipaddr = ipaddr.replace("::ffff:", ""); // fix for IPv4
        ipaddr = ipaddr.replace("::1", "127.0.0.1"); // fix for localhost
        ipaddr = ipaddr.replace("127.0.0.1", config.localhost); // override localhost
        const prep = db.prepare("SELECT * FROM users WHERE ipaddr = ?");
        const data = prep.all(ipaddr);
        if(data) {
            if(data.length > 0) {
                authorized = true;
                uuid = data[0].uuid;
                steamname = data[0].steampersona;
                steamid = `Steam ID: ${data[0].steamid}`;
                discordid = `Discord ID: ${data[0].discordid}`;
            }
        }
    }
    // Log UUID
    console.log(`CATALOG: ${uuid}`);
    // Build JSON response
    let response = JSON.stringify(catalog);
    response = response.replace(/%STEAM_NAME%/g, steamname.toUpperCase());
    response = response.replace(/%STEAM_ID%/g, steamid);
    response = response.replace(/%DISCORD_ID%/g, discordid);
    // Send response
    res.json(JSON.parse(response));
});

// Endpoint: /store/offers
// Used with parameters ?page=1&vendor=0 or ?page=1&vendor=4
app.get("/store/offers", function(req, res) {
    // Check if vendor is 0 or 4
    if(req.query.vendor == 4) {
        res.json(credits);
    } else {
        let stores = JSON.stringify(store);
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
        let authorized = false;
        if(ipaddr) {
            ipaddr = ipaddr.replace("::ffff:", ""); // fix for IPv4
            ipaddr = ipaddr.replace("::1", "127.0.0.1"); // fix for localhost
            ipaddr = ipaddr.replace("127.0.0.1", config.localhost); // override localhost
            const prep = db.prepare("SELECT uuid FROM users WHERE ipaddr = ?");
            const data = prep.get(ipaddr);
            if(data) {
                uuid = data.uuid;
                authorized = true;
            }
        }
        // Log UUID
        console.log(`STORE: ${uuid}`);
        // Set migration count
        const prep = db.prepare("SELECT migrations FROM users WHERE uuid = ?");
        const data = prep.get(uuid);
        if(data && data.migrations) {
            stores = stores.replace(/123456789/g, data.migrations);
        } else {
            stores = stores.replace(/123456789/g, "0");
        }
        // Send response
        res.json(JSON.parse(stores));
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
    // Create UUID from ticket using uuidkey
    let uuid = getUuid(`${uuidkey}:${ticket}`);
    // Ask database if IP address has a UUID linked to it
    let ipaddr = req.socket.remoteAddress;
    let authorized = false;
    if(ipaddr) {
        ipaddr = ipaddr.replace("::ffff:", ""); // fix for IPv4
        ipaddr = ipaddr.replace("::1", "127.0.0.1"); // fix for localhost
        ipaddr = ipaddr.replace("127.0.0.1", config.localhost); // override localhost
        const prep = db.prepare("SELECT uuid FROM users WHERE ipaddr = ?");
        const data = prep.get(ipaddr);
        if(data) {
            uuid = data.uuid;
            authorized = true;
        }
    }
    // Log UUID
    console.log(`VOUCHER: ${uuid} (${ipaddr})`);
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
            case "e62345be-304c-4551-8472-8bd2c367f3f3":
                // Migrate from official servers: Set migrating flag if ticket exists
                if(ticket && authorized) {
                    const prep = db.prepare("UPDATE users SET migrating = ?, migration_start_time = ? WHERE uuid = ?");
                    const result = prep.run(1, Date.now(), uuid);
                    let exists = false;
                    let deleting = false;
                    for(let i = 0; i < scheduled_actions.length; i++) {
                        if(scheduled_actions[i].uuid == uuid) {
                            if(scheduled_actions[i].action == "migrate")
                                exists = true;
                            if(scheduled_actions[i].action == "delete")
                                deleting = true;
                            break;
                        }
                    }
                    // If successful, add items
                    if(!exists && !deleting) {
                        // Status code
                        unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 1;
                        // Account migration process started
                        unlocks.items["1985b4d7-d02d-4bb9-999d-69948588f0c3"] = 1;
                        // Ask to close game and wait 5 minutes
                        unlocks.items["7a08ec4f-9f80-4199-925b-aa6f58759c73"] = 1;
                        // Push scheduled action
                        scheduled_actions.push({
                            "uuid": uuid,
                            "action": "migrate",
                            "time": Date.now() + 60 * 2000, // 2 minutes
                        });
                        console.log(`SCHEDULED: ${uuid} (migrate)`);
                    } else {
                        // What went wrong? Check if migration is already in progress
                        const prep = db.prepare("SELECT migration_start_time FROM users WHERE uuid = ?");
                        const data = prep.get(uuid);
                        if(data && data.migration_start_time) {
                            // Migration is already in progress
                            unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 2;
                            unlocks.items["fba9a9bd-0b5a-4e41-a74b-c25ead882bf5"] = 2;
                        } else if(deleting) {
                            // Decline
                            unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 5;
                            unlocks.items["fba9a9bd-0b5a-4e41-a74b-c25ead882bf5"] = 5;
                        } else {
                            // Unknown error occured
                            unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 5;
                            unlocks.items["71879d11-5a23-4177-a107-8a54c4a5463d"] = 3;
                        }
                    }
                }
                break;
            case "8b611b15-b560-463d-af74-78915fa399f7":
                // Request account deletion
                if(authorized) {
                    // If migrating, don't allow deletion
                    let prep = db.prepare("SELECT migrating FROM users WHERE uuid = ?");
                    let data = prep.get(uuid);
                    if(data && data.migrating == "true") {
                        // Status code
                        unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 5;
                        // Decline
                        unlocks.items["fba9a9bd-0b5a-4e41-a74b-c25ead882bf5"] = 5;
                        break;
                    }
                    // Set deletion flag
                    prep = db.prepare("UPDATE users SET deleting = ?, delete_start_time = ? WHERE uuid = ?");
                    const result = prep.run(1, Date.now(), uuid);
                    let exists = false;
                    for(let i = 0; i < scheduled_actions.length; i++) {
                        if(scheduled_actions[i].uuid == uuid && scheduled_actions[i].action == "delete") {
                            exists = true;
                            break;
                        }
                    }
                    // If successful, add items
                    if(!exists) {
                        // Status code
                        unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 1;
                        // Account deletion process started
                        unlocks.items["27afc195-9c1a-4d2d-8f56-67e4b3475b07"] = 1;
                        // Ask to close game and wait 5 minutes
                        unlocks.items["7a08ec4f-9f80-4199-925b-aa6f58759c73"] = 1;
                        // Push scheduled action
                        scheduled_actions.push({
                            "uuid": uuid,
                            "action": "delete",
                            "time": Date.now() + 60 * 5000, // 5 minutes
                        });
                        console.log(`SCHEDULED: ${uuid} (delete)`);
                    } else {
                        // What went wrong? Check if deletion is already in progress
                        const prep = db.prepare("SELECT delete_start_time FROM users WHERE uuid = ?");
                        const data = prep.get(uuid);
                        if(data && data.delete_start_time) {
                            // Status code
                            unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 1;
                            // 2 minutes up?
                            if(data.delete_start_time + 2 * 60 * 1000 < Date.now()) {
                                // Action no longer available
                                unlocks.items["fa477238-31e0-4052-9a4e-acf98df14cd5"] = 1;
                                // Wait 5 minutes
                                unlocks.items["7a08ec4f-9f80-4199-925b-aa6f58759c73"] = 1;
                            } else {
                                // Action cancelled
                                unlocks.items["21399935-ba00-4bbe-bfdb-bb544fd02048"] = 1;
                                // Delete scheduled action
                                for(let i = 0; i < scheduled_actions.length; i++) {
                                    if(scheduled_actions[i].uuid == uuid && scheduled_actions[i].action == "delete") {
                                        scheduled_actions.splice(i, 1);
                                        break;
                                    }
                                }
                                // Remove deletion flag
                                const prep = db.prepare("UPDATE users SET deleting = ?, delete_start_time = ? WHERE uuid = ?");
                                prep.run(0, null, uuid);
                            }
                        } else {
                            // Status code
                            unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 4;
                            // Unknown error occured
                            unlocks.items["71879d11-5a23-4177-a107-8a54c4a5463d"] = 4;
                        }
                    }
                }
                break;
            default:
                // Status code
                unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 10;
                // Invalid option
                unlocks.items["94d7b7a1-9a5b-4c58-81a4-ba40cd096da1"] = 10;
                break;
        }
    } catch (e) {
        console.log(e);
        // Status code
        unlocks.items["4a410e7a-c007-4aaf-8237-07d2ffe949c6"] = 9;
        // Invalid option
        unlocks.items["71879d11-5a23-4177-a107-8a54c4a5463d"] = 9;
    }
    // Add to inventory if authorized
    if(authorized) {
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
    }
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
    // Create UUID from ticket using uuidkey
    let uuid = getUuid(`${uuidkey}:${ticket}`);
    // Ask database if IP address has a UUID linked to it
    let ipaddr = req.socket.remoteAddress;
    let authorized = false;
    if(ipaddr) {
        ipaddr = ipaddr.replace("::ffff:", ""); // fix for IPv4
        ipaddr = ipaddr.replace("::1", "127.0.0.1"); // fix for localhost
        ipaddr = ipaddr.replace("127.0.0.1", config.localhost); // override localhost
        const prep = db.prepare("SELECT uuid FROM users WHERE ipaddr = ?");
        const data = prep.get(ipaddr);
        if(data) {
            uuid = data.uuid;
            authorized = true;
        }
    }
    // Log UUID
    console.log(`AUTH: ${uuid} (${ipaddr})`);
    if(urluuid === "me") {
        if(!subpage) {
            // Build JSON response with UUID
            const user = {
                "user_id": uuid,
            };
            // Send response
            res.json(user);
        } else if(subpage == "inventory") {
            let inventoryobj = baseinventory;
            let reset = false;
            if(authorized) {
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
            }
            // Send response
            res.json(inventoryobj);
        }
    } else if(subpage === "profile") {
        if(subpage2 === "private") {
            // Check if UUID matches the one in the URL
            if(uuid != urluuid) {
                // If authorized, user is likely migrating UUIDs
                // Otherwise, don't allow access
                if(!authorized) {
                    // Send error
                    res.status(400).send("Invalid UUID");
                    return;
                }
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
    } else if(subpage === "wbnet") {
        // unimplemented, return empty object
        console.log(`Unimplemented endpoint: ${req.url}`);
        res.json({
            message: "No WBNet user linked",
            code: 2600,
        });
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
    // Create UUID from ticket using uuidkey
    let uuid = getUuid(`${uuidkey}:${ticket}`);
    // Ask database if IP address has a UUID linked to it
    let ipaddr = req.socket.remoteAddress;
    let authorized = false;
    if(ipaddr) {
        ipaddr = ipaddr.replace("::ffff:", "");
        ipaddr = ipaddr.replace("::1", "127.0.0.1");
        ipaddr = ipaddr.replace("127.0.0.1", config.localhost); // override localhost
        const prep = db.prepare("SELECT uuid FROM users WHERE ipaddr = ?");
        const data = prep.get(ipaddr);
        if(data && data.uuid) {
            uuid = data.uuid;
            authorized = true;
        }
    }
    // Check if UUID matches the one in the URL
    if(uuid != urluuid) {
        // If authorized, user is likely migrating UUIDs
        // Otherwise, don't allow access
        if(!authorized) {
            // Send error
            res.status(400).send("Invalid UUID");
            return;
        }
    }
    if(urluuid === "me") {
        // unimplemented, print out
        console.log(`Unimplemented endpoint: ${req.url}`);
    } else if(subpage === "profile") {
        if(subpage2 === "private") {
            // Verify authorization header
            if(auth[0] != "Bearer") {
                // Send error
                res.status(400).send("Invalid authorization header");
                return;
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

// Account creation
app.get("/auth/landing", async (req, res) => {
    try {
        const user = await steam.authenticate(req);
        const steamid = user.steamid;
        const steampersona = user.username;
        // Get existing uuid for steamid
        let loggedin = false;
        let lastwbid = "";
        let lastlocation = "Unknown";
        let persistent = false;
        let prep = db.prepare("SELECT * FROM users WHERE steamid = ?");
        let data = prep.get(steamid);
        if(data && data.uuid) {
            loggedin = true;
            // Get last WBID connected to this account and its IP address
            lastwbid = `&wbid=${data.wbid}`;
            persistent = data.persistent;
            lastlocation = data.location;
        }
        res.redirect(`/landing.html?avatar=${user.avatar.large}&persona=${user.username}&steamid=${user.steamid}&loggedin=${loggedin}${lastwbid}&lastlocation=${lastlocation}&persistent=${persistent}`);
    } catch (error) {
        console.error(error);
        const message = "Steam authentication failed.";
        res.redirect(`/error.html?error=${message}&realerror=${error}`);
    }
});

// Account deletion
app.get("/auth/delete", async (req, res) => {
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
            console.log(`USER: ${user.steamid} - DELETED`);
            res.redirect(`/deleted.html?avatar=${user.avatar.large}`);
        } else {
            // User doesn't exist
            console.log(`USER: ${user.steamid} - NOT FOUND`);
            message = "User not found.";
            res.redirect(`/error.html?error=${message}`);
        }
    } catch (error) {
        console.error(error);
        message = "Steam authentication failed.";
        res.redirect(`/error.html?error=${message}&realerror=${error}`);
    }
});

// Discord account linkage
app.get("/auth/discord", async (req, res) => {
    // Redirect to Discord
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${discordapplicationid}&redirect_uri=${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}/auth/discord/callback&response_type=code&scope=identify connections`);
});

// Discord account linkage callback
app.get("/auth/discord/callback", async (req, res) => {
    if(req.query.code !== undefined) {
        // Get URL param code
        const code = req.query.code;
        // Axios: Get access token
        // application/x-www-form-urlencoded
        let params = new URLSearchParams();
        params.append("client_id", discordapplicationid);
        params.append("client_secret", discordapplicationsecret);
        params.append("grant_type", "authorization_code");
        params.append("code", code);
        params.append("redirect_uri", `${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}/auth/discord/callback`);
        params.append("scope", "identify connections");
        axios.post("https://discord.com/api/oauth2/token", params, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        }).then((response) => {
            // Axios: Get user ID and name
            const token = response.data.access_token;
            axios.get("https://discord.com/api/users/@me", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }).then((response) => {
                // Axios: Get connections
                const userid = response.data.id;
                const username = response.data.username;
                const avatar = response.data.avatar;
                axios.get("https://discord.com/api/users/@me/connections", {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }).then((response) => {
                    // Get steam connection
                    response.data.forEach((connection) => {
                        if(connection.type != "steam") return;
                        // Get existing uuid for steamid
                        const prep = db.prepare("SELECT uuid FROM users WHERE steamid = ?");
                        const data = prep.get(connection.id);
                        if(data && data.uuid) {
                            // Update discordid
                            const updateprep = db.prepare("UPDATE users SET discordid = ? WHERE uuid = ?");
                            updateprep.run(userid, data.uuid);
                            console.log(`USER: ${connection.id} - DISCORD LINKED TO ${userid}`);
                            res.redirect(`/discord-linked.html?avatar=${avatar}&persona=${username}&discordid=${userid}&steamid=${connection.id}`);
                        } else {
                            // User doesn't exist
                            console.log(`USER: ${connection.id} - NOT FOUND`);
                            const message = "User not found.";
                            const realerror = "Please log in with the game at least once.";
                            res.redirect(`/error.html?error=${message}&realerror=${realerror}`);
                        }
                    })
                }).catch((error) => {
                    console.error(error);
                    const message = "Discord authentication failed. Is your Steam account connected inside Discord?";
                    res.redirect(`/error.html?error=${message}&realerror=${error}`);
                });
            });
        }).catch((error) => {
            console.error(error);
            const message = "Discord authentication failed. Is your Steam account connected inside Discord?";
            res.redirect(`/error.html?error=${message}&realerror=${error}`);
        });
    }
});

// Request persistence
app.get("/persistence", async (req, res) => {
    // Get URL params steamid and persistent
    const steamid = req.query.steamid;
    const persistent = req.query.persistent;
    // Get current url
    let url = req.url;
    // Replace /persistence with /landing.html
    url = url.replace("/persistence", "/landing.html");
    let persistencelevel = !persistent;
    // Get existing uuid for steamid
    if(steamid && persistent != undefined) {
        const prep = db.prepare("SELECT uuid FROM users WHERE steamid = ?");
        const data = prep.get(steamid);
        if(data && data.uuid) {
            // Update persistence
            const updateprep = db.prepare("UPDATE users SET persistent = ? WHERE uuid = ?");
            updateprep.run(persistent, data.uuid);
            console.log(`USER: ${steamid} - PERSISTENCE: ${persistent}`);
            persistencelevel = persistent;
        }
    }
    // Replace persistent= value
    url = url.replace(/persistent=[^&]+/, `persistent=${persistencelevel}`);
    // Redirect
    res.redirect(`${url}&accessed=true`);
});

// Steam OpenID
app.get("/auth", async (req, res) => {
    const redirectUrl = await steam.getRedirectUrl();
    res.redirect(redirectUrl);
});

// Request deletion
app.get("/delete", async (req, res) => {
    let redirectUrl = await steamdelete.getRedirectUrl();
    res.redirect(redirectUrl);
});

// Join lobby redirect
app.get("/joinlobby", async (req, res) => {
    // Get URL params lobbyid and steamid
    const lobbyid = req.query.lobbyid;
    const steamid = req.query.steamid;
    // Redirect to steam://joinlobby/...
    res.redirect(`steam://joinlobby/${config.appid}/${lobbyid}/${steamid}`);
});

// Path handler
app.get(/^(.+)$/, function(req, res) {
    // Root: /index.html
    if(req.params[0] === "/")
        req.params[0] = "/index.html";
    // Send response
    const url = path.join(__dirname, "usercfg", "web", req.params[0]);
    if(fse.existsSync(url)) {
        res.sendFile(url);
    } else {
        // Pass if /CLS is in the URL
        if(!req.params[0].includes("/CLS")) {
            // 404.html
            res.status(404).sendFile(path.join(__dirname, "usercfg", "web", "404.html"));
        }
    }
});

// SOAP functions
function DummyFunc(name, args) {
    console.log(name);
    console.log(args);
}

const wbmanagement = {
    LookupWbid: function(args, callback) {
        DummyFunc("LookupWbid", args);
        const ipaddr = args.ipaddr;
        // Verify realm
        if(args.realm == "STEAM" && args.title == "OZZY" && args.uniqueId) {
            const wbid = args.uniqueId;
            let steamid = args.consoleId;
            // Pull name from steam API
            const summaryurl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamapikey}&steamids=${steamid}`;
            function cb(response) {
                if(response.data && response.data.response && response.data.response.players && response.data.response.players[0]) {
                    const user = response.data.response.players[0];
                    const name = user.personaname;
                    steamid = user.steamid;
                    // Check if the user exists
                    let prep = db.prepare("SELECT * FROM users WHERE steamid = ?");
                    const data = prep.get(steamid);
                    // Pull location from IP
                    const geo = geoip.lookup(ipaddr);
                    let lastlocation = "Unknown";
                    if(geo)
                        lastlocation = `${geo.city}, ${geo.region}, ${geo.country}`;
                    if(!data) {
                        // Create a new user
                        const uuid = crypto.randomUUID();
                        prep = db.prepare("INSERT INTO users (uuid, ipaddr, steampersona, steamid, wbid, location) VALUES (?, ?, ?, ?, ?, ?)");
                        prep.run(uuid, ipaddr, name, steamid, wbid, lastlocation);
                    } else {
                        // Update existing user
                        prep = db.prepare("UPDATE users SET steampersona = ?, steamid = ?, wbid = ?, ipaddr = ?, location = ? WHERE uuid = ?");
                        prep.run(name, steamid, wbid, ipaddr, lastlocation, data.uuid);
                    }
                }
            }
            // Check if the user exists
            let dontdoit = false;
            const prep = db.prepare("SELECT * FROM users WHERE steamid = ?");
            const data = prep.get(steamid);
            if(data) {
                // Players can choose to lock their account info to prevent unauthorized use
                console.log(`USER: ${steamid} - PERSISTENCE: ${data.persistent}`);
                if(data.persistent == "true") // encoded as string
                {
                    dontdoit = true;
                    console.log(`USER: ${steamid} - WILL NOT UPDATE`);
                }
            }
            if(!dontdoit)
                axios.get(summaryurl).then(response => cb(response)).catch(error => console.error(error));
        }
        // Don't ever log into a WBID
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
                WbidAccountId: crypto.randomUUID(),
                SubscriptionId: crypto.randomUUID(),
                AccountId: crypto.randomUUID(),
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
        args.ipaddr = req.socket.remoteAddress;
        args.ipaddr = args.ipaddr.replace("::ffff:", "");
        args.ipaddr = args.ipaddr.replace("::1", "127.0.0.1");
        args.ipaddr = args.ipaddr.replace("127.0.0.1", config.localhost);
        soapres.args = wbmanagement[soapreq.name](args);
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
        cert: fse.readFileSync(`./usercfg/${config.host.https_cert}`)
    }, app).listen(config.host.https_port, () => {
        done();
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

// Combine data
function CombineSaveData(data, newdata) {
    for(let key in newdata) {
        if(data[key] == undefined) {
            data[key] = newdata[key];
        } else {
            if(typeof data[key] == "object") {
                data[key] = CombineSaveData(data[key], newdata[key]);
            } else {
                data[key] = newdata[key];
            }
        }
    }
    return data;
}

// Scheduled actions handler
const scheduled_actions_interval = setInterval(() => {
    for(let i = 0; i < scheduled_actions.length; i++) {
        if(scheduled_actions[i].time <= Date.now()) {
            console.log(`ACTION: ${scheduled_actions[i].uuid} - ${scheduled_actions[i].action}`);
            let prep;
            let data;
            switch(scheduled_actions[i].action) {
                case "migrate":
                    // Check user for ticket
                    prep = db.prepare("SELECT credentials, ticket FROM users WHERE uuid = ?");
                    data = prep.get(scheduled_actions[i].uuid);
                    if(data.credentials == null || data.ticket == null) {
                        // No ticket, remove migration flag
                        prep = db.prepare("UPDATE users SET migrating = 0, migration_start_time = null WHERE uuid = ?");
                        data = prep.run(scheduled_actions[i].uuid);
                        console.log(`MIGRATE FAIL: ${scheduled_actions[i].uuid} - No ticket`);
                        // Delete action
                        scheduled_actions.splice(i, 1);
                        break;
                    }
                    // Migrate account
                    const migrateurl = "http://ozzypc-wbid.live.ws.fireteam.net";
                    // AXIOS: post /auth/token with Authorization:Basic [credentials] and HTML form (urlencoded)
                    axios.post(`${migrateurl}/auth/token`, qs.stringify({
                        grant_type: "http://ns.fireteam.net/oauth2/grant-type/steam/encrypted_app_ticket",
                        ticket: data.ticket
                    }), {
                        headers: {
                            "Authorization": `Basic ${data.credentials}`
                        }
                    }).then((res) => {
                        // If not 200, cancel migration
                        if(res.status != 200) {
                            prep = db.prepare("UPDATE users SET migrating = 0, migration_start_time = null WHERE uuid = ?");
                            data = prep.run(scheduled_actions[i].uuid);
                            console.log(`MIGRATE FAIL: ${scheduled_actions[i].uuid} - ${res.status} - ${res.statusText}`);
                            // Delete action
                            scheduled_actions.splice(i, 1);
                            return;
                        }
                        const access_token = res.data.access_token;
                        // Response is a JSON object with access_token, get /users/me
                        axios.get(`${migrateurl}/users/me`, {
                            headers: {
                                "Authorization": `Bearer ${access_token}`
                            }
                        }).then((res) => {
                            // If not 200, cancel migration
                            if(res.status != 200) {
                                prep = db.prepare("UPDATE users SET migrating = 0, migration_start_time = null WHERE uuid = ?");
                                data = prep.run(scheduled_actions[i].uuid);
                                console.log(`MIGRATE FAIL: ${scheduled_actions[i].uuid} - ${res.status} - ${res.statusText}`);
                                // Delete action
                                scheduled_actions.splice(i, 1);
                                return;
                            }
                            // Response is a JSON object with user_id, get /users/[user_id]/profile/private
                            axios.get(`${migrateurl}/users/${res.data.user_id}/profile/private`, {
                                headers: {
                                    "Authorization": `Bearer ${access_token}`
                                }
                            }).then((res) => {
                                // If not 200, cancel migration
                                if(res.status != 200) {
                                    prep = db.prepare("UPDATE users SET migrating = 0, migration_start_time = null WHERE uuid = ?");
                                    data = prep.run(scheduled_actions[i].uuid);
                                    console.log(`MIGRATE FAIL: ${scheduled_actions[i].uuid} - ${res.status} - ${res.statusText}`);
                                    // Delete action
                                    scheduled_actions.splice(i, 1);
                                    return;
                                }
                                // Response is a JSON object with user save data, combine with persistent migration save
                                let usersave = CombineSaveData(res.data, persistentmigrationsave);
                                // Get migration count
                                prep = db.prepare("SELECT migrations FROM users WHERE uuid = ?");
                                data = prep.get(scheduled_actions[i].uuid);
                                let migration_count = 1;
                                // Increment migration count
                                if(data.migrations != null) {
                                    migration_count = data.migrations + 1;
                                }
                                // Update user
                                prep = db.prepare("UPDATE users SET credentials = null, ticket = null, migrating = 0, migration_start_time = null, data = ?, migrations = ? WHERE uuid = ?");
                                data = prep.run(JSON.stringify(usersave), migration_count, scheduled_actions[i].uuid);
                                // Log
                                console.log(`MIGRATE: ${scheduled_actions[i].uuid}`);
                                // Delete action
                                scheduled_actions.splice(i, 1);
                            }).catch((err) => {
                                // Cancel migration
                                prep = db.prepare("UPDATE users SET migrating = 0, migration_start_time = null WHERE uuid = ?");
                                data = prep.run(scheduled_actions[i].uuid);
                                console.log(`MIGRATE FAIL: ${scheduled_actions[i].uuid}`);
                                console.log(err);
                                // Delete action
                                scheduled_actions.splice(i, 1);
                            });
                        }).catch((err) => {
                            // Cancel migration
                            prep = db.prepare("UPDATE users SET migrating = 0, migration_start_time = null WHERE uuid = ?");
                            data = prep.run(scheduled_actions[i].uuid);
                            console.log(`MIGRATE FAIL: ${scheduled_actions[i].uuid}`);
                            console.log(err);
                            // Delete action
                            scheduled_actions.splice(i, 1);
                        });
                    }).catch((err) => {
                        // Cancel migration
                        prep = db.prepare("UPDATE users SET migrating = 0, migration_start_time = null WHERE uuid = ?");
                        data = prep.run(scheduled_actions[i].uuid);
                        console.log(`MIGRATE FAIL: ${scheduled_actions[i].uuid}`);
                        console.log(err);
                        // Delete action
                        scheduled_actions.splice(i, 1);
                    });
                    break;
                case "delete":
                    // Delete account
                    prep = db.prepare("DELETE FROM users WHERE uuid = ?");
                    data = prep.run(scheduled_actions[i].uuid);
                    console.log(`DELETE: ${scheduled_actions[i].uuid}`);
                    // Delete action
                    scheduled_actions.splice(i, 1);
                    break;
                default:
                    // Unknown action
                    console.log(`ACTION FAIL: ${scheduled_actions[i].uuid} - Unknown action`);
                    // Delete action
                    scheduled_actions.splice(i, 1);
                    break;
            }
        } else {
            // Check next action
            continue;
        }
    }

}, 30000); // Check every 30 seconds

// Closing
function Close(param) {
    if(param instanceof Error)
        console.error(param);
    // Log
    if(config.debug)
        console.log("Shutting down...");
    // Close database
    db.close();
    // Close scheduled actions
    clearInterval(scheduled_actions_interval);
    // Close connections
    connections.forEach((connection) => {
        connection.destroy();
    });
    // Close server
    server.close();
    if(config.localhost_passthrough_enabled)
        server_passthrough.close();
    // Discord bot (if enabled)
    if(config.discord_bot.enabled)
        discord_client.destroy();
    // Exit
    process.exit();
}

process.on("SIGINT", Close);
process.on("SIGTERM", Close);
process.on("SIGUSR1", Close);
process.on("SIGUSR2", Close);
process.on("uncaughtException", Close);
process.on("unhandledRejection", Close);
