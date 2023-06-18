# arkham-wbid-local-server

<img src="https://i.imgur.com/ACGb3uS.png" height="50%" width="50%">

Locally hosted Fireteam WBID authentication server for Arkham Origins Online.

Supports user authentication and saving of player data.

## Requirements

[Node.js](https://nodejs.org/en/) is required to run this server.

## Installation

Use the following commands to install and run the server.

```bash
git clone https://github.com/KiwifruitDev/arkham-wbid-local-server.git
cd arkham-wbid-local-server
npm install
```

Then create a `.env` file and set the following variables.

```env
ARKHAM_UUID_KEY=[UUID key]
STEAM_API_KEY=[Steam API key]
```

Use a [UUID generator](https://www.uuidgenerator.net/) to generate a UUID key, this is the server's private authentication key.

Generate a [Steam API key](https://steamcommunity.com/dev/apikey) in order to save player data.

Now, start the server.

```bash
npm start
```

## Usage

There are two servers being hosted by this application. The default ports are listed below.

- `7070`
  - This is the main server that handles the login process.
  - The game connects to this server to authenticate the user.
    - When the user logs in, their IP is checked for linkage.
      - Link your IP using the website on port `8080` to log into Steam.
    - If the IP address is not linked, the server will generate a UUID using the game's one-time ticket and the private key.
      - This non-persistent UUID is only valid for the current session and will not save progress.
  - Enabling HTTPS will change this port to `4433` by default.
- `8080`
  - This is the website server that handles linking of IP addresses to Steam accounts.
  - The user must log in with Steam, then their IP is automatically linked.
    - If the user has never linked before, a new UUID will be generated for them.
    - If the user has a previous IP address, it will be overwritten.
  - Enabling HTTPS will change this port to `443` by default.

### Client Setup

On the client-side, set the following variables in `DefaultWBIDVars.ini`, replacing "localhost" with a remote server if desired.

If your port is not `7070` or HTTPS is enabled, change the port number and protocol accordingly.

```ini
[GDHttp]
BaseUrl="http://localhost:7070"
```

This will redirect requests to your server instead of the official server.

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
