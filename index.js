// arkham-wbid-local-server
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev

// Imports
import { AppServer } from "./appserver.js";
import { Config } from "./config.js";

// Load config
const config = new Config();

// Set up app servers
for(let i = 0; i < config.apps.length; i++) {
    // Create app server
    const server = new AppServer(config.apps[i]);
    // Start app server
    server.start(config.apps[i].port);
}