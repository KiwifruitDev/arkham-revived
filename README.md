# Arkham: Revived

<img src="https://i.imgur.com/ACGb3uS.png" height="50%" width="50%">

A custom authentication server for Batman: Arkham Origins Online.

Supports user authentication, saving of player data, linkage to Steam and Discord accounts, and Discord game invite generation.

Join the [Discord](https://discord.gg/rrwWcy82fr) for support, updates, and matchmaking.

## Usage

Follow these steps in order to play on Arkham: Revived.

1. Open the game directory for Batman: Arkham Origins through Steam.
2. Navigate through `Online/BmGame/Config/DefaultWBIDVars.ini` and open it in a text editor.
3. Find the following values:

    ```ini
    [GDHttp]
    BaseUrl="https://ozzypc-wbid.live.ws.fireteam.net/"
    EchoBaseURL="http://in.echo.fireteam.net/"
    WBIDTicketURL="https://tokenservice.psn.turbine.com/TokenService"
    WBIDAMSURL="https://cls.turbine.com/CLS"
    ClientId="0938aa7a-6682-4b90-a97d-90becbddb9ce"
    ClientIdSP="6ca97b4e-d278-48a4-8b66-80468447a513"
    ClientSecret="GXnNQaRSuxaxlm6uR35HVk39u"
    ClientSecretSP="AzyEBlZdY87HO3HINj7rqoBo7"
    EchoUsername="8b8f1d8554d5437b8cdf689082311680"
    EchoPassword="b3014aee79ba4968886003ecb271f764"
    Environment="Live"
    ```

4. Replace them with these values:

    ```ini
    [GDHttp]
    BaseUrl="http://[Source IP Address]:8385/"
    EchoBaseURL="http://in.echo.fireteam.net/"
    WBIDTicketURL="https://tokenservice.psn.turbine.com/TokenService"
    WBIDAMSURL="http://[Source IP Address]:8385/CLS"
    ClientId="0938aa7a-6682-4b90-a97d-90becbddb9ce"
    ClientIdSP="6ca97b4e-d278-48a4-8b66-80468447a513"
    ClientSecret="GXnNQaRSuxaxlm6uR35HVk39u"
    ClientSecretSP="AzyEBlZdY87HO3HINj7rqoBo7"
    EchoUsername="8b8f1d8554d5437b8cdf689082311680"
    EchoPassword="b3014aee79ba4968886003ecb271f764"
    Environment="Live"
    ```

    - Note: The `BaseUrl` and `WBIDAMSURL` values are the only ones that need to be changed.
    - You must obtain the source IP address of the server you're connecting to. This is usually found in the "Getting Started" section of the server's website.

5. Save the file and close it. This will allow the game to connect to Arkham: Revived.
6. Locate `SHARED.SWP` in your Steam Cloud storage directory. This is usually found in `C:\Program Files (x86)\Steam\userdata\[User ID]\209000\remote`.
    - You may obtain your user ID from [here](https://steamid.io/) as `steamID3`, removing the `[U:1` and `]` from the start and end of the ID respectively.
    - `209000` is the appid for Batman: Arkham Origins.
    - It is required to delete this file in order to unlink your WBID, as Arkham: Revived requires your game to ask for a new WBID.
7. Launch the game and make sure you've reached the main menu.
8. Close the game and re-launch it. This will ensure your account is linked to Steam.
9. Launch the game and click on **Store** in the main menu.
10. If your account was linked successfully, your display name will be shown as a store item.
11. You're now ready to play!

### Migration

Migrating progress from official servers is possible, follow these steps to start the process.

1. Follow the above steps and launch the game if you haven't already.
2. Take note of the price of the "Migrations" store option. This is the total number of migrations performed.
3. Click on "Store" in the main menu and click on "Migrate from official servers".
4. When asked to purchase, click yes. You will not be charged.
5. If an item you've earned says "Account migration process started", close the game and wait up to 5 minutes.
6. Launch the game and click on "Store" in the main menu.
7. If the "Migrations" store option's price increased by 1, your account has been migrated.
8. You're now ready to play with your existing ranks and XP!

## Setup

Setting up your own Arkham: Revived instance requires quite a bit of setup within the command line and external services.

There is no need to create your own instance, as an instance is already hosted at `arkham.kiwifruitdev.page` for public use.

### Requirements

- [Node.js](https://nodejs.org/en/)
- [Steam API Key](https://steamcommunity.com/dev/apikey)
- [Discord Application](https://discord.com/developers/applications)

### Installation

Use the following commands to install and run the server.

```bash
git clone https://github.com/KiwifruitDev/arkham-revived.git
cd arkham-revived
npm install
```

Then create a `.env` file and set the following variables.

```env
ARKHAM_UUID_KEY=[UUID key]
STEAM_API_KEY=[Steam API key]
DISCORD_CLIENT_ID=[Discord Application OAuth2 Client ID]
DISCORD_CLIENT_SECRET=[Discord Application OAuth2 Client Secret]
DISCORD_BOT_TOKEN=[Discord Application Bot Token]
```

Use a [UUID generator](https://www.uuidgenerator.net/) to generate a UUID key, this is the server's private authentication key.

Generate a [Steam API key](https://steamcommunity.com/dev/apikey) in order to save player data.

Create a [Discord Application](https://discord.com/developers/applications) and create a bot.

Now, start the server.

```bash
node .
```

### Message Of The Day

![MOTD in-game](https://i.imgur.com/HUGcQkr.png)

On first run, `motd.json` will be generated in the root directory.

This file contains an array (max 10) of messages that will be displayed on the client-side.

### Public Files

Files in `./public/` will be available through the `/files/` endpoint on default port `7070` as base64-encoded strings in a JSON object.

This feature is exclusively used for the `netvars.dat` file, which stores matchmaking information for the game and toggling of some features (such as the WBID option in menu and Hunter, Hunted mode).

Alongside the game server, files in `./web/` will be available through the default port `8080` as a website.

### Default Save File

![Max level in-game](https://i.imgur.com/o2Ox5hb.png)

The default save file, `save.json`, is used for every client that connects to the server.

It's generated on first run, pulling from `defaultsave.json` in the root directory.

This file handles XP, levels, prestige, videos watched, tutorials, unlocks, loadouts, and game settings.

Players will automatically unlock Steam achievements when playing a match or prestiging, be careful.

The default json file skips tutorials and starts players at level 1 with all redemptions.

### Database

The server uses a SQLite database under `database.db` to store user information.

Users are identified by their UUID, linked IP address, and Steam ID.

Only authenticated users are saved to the database.

### Matchmaking

Matchmaking is exclusively handled by Steam from observation.

A Steam lobby hosted on the same internet connection between players was tested, and the game was able to connect to it.

Theoretically, this server should allow Steam to connect players to each other as if this server was in a separate realm than the official server.

This means that players will only match with other players using this server, and vice versa.

Not much testing has been done with this feature, so it may not work as intended.

#### OAuth

This server does not re-implement Fireteam OAuth and its ticket system.

Instead, it generates per-session UUIDs determined by the ticket and a master key.

If the user's IP address is found in the database, the server will provide the linked UUID.

Otherwise, their data will not be saved.

### Security

The only security measure implemented is a private key used to seed UUIDs.

No other security measures are implemented, and the server is not intended to be used in a production environment.

Users cannot yet delete their data from the database, but this feature will be implemented in the future.

## Configuration

After first run, a `config.json` file will be generated in the root directory.

Set options in this file to configure the server and its command line output.

When updating, it is recommended to delete this file to ensure that the latest version is used.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the [MIT License](https://choosealicense.com/licenses/mit/).
