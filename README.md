# arkham-wbid-local-server

![Command line output](https://i.imgur.com/Oydg0lt.png)

Locally hosted Fireteam WBID authentication server for Arkham Origins Online.

## Requirements

[Node.js](https://nodejs.org/en/) is required to run this server.

## Installation

Use the following commands to install and run the server.

```bash
git clone https://github.com/KiwifruitDev/arkham-wbid-local-server.git
cd arkham-wbid-local-server
npm install
```

Then create a `.env` file and set the following variables. Use a [UUID generator](https://www.uuidgenerator.net/) to generate a UUID key, this is the server's private authentication key.

```env
ARKHAM_UUID_KEY=db89c0f79bc19df4b8a4a3e02e1edcc7
```

Now, start the server.

```bash
npm start
```

On the client-side, set the following variables in `DefaultWBIDVars.ini`, replacing "localhost" with a remote server if desired.

```ini
[GDHttp]
BaseUrl="http://localhost:7070"
EchoBaseURL="http://localhost:7171"
WBIDTicketURL="http://localhost:7272"
WBIDAMSURL="http://localhost:7373"
```

This will redirect requests to third-party servers instead of the Fireteam servers.

## Usage

There are four servers being hosted by this application.

- BASE: Port 7070
  - This is the main server that handles the login process.
  - In-progress.
- ECHOBASE: Port 7171
  - Unknown purpose, likely for gameplay stats.
  - Unimplemented.
- WBIDTICKET: Port 7272
  - Unknown purpose.
  - Unimplemented.
- WBIDAMS: Port 7373
  - This server handles logging into a WBID.
  - Unimplemented.

## Message Of The Day

![MOTD in-game](https://i.imgur.com/HUGcQkr.png)

On first run, `motd.json` will be generated in the root directory.

This file contains an array (max 10) of messages that will be displayed on the client-side.

### Public Files

Files in `./public/` will be available through the `/files/` endpoint as base64-encoded strings in a JSON object.

This feature is exclusively used for the `netvars.dat` file, which stores matchmaking information for the game and toggling of some features (such as the WBID option in menu and Hunter, Hunted mode).

### Default Save File

![Max level in-game](https://i.imgur.com/o2Ox5hb.png)

The default save file, `save.json`, is used for every client that connects to the server.

It's generated on first run, pulling from `defaultsave.json` in the root directory.

This file handles XP, levels, prestige, videos watched, tutorials, unlocks, loadouts, and game settings.

Players will automatically unlock Steam achievements when playing a match or prestiging, be careful.

The default json file provides all unlocks, max xp, and tutorial completion.

Ideally, this file should be kept persistent for players so their progress is saved.

However, there isn't a good way to identify players, so players will always be reset. See below.

### Database

The server uses a SQLite database to store user information.

Users are currently saved per-session. Next time they log in, they will lose their progress.

On server restart, the database will be wiped. This is because player save data is not persistent yet.

### Matchmaking

Matchmaking is exclusively handled by Steam from observation.

A Steam lobby hosted on the same internet connection between players was tested, and the game was able to connect to it.

Testing over the internet results in a permanent loading screen, more testing may be required.

#### OAuth

This server does not re-implement Fireteam OAuth and its ticket system.

Instead, it generates per-session UUIDs determined by the ticket and a master key.

This UUID is used to authenticate the user when saving data to the database.

### Security

The only security measure implemented is a private key used to seed UUIDs.

No other security measures are implemented, and the server is not intended to be used in a production environment.

## Configuration

After first run, a `config.json` file will be generated in the root directory.

Set options in this file to configure the server and its command line output.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the [MIT License](https://choosealicense.com/licenses/mit/).
