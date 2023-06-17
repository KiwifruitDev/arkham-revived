# arkham-wbid-local-server

Locally hosted Fireteam WBID server for Arkham Origins Online.

## Requirements

[Node.js](https://nodejs.org/en/) is required to run this server.

## Installation

Use the following commands to install and run the server.

```bash
git clone https://github.com/KiwifruitDev/arkham-wbid-local-server.git
cd arkham-wbid-local-server
npm install
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

### Public Files

Files in `./public/` will be available through the `/files/` endpoint as base64-encoded strings in a JSON object.

This feature is exclusively used for the `netvars.dat` file.

## Configuration

After first run, a `config.json` file will be generated in the root directory.

Set options in this file to configure the server its command line output.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the [MIT License](https://choosealicense.com/licenses/mit/).
