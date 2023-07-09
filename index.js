// arkham-revived
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev

// Imports
const express = require("express");
const fse = require("fs-extra");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const getUuid = require("uuid-by-string");
const dotenv = require("dotenv");
const path = require("path");
const SteamAuth = require("node-steam-openid");
const https = require("https");
const http = require("http");
const xmljs = require("xml-js");
const js2xml = xmljs.js2xml;
const xml2js = xmljs.xml2js;
const axios = require("axios");
const qs = require("qs");
const geoip = require("geoip-lite");
const discord = require('discord.js');
const tls = require("tls");
const { inflate } = require("zlib");
const REST = discord.REST;
const Routes = discord.Routes;
const Client = discord.Client;
const GatewayIntentBits = discord.GatewayIntentBits;
const ActivityType = discord.ActivityType;
const EmbedBuilder = discord.EmbedBuilder;
const SlashCommandBuilder = discord.SlashCommandBuilder;
const ButtonStyle = discord.ButtonStyle;
const ButtonBuilder = discord.ButtonBuilder;
const ActionRowBuilder = discord.ActionRowBuilder;
const TextInputBuilder = discord.TextInputBuilder;
const ModalBuilder = discord.ModalBuilder;
const StringSelectMenuBuilder = discord.StringSelectMenuBuilder;
const StringSelectMenuOptionBuilder = discord.StringSelectMenuOptionBuilder;
const TextInputStyle = discord.TextInputStyle;

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
{
    db.exec("DROP TABLE users");
    db.exec("DROP TABLE leaderboard_revived");
    db.exec("DROP TABLE leaderboard_official");
    db.exec("DROP TABLE leaderboard_event");
}

// Create users table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS users (uuid TEXT PRIMARY KEY, ipaddr TEXT, inventory TEXT, data TEXT, steamid TEXT, steampersona TEXT, migrating BOOLEAN, migration_start_time INTEGER, credentials TEXT, ticket TEXT, deleting BOOLEAN, delete_start_time INTEGER, wbid TEXT, migrations INTEGER, persistent BOOLEAN, location TEXT, discordid TEXT)");

// Create leaderboard_revived table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS leaderboard_revived (uuid TEXT PRIMARY KEY, accountxp INTEGER, jokerxp INTEGER, banexp INTEGER, elitekillsonheros INTEGER, herokillsonelites INTEGER)");

// Create leaderboard_official table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS leaderboard_official (uuid TEXT PRIMARY KEY, accountxp INTEGER, jokerxp INTEGER, banexp INTEGER, elitekillsonheros INTEGER, herokillsonelites INTEGER)");

// Create leaderboard_event table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS leaderboard_event (uuid TEXT PRIMARY KEY, accountxp INTEGER, jokerxp INTEGER, banexp INTEGER, elitekillsonheros INTEGER, herokillsonelites INTEGER, eventname TEXT)");

// Create leaderboard_popularskins table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS leaderboard_popularskins (uuid TEXT PRIMARY KEY, gdskin INTEGER, rskin INTEGER)");

// Create leaderboard_discordeventsubmissions table if it doesn't exist
db.exec("CREATE TABLE IF NOT EXISTS leaderboard_discordeventsubmissions (discordid TEXT PRIMARY KEY, messageid TEXT, eventid TEXT, score TEXT, notes TEXT, submitterid TEXT, data TEXT)");

// Clear leaderboard_event table if first eventname is not equal to config.event.name after config.event.end_time
if(config.event.end_time < Date.now()) {
    const prep = db.prepare("SELECT * FROM leaderboard_event");
    const data = prep.get();
    if(data && data.eventname != config.event.name) {
        db.exec("DELETE FROM leaderboard_event");
    }
    // Set new end_time based on duration
    config.event.end_time = Date.now() + config.event.duration;
    // Save config
    fse.writeFileSync("./usercfg/config.json", JSON.stringify(config, null, 4));
}

function LeaderboardTrackStats(uuid, data, type) {
    // Clear revived, event, and skins for this uuid after migration
    if(type == "official") {
        db.prepare("DELETE FROM leaderboard_revived WHERE uuid = ?").run(uuid);
        db.prepare("DELETE FROM leaderboard_event WHERE uuid = ?").run(uuid);
        db.prepare("DELETE FROM leaderboard_popularskins WHERE uuid = ?").run(uuid);
    }
    const accountxp = data.AccountXP || 0;
    const jokerxp = data.jokerXP || 0;
    const banexp = data.baneXP || 0;
    const elitekillsonheros = data.EliteKillsOnHeroes || 0;
    const herokillsonelites = data.HeroKillsOnElites || 0;
    let gdskin = 0;
    let rskin = 0;
    if(data.LocalCharAltMeshIndex && data.LocalCharAltMeshIndex.length >= 2) {
        gdskin = data.LocalCharAltMeshIndex[0];
        rskin = data.LocalCharAltMeshIndex[1];
    }
    // Don't update event leaderboard if event is over
    let shouldUpdate = true;
    if(type == "event" && config.event.end_time < Date.now())
        shouldUpdate = false;
    if(shouldUpdate) {
        let database = `leaderboard_${type}`;
        let prep = db.prepare(`INSERT OR REPLACE INTO ${database} (uuid, ${type == "popularskins" ? "gdskin, rskin" : "accountxp, jokerxp, banexp, elitekillsonheros, herokillsonelites"}${type == "event" ? ", eventname" : ""}) VALUES (?, ${type == "popularskins" ? "?, ?" : "?, ?, ?, ?, ?"}${type == "event" ? ", ?" : ""})`);
        let opts = [
            uuid,
            type == "popularskins" ? gdskin : accountxp,
            type == "popularskins" ? rskin : jokerxp,
            type == "popularskins" ? null : banexp,
            type == "popularskins" ? null : elitekillsonheros,
            type == "popularskins" ? null : herokillsonelites
        ];
        if(type == "event") {
            // opts should be appended, not replaced, redo it
            let prep2 = db.prepare(`SELECT * FROM leaderboard_revived WHERE uuid = ?`);
            let data2 = prep2.get(uuid);
            if(data2) {
                // Get difference between desired value and current revived value in database
                opts[1] = accountxp - data2.accountxp;
                opts[2] = jokerxp - data2.jokerxp;
                opts[3] = banexp - data2.banexp;
                opts[4] = elitekillsonheros - data2.elitekillsonheros;
                opts[5] = herokillsonelites - data2.herokillsonelites;
                // Get current event leaderboard data if it exists
                prep2 = db.prepare(`SELECT * FROM leaderboard_event WHERE uuid = ?`);
                data2 = prep2.get(uuid);
                if(data2) {
                    // Adding only new stats to the event leaderboard
                    opts[1] += data2.accountxp;
                    opts[2] += data2.jokerxp;
                    opts[3] += data2.banexp;
                    opts[4] += data2.elitekillsonheros;
                    opts[5] += data2.herokillsonelites;
                }
            }
            // Append event name
            opts.push(config.event.name);
        } else if(type == "revived") {
            // Get current official leaderboard data if it exists
            let prep2 = db.prepare(`SELECT * FROM leaderboard_official WHERE uuid = ?`);
            let data2 = prep2.get(uuid);
            if(data2) {
                // Get difference between desired value and current official value in database
                // We don't want the player's migrated stats to be added to the revived leaderboard
                opts[1] = accountxp - data2.accountxp;
                opts[2] = jokerxp - data2.jokerxp;
                opts[3] = banexp - data2.banexp;
                opts[4] = elitekillsonheros - data2.elitekillsonheros;
                opts[5] = herokillsonelites - data2.herokillsonelites;
            }
        }
        // Run the query
        switch(type) {
            case "official":
            case "revived":
                prep.run(opts[0], opts[1], opts[2], opts[3], opts[4], opts[5]);      
                break;
            case "event":
                prep.run(opts[0], opts[1], opts[2], opts[3], opts[4], opts[5], opts[6]);
                break;
            case "popularskins":
                prep.run(opts[0], opts[1], opts[2]);
                break;
        }
    }
}

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
    const commands = [new SlashCommandBuilder()
        .setName('invite')
            .setDescription('Create an invite link for members to join your game.')
            .addSubcommand(subcommand => 
                subcommand
                .setName('linked')
                    .setDescription('Automatically create an invite link from your linked account.')
                .addStringOption(option =>
                    option.setName('authserver')
                        .setDescription('The auth server you are using.')
                        .addChoices(
                            { name: 'Official', value: 'official' },
                            { name: 'Arkham: Revived', value: 'revived' },
                            { name: 'Unknown', value: 'unk' }
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
                            { name: 'Wonder City Robot Factory', value: 'mp_robotfactory' }
                        )
                )
            )
            .addSubcommand(subcommand =>
                subcommand
                .setName('uri')
                .setDescription('Create an invite link with a Steam URI, from the Join Game button on your profile.')
                .addStringOption(option =>
                    option.setName('uri')
                        .setDescription('The Steam URI to create an invite from.')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('authserver')
                        .setDescription('The auth server you are using.')
                        .addChoices(
                            { name: 'Official', value: 'official' },
                            { name: 'Arkham: Revived', value: 'revived' },
                            { name: 'Unknown', value: 'unk' }
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
                            { name: 'Wonder City Robot Factory', value: 'mp_robotfactory' }
                        )
                )
            ),
        new discord.ContextMenuCommandBuilder()
            .setName('Submit Score')
            .setType(discord.ApplicationCommandType.Message),
        new SlashCommandBuilder()
            .setName("deletescore")
            .setDescription("Delete a score you have submitted.")
            .addStringOption(option =>
                option.setName('event')
                    .setDescription('The event you are deleting a score from.')
                    .setAutocomplete(true)
                    .setRequired(true)),
        new SlashCommandBuilder()
        .setName("challengeleaderboard")
            .setDescription("View the leaderboard for an event.")
            .addStringOption(option =>
                option.setName('event')
                    .setDescription('The event you are viewing the leaderboard for.')
                    .setAutocomplete(true)),
        new SlashCommandBuilder()
        .setName("startlobby")
            .setDescription("Start a lobby to track stats.")
            .addStringOption(option =>
                option.setName('name')
                    .setDescription('The name of your lobby. Users will be able to see this, if made public.')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('player2')
                    .setDescription('A link to the Steam profile of the second player in your lobby.'))
            .addStringOption(option =>
                option.setName('player3')
                    .setDescription('A link to the Steam profile of the third player in your lobby.'))
            .addStringOption(option =>
                option.setName('player4')
                    .setDescription('A link to the Steam profile of the fourth player in your lobby.'))
            .addStringOption(option =>
                option.setName('player5')
                    .setDescription('A link to the Steam profile of the fifth player in your lobby.'))
            .addStringOption(option =>
                option.setName('player6')
                    .setDescription('A link to the Steam profile of the sixth player in your lobby.'))
            .addStringOption(option =>
                option.setName('player7')
                    .setDescription('A link to the Steam profile of the seventh player in your lobby.'))
            .addStringOption(option =>
                option.setName('player8')
                    .setDescription('A link to the Steam profile of the eighth player in your lobby.')),
        new SlashCommandBuilder()
        .setName("endlobby")
            .setDescription("End a lobby and save the stats.")
            .addStringOption(option =>
                option.setName('player1')
                    .setDescription('The name of the first player in your lobby. This is only provided for reference.')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addStringOption(option =>
                option.setName('team1')
                    .setDescription('The team of the first player in your lobby.')
                    .setRequired(true)
                    .setAutocomplete(true))]

    // Generate MD5 of commands
    const commands_md5 = crypto.createHash("md5").update(commands.map(command => command.toJSON()).join()).digest("hex");

    // If commands_md5 does not match config commands_md5, reload Discord commands
    if(config.discord_bot.commands_md5 != commands_md5) {
        if(config.debug)
            console.log("BOT: commands_md5 mismatch, reloading commands");
        // Update config commands_md5
        config.discord_bot.commands_md5 = commands_md5;
        // Save config
        fse.writeFileSync("./usercfg/config.json", JSON.stringify(config, null, 4));
        // Reload commands
        rest.put(Routes.applicationCommands(discordapplicationid), { body: commands })
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

    // Forum post creation
    discord_client.on('threadCreate', thread => {
        if(thread.parent.type != discord.ChannelType.GuildForum)
            return;
        // Join forum post
        thread.join();
    });
    // Interaction
    discord_client.on('interactionCreate', interaction => {
        if(interaction.isChatInputCommand()) {
            switch(interaction.commandName)
            {
                case "invite":
                    // Get subcommand
                    const subcommand = interaction.options.getSubcommand(true);
                    let lobbyid = "";
                    let steamid = "";
                    let mine = false;
                    switch(subcommand)
                    {
                        case "linked":
                            // Get steamid by discordid
                            const prep = db.prepare("SELECT steamid FROM users WHERE discordid = ?");
                            const data = prep.get(interaction.user.id);
                            if(data && data.steamid) {
                                steamid = data.steamid;
                                const summaryurl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamapikey}&steamids=${data.steamid}`;
                                axios.get(summaryurl).then(response => {
                                    if(response.data && response.data.response && response.data.response.players && response.data.response.players[0]) {
                                        const summary = response.data.response.players[0];
                                        if(summary.lobbysteamid !== undefined) {
                                            lobbyid = summary.lobbysteamid;
                                        } else {
                                            interaction.reply({ content: `> <@${interaction.user.id}>, you are not in a lobby. Create a lobby in-game and try again.\n> Make sure you're set to online with a public Steam profile!\n> <https://arkham.kiwifruitdev.page/>`, ephemeral: true });
                                        }
                                    } else {
                                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching your Steam profile.\n> Make sure you're set to online with a public Steam profile!\n> <https://arkham.kiwifruitdev.page/>`, ephemeral: true });
                                    }
                                }).catch(error => {
                                    interaction.reply({ content: `> <@${interaction.user.id}>, you are not linked to a Steam account.\n> You must link your Discord account from Arkham: Revived.\n> <https://arkham.kiwifruitdev.page/>`, ephemeral: true });
                                });
                            }
                            mine = true;
                            break;
                        case "uri":
                            // Get URI parameter
                            const uri = interaction.options.getString('uri', true);
                            // steam://joinlobby/209000/109775242328154226/76561199029547231
                            // steam://joinlobby/209000/Lobby ID/Steam ID
                            // Separate URI into parts
                            const uriparts = uri.split('/');
                            // Get lobbyid and steamid
                            for(let i = 0; i < uriparts.length; i++) {
                                if(uriparts[i] === "joinlobby") {
                                    try {
                                        lobbyid = uriparts[i + 1];
                                        steamid = uriparts[i + 2];
                                    }
                                    catch(error) {
                                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while parsing the Steam URI.\n> Make sure you're using a correct Steam URI!\n> <https://arkham.kiwifruitdev.page/>`, ephemeral: true });
                                    }
                                    break;
                                }
                            }
                            break;
                        default:
                            interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while parsing the command.\n> Use a subcommand!\n> <https://arkham.kiwifruitdev.page/>`, ephemeral: true });
                            return;
                    }
                    const inviteurl = `${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}/joinlobby?lobbyid=${lobbyid}&steamid=${steamid}`;
                    let name = interaction.options.getString('lobbyname') ? "\"" + interaction.options.getString('lobbyname') + "\"" : interaction.user.globalName + '\'s Lobby';
                    if(!mine)
                        name = "Lobby";
                    let embed = new EmbedBuilder()
                        .setColor('#2196F3')
                        .setTitle(`Join ${name}`)
                        .setFooter({
                            text: `Lobby ID: ${lobbyid} • Steam ID: ${steamid}`,
                        })
                        .setAuthor({
                            name: `Steam Profile`,
                            iconURL: `https://cdn.discordapp.com/attachments/228252957563420673/1111183905941360720/image.png`,
                            url: `https://steamcommunity.com/profiles/${steamid}`,
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
                        embed.setDescription(`Click on the button to launch the game and join the lobby.\n*Do not attempt to join your own lobby as a host.*\n<https://arkham.kiwifruitdev.page/>`);
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
                        let button = new ButtonBuilder()
                            .setStyle(ButtonStyle.Link)
                            .setLabel("Join Lobby")
                            .setURL(inviteurl);
                        interaction.reply({ content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
                    break;
                case "deletescore":
                    // Get event name parameter
                    let eventname = interaction.options.getString('event', true);
                    // Get guild
                    let guild = discord_client.guilds.cache.get(interaction.guildId);
                    // Available?
                    if(!guild || !guild.available) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the server.\n> Make sure the server is available!\n> <https://arkham.kiwifruitdev.page/>`, ephemeral: true });
                        return;
                    }
                    // If event name ends with a parenthesis, there's a user id
                    let userid = interaction.user.id;
                    if(eventname.endsWith(")")) {
                        // Get user id
                        userid = eventname.substring(eventname.lastIndexOf("(") + 1, eventname.lastIndexOf(")"));
                        // Get event name
                        eventname = eventname.substring(0, eventname.lastIndexOf("("));
                        // Space?
                        if(eventname.endsWith(" "))
                            eventname = eventname.substring(0, eventname.lastIndexOf(" "));
                    }
                    // Check if db entry exists
                    let prep = db.prepare("SELECT * FROM leaderboard_discordeventsubmissions WHERE eventid = ? AND discordid = ?;");
                    let result = prep.get(eventname, userid);
                    if(!result) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, this event entry does not exist.`, ephemeral: true });
                        return;
                    }
                    // Delete db entry
                    prep = db.prepare("DELETE FROM leaderboard_discordeventsubmissions WHERE eventid = ? AND discordid = ?;");
                    result = prep.run(eventname, userid);
                    // Success
                    interaction.reply({ content: `> <@${interaction.user.id}>, the event score for <@${userid}> has been deleted.`, ephemeral: true });
                    break;
                case "challengeleaderboard":
                    // Get event name parameter
                    eventname = interaction.options.getString('event', true);
                    break;
            }
        } else if(interaction.isAutocomplete()) {
            switch(interaction.commandName) {
                case "deletescore":
                    const focusedOption = interaction.options.getFocused(true);
                    switch(focusedOption.name) {
                        case "event":
                            // Get guild
                            let guild = discord_client.guilds.cache.get(interaction.guildId);
                            let choices = [];
                            // Available?
                            if(guild && guild.available) {
                                // Query database for events associated with this user
                                let prep = db.prepare("SELECT * FROM leaderboard_discordeventsubmissions;");
                                let results = prep.all();
                                // Get events
                                let events = Array.from(guild.scheduledEvents.cache.values());
                                // Add event name and discordid to choices
                                for(let i = 0; i < results.length; i++) {
                                    // If not submitterid or discordid, skip
                                    if(results[i].submitterid !== interaction.user.id && results[i].discordid !== interaction.user.id)
                                        continue;
                                    let me = true;
                                    if(results[i].discordid !== interaction.user.id)
                                        me = false;
                                    choices.push({
                                        name: `${results[i].eventid}${me ? "" : " (" + results[i].discordid + ")"}`,
                                        value: `${results[i].eventid}${me ? "" : " (" + results[i].discordid + ")"}`,
                                    });
                                }
                            }
                            interaction.respond(choices);
                            break;
                    }
                    break;
            }
        } else if(interaction.isContextMenuCommand()) {
            switch(interaction.commandName) {
                case "Submit Score":
                    // Are they the author of the message?
                    let admin = false;
                    // If user has manage messages permissions, they can submit any challenge run
                    if(interaction.member.permissions.has(discord.PermissionsBitField.Flags.ManageMessages))
                        admin = true;
                    if(interaction.targetMessage.author.id !== interaction.user.id && !admin) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, you can only submit challenge runs that you have posted.`, ephemeral: true });
                        return;
                    }
                    // Does the message contain an attachment or embed?
                    if(interaction.targetMessage.attachments.size === 0 && interaction.targetMessage.embeds.length === 0) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, you can only submit challenge runs that have an attachment or embed.`, ephemeral: true });
                        return;
                    }
                    // Get server's name and icon
                    let guild = discord_client.guilds.cache.get(interaction.guildId);
                    // Available?
                    if(!guild || !guild.available) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the server information.`, ephemeral: true });
                        return;
                    }
                    // Get scheduled events in guild
                    let events = Array.from(guild.scheduledEvents.cache.values());
                    let emojis = [];
                    // Get first emoji from each event name or description, fallback to trophy
                    for(let i = 0; i < events.length; i++) {
                        let found = events[i].name.match(/<a?:.+?:\d+>/);
                        if(!found)
                            found = events[i].description.match(/<a?:.+?:\d+>/);
                        if(found)
                            emojis.push(found[0]);
                        else
                            emojis.push("🏆");
                    }
                    if(events.length > 0) {
                        // Ask which event with string select component
                        let select = new StringSelectMenuBuilder()
                            .setCustomId("submitchallengeeventselect")
                            .setPlaceholder("Select an event...")
                        let options = [];
                        for(let i = 0; i < events.length; i++) {
                            let description = events[i].description;
                            // Trim and add ellipsis if too long
                            if(description.length > 97)
                                description = description.substring(0, 97) + "...";
                            options.push(new StringSelectMenuOptionBuilder()
                                .setLabel(events[i].name)
                                .setDescription(description)
                                .setValue(events[i].name.toLowerCase().replace(/ /g, "_"))
                                .setEmoji(emojis[i]));
                        }
                        select.addOptions(options);
                        // Send message
                        interaction.reply({ content: "", ephemeral: true, embeds: [new EmbedBuilder()
                            .setColor('#2196F3')
                            .setTitle("Submit a Challenge Run")
                            .setDescription(`Select an event to submit a challenge run for.`)
                            .setAuthor({
                                name: interaction.targetMessage.author.displayName,
                                iconURL: interaction.targetMessage.author.avatarURL(),
                            })
                            .setFooter({
                                text: `Message ID: ${interaction.targetMessage.id} • User ID: ${interaction.targetMessage.author.id}`
                            })],
                            components: [new ActionRowBuilder().addComponents(select)]
                        });
                    } else {
                        interaction.reply({ content: `> <@${interaction.user.id}>, there are no scheduled events in this server.`, ephemeral: true });
                    }
                    break;
            }
        } else if(interaction.isStringSelectMenu()) {
            switch(interaction.customId) {
                case "submitchallengeeventselect":
                    let event = interaction.values[0];
                    // Is this a valid ongoing event?
                    let guild = discord_client.guilds.cache.get(interaction.guildId);
                    // Available?
                    if(!guild || !guild.available) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the server information.`, ephemeral: true });
                        return;
                    }
                    let events = Array.from(guild.scheduledEvents.cache.values());
                    let eventnames = [];
                    for(let i = 0; i < events.length; i++)
                        eventnames.push(events[i].name.toLowerCase().replace(/ /g, "_"));
                    const index = eventnames.indexOf(event);
                    // If index is > -1, event is valid
                    if(index > -1) {
                        let emoji = "🏆";
                        // Get first emoji from each event name or description, fallback to trophy
                        let found = events[index].name.match(/<a?:.+?:\d+>/);
                        if(!found)
                            found = events[index].description.match(/<a?:.+?:\d+>/);
                        if(found)
                            emojis = found[0];
                        // Show user modal
                        let modal = new ModalBuilder()
                            .setCustomId("submitchallengeeventmodal")
                            .setTitle("Submit a Challenge Run");
                        // Add fields
                        let secondActionRow = new ActionRowBuilder()
                            .addComponents(new TextInputBuilder()
                                .setLabel("Score")
                                .setCustomId("submitchallengescore")
                                .setRequired(true)
                                .setPlaceholder("(Time, Points, etc.)")
                                .setStyle(TextInputStyle.Short));
                        let thirdActionRow = new ActionRowBuilder()
                            .addComponents(new TextInputBuilder()
                                .setLabel("Notes")
                                .setCustomId("submitchallengenotes")
                                .setPlaceholder("(Optional)")
                                .setRequired(false)
                                .setStyle(TextInputStyle.Paragraph));
                        modal.addComponents(secondActionRow, thirdActionRow);
                        let description = events[index].description;
                        // Trim and add ellipsis if too long
                        if(description.length > 97)
                            description = description.substring(0, 97) + "...";
                        // Update interaction
                        interaction.showModal(modal).then(() => {
                            interaction.editReply({
                                components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                                    .setCustomId("submitchallengeeventselect")
                                    .setPlaceholder("Select an event...")
                                    .addOptions([new StringSelectMenuOptionBuilder()
                                        .setLabel(events[index].name)
                                        .setDescription(description)
                                        .setValue(events[index].name.toLowerCase().replace(/ /g, "_"))
                                        .setEmoji(emoji)
                                        .setDefault(true)
                                    ]).setDisabled(true))]
                            });
                        });
                    } else {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the event information.`, ephemeral: true });
                    }
                    break;
            }
        } else if(interaction.isModalSubmit()) {
            switch(interaction.customId) {
                case "submitchallengeeventmodal":
                    const message = interaction.message;
                    if(!message) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the message information.`, ephemeral: true });
                        return;
                    }
                    if(message.embeds.length < 1) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the message information.`, ephemeral: true });
                        return;
                    }
                    if(message.components.length < 1) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the message information.`, ephemeral: true });
                        return;
                    }
                    let originalmessageid = message.embeds[0].footer.text.match(/Message ID: (\d+)/);
                    if(!originalmessageid) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the message information.`, ephemeral: true });
                        return;
                    }
                    // Get event name
                    let eventname = message.components[0].components[0].options[0].label;
                    // Get guild
                    let guild = discord_client.guilds.cache.get(interaction.guildId);
                    // Available?
                    if(!guild || !guild.available) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the server information.`, ephemeral: true });
                        return;
                    }
                    // Get original message
                    let originalmessage = guild.channels.cache.get(interaction.channelId).messages.cache.get(originalmessageid[1]);
                    // Available?
                    if(!originalmessage) {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the message information.`, ephemeral: true });
                        return;
                    }
                    // Get event
                    let events = Array.from(guild.scheduledEvents.cache.values());
                    let event = events.find(e => e.name === eventname);
                    // If event is valid
                    if(event) {
                        // Get score
                        let score = interaction.fields.getField("submitchallengescore").value;
                        // Get notes
                        let notes = interaction.fields.getField("submitchallengenotes").value;
                        // Get user
                        let user = guild.members.cache.get(interaction.user.id);
                        // Available?
                        if(!user) {
                            interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the user information.`, ephemeral: true });
                            return;
                        }
                        // Already exists in database?
                        let prep = db.prepare("SELECT * FROM leaderboard_discordeventsubmissions WHERE discordid = ? AND eventid = ?");
                        let result = prep.get(originalmessage.author.id, event.name);
                        if(result) {
                            // Replace in database
                            prep = db.prepare("UPDATE leaderboard_discordeventsubmissions SET score = ?, notes = ?, messageid = ? WHERE discordid = ? AND eventid = ?");
                            prep.run(score, notes, originalmessage.id, originalmessage.author.id, event.name);
                        } else {
                            // Add to database
                            prep = db.prepare("INSERT INTO leaderboard_discordeventsubmissions (discordid, messageid, eventid, score, notes, submitterid) VALUES (?, ?, ?, ?, ?, ?)");
                            prep.run(originalmessage.author.id, originalmessage.id, event.name, score, notes, user.id);
                        }
                        // Send reply
                        interaction.reply({ephemeral: true, embeds: [new EmbedBuilder()
                            .setColor('#2196F3')
                            .setAuthor({
                                name:  originalmessage.author.displayName,
                                iconURL: originalmessage.author.avatarURL()
                            })
                            .setTitle(`Challenge Run Submission`)
                            .setDescription(`You have successfully submitted a challenge run.`)
                            .addFields(
                                { name: 'Event', value: event.name, inline: true },
                                { name: 'Score', value: score, inline: true},
                                { name: 'Notes', value: notes ? notes : "None", inline: true}
                            )
                            .setFooter({
                                text: `Message ID: ${originalmessage.id} • User ID: ${message.author.id}`,
                            })
                        ]});
                    } else {
                        interaction.reply({ content: `> <@${interaction.user.id}>, an error occurred while fetching the event information.`, ephemeral: true });
                    }
                    break;
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
    response = response.replace(/%STEAM_NAME%/g, steamname);
    response = response.replace(/%STEAM_ID%/g, steamid);
    response = response.replace(/%DISCORD_ID%/g, discordid);
    let jsonresponse = JSON.parse(response);
    // Pull leaderboards: Fake store items will store every player's stats
    let fakeitems = [];
    let fakeitemref = {
        "category": "Unnamed",
        "info": {},
        "name": "",
        "video_url": "",
        "data": {
          "gangland_sort_index": "12",
          "gangland_effect_type": "8",
          "gangland_effect_amount": "0.12",
          "gangland_is_consumable": "1"
        },
        "flags": 2,
        "icon_url": "",
        "category_id": "86ca8986-94a4-57f0-9287-40b7ac4bebc1",
        "type": 0,
        "id": "",
        "description": ""
    };
    // accountxp jokerxp banexp elitekillsonheros herokillsonelites
    let descriptionref = "%DATABASE% stats:\r\n\r\nSteam ID: %STEAM_ID%\r\nAccount XP: %XP%\r\nJoker XP: %JOKER_XP%\r\nBane XP: %BANE_XP%\r\nElite Kills on Heroes: %ELITE_KILLS_ON_HEROES%\r\nHero Kills on Elites: %HERO_KILLS_ON_ELITES%";
    let databases = ["revived", "official", "event"];
    const prep = db.prepare(`SELECT * FROM users`);
    const users = prep.all();
    for(let i = 0; i < databases.length; i++) {
        const prep2 = db.prepare(`SELECT * FROM leaderboard_${databases[i]}`);
        const leaderboard = prep2.all();
        for(let j = 0; j < leaderboard.length; j++) {
            // Parse UUID
            const account = users.find(user => user.uuid === leaderboard[j].uuid);
            if(account) {
                // Parse description
                let description = descriptionref;
                // Capitalize first letter of database name
                description = description.replace(/%DATABASE%/g, databases[i].charAt(0).toUpperCase() + databases[i].slice(1));
                description = description.replace(/%STEAM_ID%/g, account.steamid);
                description = description.replace(/%XP%/g, leaderboard[j].accountxp);
                description = description.replace(/%JOKER_XP%/g, leaderboard[j].jokerxp);
                description = description.replace(/%BANE_XP%/g, leaderboard[j].banexp);
                description = description.replace(/%ELITE_KILLS_ON_HEROES%/g, leaderboard[j].elitekillsonheros);
                description = description.replace(/%HERO_KILLS_ON_ELITES%/g, leaderboard[j].herokillsonelites);
                // Append event name if database is "event"
                if(databases[i] == "event")
                    description += `\r\nEvent: ${leaderboard[j].eventname}`;
                // Get position when sorting by accountxp
                let position = 1; // 1st place
                for(let k = 0; k < leaderboard.length; k++) {
                    if(leaderboard[k].accountxp > leaderboard[j].accountxp)
                        position++; // Increment position
                }
                // Parse fake item
                let fakeitem = JSON.parse(JSON.stringify(fakeitemref));
                fakeitem.name = `${position}. ${account.steampersona} (${databases[i].charAt(0).toUpperCase() + databases[i].slice(1)})`;
                fakeitem.id = `${account.uuid}-${databases[i]}`; // This is valid, the game does not parse UUIDs
                fakeitem.description = description;
                fakeitem.icon_url = account.steamavatar;
                fakeitems.push(fakeitem);
            }
        }
    }
    // Add fake items to response
    jsonresponse.items = Object.assign(jsonresponse.items, fakeitems);
    // Send response
    res.json(jsonresponse);
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
    console.log(`VOUCHER: ${req.params.transactionid} (${uuid} ${ipaddr})`);
    const unlocks = {
        "items": {},
    };
    let replace = true;
    try {
        switch(req.params.transactionid) {
            case "d7482553-7c71-41a0-8db1-ab272089bd89":
                // Your steam stats
                // Get leaderboards
                const leaderboards = ["revived", "official", "event"];
                for(let i = 0; i < leaderboards.length; i++) {
                    const prep = db.prepare(`SELECT * FROM leaderboard_${leaderboards[i]}`);
                    const data = prep.all();
                    // Sort by accountxp
                    data.sort(function(a, b) {
                        return b.accountxp - a.accountxp;
                    });
                    // Add to unlocks
                    unlocks.items[`${uuid}-${leaderboards[i]}`] = 1;
                }
                break;
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
            // Track stats
            LeaderboardTrackStats(uuid, req.body.data, "revived");
            //LeaderboardTrackStats(uuid, req.body.data, "popularskins");
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
app.get("/auth/landing", (req, res) => {
    try {
        steam.authenticate(req).then(user => {
            const steamid = user.steamid;
            const steampersona = user.username;
            // Get existing uuid for steamid
            let loggedin = false;
            let lastwbid = "";
            let lastlocation = "Unknown";
            let persistent = false;
            let prep = db.prepare("SELECT * FROM users WHERE steamid = ?");
            let data = prep.get(steamid);
            if(data && data.wbid) {
                loggedin = true;
                // Get last WBID connected to this account and its IP address
                lastwbid = `&wbid=${data.wbid}`;
                persistent = data.persistent;
                lastlocation = data.location;
            }
            res.redirect(`/landing.html?avatar=${user.avatar.large}&persona=${user.username}&steamid=${user.steamid}&loggedin=${loggedin}${lastwbid}&lastlocation=${lastlocation}&persistent=${persistent}`);
        });
    } catch (error) {
        console.error(error);
        const message = "Steam authentication failed.";
        res.redirect(`/error.html?error=${message}&realerror=${error}`);
    }
});

// Account deletion
app.get("/auth/delete", (req, res) => {
    let message;
    try {
        steamdelete.authenticate(req).then(user => {
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
        });
    } catch (error) {
        console.error(error);
        message = "Steam authentication failed.";
        res.redirect(`/error.html?error=${message}&realerror=${error}`);
    }
});

// Discord account linkage
app.get("/auth/discord", (req, res) => {
    // Redirect to Discord
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${discordapplicationid}&redirect_uri=${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}/auth/discord/callback&response_type=code&scope=identify connections`);
});

// Discord account linkage callback
app.get("/auth/discord/callback", (req, res) => {
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
        let domain = `${config.host.https_enabled ? "https" : "http"}://${config.host.domain}${config.host.show_port ? ':' + (config.host.https_enabled ? config.host.https_port : config.host.http_port) : ""}/auth/discord/callback`;
        // if localhost, use localhost
        let ipaddr = req.socket.remoteAddress;
        ipaddr = ipaddr.replace("::ffff:", "");
        ipaddr = ipaddr.replace("::1", "127.0.0.1");
        if(ipaddr === "127.0.0.1") {
            domain = domain.replace(config.host.domain, "localhost").replace(config.host.https_enabled ? config.host.https_port : config.host.http_port, config.host.localhost_passthrough_port);
            if(!config.host.show_port)
                domain = domain.replace("localhost", "localhost:" + config.host.localhost_passthrough_port);
            if(config.host.https_enabled)
                domain = domain.replace("https", "http");
        }
        params.append("redirect_uri", domain);
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
                        } else {
                            // User doesn't exist, create a dummy user
                            const uuid = crypto.randomUUID();
                            const insertprep = db.prepare("INSERT INTO users (uuid, steamid, discordid) VALUES (?, ?, ?)");
                            insertprep.run(uuid, connection.id, userid);
                            console.log(`USER: ${connection.id} - DISCORD LINKED TO ${userid}`);
                        }
                        res.redirect(`/discord-linked.html?avatar=${avatar}&persona=${username}&discordid=${userid}&steamid=${connection.id}`);
                        // Add discordgrantrole to guildmember
                        for(let i = 0; i < config.discord_bot.role_grants.length; i++) {
                            try {
                                discord_client.guilds.fetch(config.discord_bot.role_grants[i].guild).then((guild) => {
                                    guild.roles.fetch(config.discord_bot.role_grants[i].role).then((role) => {
                                        guild.members.fetch(userid).then((member) => {
                                            member.roles.add(role);
                                        });
                                    });
                                });
                            } catch (error) {
                                continue;
                            }
                        }
                    })
                }).catch((error) => {
                    const message = "Discord authentication failed. Is your Steam account connected inside Discord?";
                    res.redirect(`/error.html?error=${message}&realerror=${error}`);
                });
            });
        }).catch((error) => {
            const message = "Discord authentication failed. Is your Steam account connected inside Discord?";
            res.redirect(`/error.html?error=${message}&realerror=${error.response.data.error_description}`);
        });
    } else {
        const message = "Discord authentication failed. Is your Steam account connected inside Discord?";
        const error = "No code provided";
        res.redirect(`/error.html?error=${message}&realerror=${error}`);
    }
});

// Request persistence
app.get("/persistence", (req, res) => {
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
app.get("/auth", (req, res) => {
    steam.getRedirectUrl().then(redirectUrl => {
        res.redirect(redirectUrl);
    });
});

// Request deletion
app.get("/delete", (req, res) => {
    steamdelete.getRedirectUrl().then(redirectUrl => {
        res.redirect(redirectUrl);
    });
});

// Join lobby redirect
app.get("/joinlobby", (req, res) => {
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
                                prep = db.prepare("SELECT * FROM users WHERE uuid = ?");
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
                                // Track stats
                                LeaderboardTrackStats(scheduled_actions[i].uuid, data.body, "official");
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
                    // Unlink discordid if present
                    let timeout = 0;
                    if(config.discord_bot.enabled) {
                        prep = db.prepare("SELECT discordid FROM users WHERE uuid = ?");
                        data = prep.get(scheduled_actions[i].uuid);
                        if(data.discordid != null) {
                            // Unlink
                            for(let i = 0; i < config.discord_bot.role_grants.length; i++) {
                                try {
                                    discord_client.guilds.fetch(config.discord_bot.role_grants[i].guild).then((guild) => {
                                        guild.members.fetch(data.discordid).then((member) => {
                                            guild.roles.fetch(config.discord_bot.role_grants[i].role).then((role) => {
                                                member.roles.remove(role).then(() => {
                                                    // Log
                                                    console.log(`UNLINK: ${scheduled_actions[i].uuid} - ${data.discordid}`);
                                                }).catch((err) => {
                                                    // Log
                                                    console.log(`UNLINK FAIL: ${scheduled_actions[i].uuid} - ${data.discordid}`);
                                                    console.log(err);
                                                });
                                            }).catch((err) => {
                                                console.log(`UNLINK FAIL: ${scheduled_actions[i].uuid} - ${data.discordid}`);
                                                console.log(err);
                                            });
                                        }).catch((err) => {
                                            // Log
                                            console.log(`UNLINK FAIL: ${scheduled_actions[i].uuid} - ${data.discordid}`);
                                            console.log(err);
                                        });
                                    }).catch((err) => {
                                        // Log
                                        console.log(`UNLINK FAIL: ${scheduled_actions[i].uuid} - ${data.discordid}`);
                                        console.log(err);
                                    });
                                } catch(err) {
                                    // Log
                                    console.log(`UNLINK FAIL: ${scheduled_actions[i].uuid} - ${data.discordid}`);
                                    console.log(err);
                                }
                            }
                            timeout = 10000; // 10 seconds
                        }
                    }
                    // Delete account
                    setTimeout(() => {
                        prep = db.prepare("DELETE FROM users WHERE uuid = ?");
                        data = prep.run(scheduled_actions[i].uuid);
                        console.log(`DELETE: ${scheduled_actions[i].uuid}`);
                    }, timeout);
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
