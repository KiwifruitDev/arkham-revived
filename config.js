// arkham-wbid-local-server
// Licensed under the MIT License
// Copyright (c) 2023 KiwifruitDev
// Config class

// Imports
import fs from "fs";

// Config class
class Config {
    // Constructor
    constructor(path = "./config.json") {
        // If config.json doesn't exist, create it
        if(!fs.existsSync(path)) {
            // Base config
            const config = {
                "app": {
                    "debug": true,
                    "public": "./public/",
                    "url": "localhost",
                    "https": {
                        "enabled": false,
                        "key": "./ssl/web.decrypted.key",
                        "cert": "./ssl/web.crt",
                        "port": 4433
                    },
                    "http": {
                        "port": 7070
                    }
                },
                "web": {
                    "debug": true,
                    "public": "./web/",
                    "url": "localhost",
                    "https": {
                        "enabled": false,
                        "key": "./ssl/web.decrypted.key",
                        "cert": "./ssl/web.crt",
                        "port": 443
                    },
                    "http": {
                        "port": 8080
                    }
                },
                "database": {
                    "debug": false,
                    "path": "./database.db",
                    "wipe_on_start": false
                }
            };
            // Write config to file
            fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));
        };
        // Read config
        return JSON.parse(fs.readFileSync("./config.json"));
    }
}

// ESM exports
export { Config };
