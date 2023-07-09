// A TLSv1 server, must run on nodejs v8.5.0 alongside index.js (on v20.3.1)
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("./usercfg/config.json"));
const tls = require('tls');

let server = tls.createServer({
    key: fs.readFileSync(`./usercfg/${config.host.https_key}`),
    cert: fs.readFileSync(`./usercfg/${config.host.https_cert}`),
    ciphers: "DEFAULT:@SECLEVEL=0",
    requestCert: true,
    rejectUnauthorized: true
}, socket => {
    console.log("WEB: Client connected");
});
let listening = server.listen(config.host.https_port, () => {
    if(config.debug)
        console.log(`WEB: Listening on port ${config.host.https_port}`);
});
listening.on("tlsClientError", err => {
    if(config.debug)
        console.error(err);
});
