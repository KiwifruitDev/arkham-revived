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
                "apps": [
                    {
                        "identity": "base",
                        "port": 7070,
                        "public": "./public/",
                        "log": {
                            "enabled": true,
                            "date": true,
                            "fgcolor": "white",
                            "bgcolor": "blue",
                            "save": false,
                            "savepath": "./logs/",
                        }
                    },
                    {
                        "identity": "echobase",
                        "port": 7171,
                        "public": "./public/",
                        "log": {
                            "enabled": true,
                            "date": true,
                            "fgcolor": "black",
                            "bgcolor": "yellow",
                            "save": false,
                            "savepath": "./logs/",
                        }
                    },
                    {
                        "identity": "wbidticket",
                        "port": 7272,
                        "public": "./public/",
                        "log": {
                            "enabled": true,
                            "date": true,
                            "fgcolor": "black",
                            "bgcolor": "green",
                            "save": false,
                            "savepath": "./logs/",
                        }
                    },
                    {
                        "identity": "wbidams",
                        "port": 7373,
                        "public": "./public/",
                        "log": {
                            "enabled": true,
                            "date": true,
                            "fgcolor": "black",
                            "bgcolor": "red",
                            "save": false,
                            "savepath": "./logs/",
                        }
                    },
                ],
                "appnamelength": 10,
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
