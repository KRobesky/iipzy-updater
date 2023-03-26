/*
iipzy-updater.
  For updating iipzy npm modules.

  There are four iipzy related folders under the home directory:
    ~iipzy-service-a
    ~iipzy-service-b
    ~iipzy-updater-a
    ~iipzy-updater-b

  Plus
    /etc/iipzy/iipzy-updater-config

  The purpose of the of iipzy-service-a and iipzy-service-b folders is to provide a means to stage an upgrade 
  while maintaining a running copy of the service.  The same purpose holds for iipzy-updater-a and
  iipzy-updater-b folders.

  There are also two /etc/systemd/system service files:
    iipzy-pi-a.service
    iipzy-pi-b.service

    Each points to the corresponding ~iipzy-service-[a|b] folder.

  There are also two service files for iipzy-updater:
    iipzy-updater-a.service
    iipzy-updater-b.service
 
    Each points to the corresponding ~iipzy-updater-[a|b] folder.

    This allows the updater to be updated independently of the iipzy-pi service

  The updater service sends a updater-heartbeat request to the iipzy-server.   This occurs every 20 seconds;
  the time period is controlled by the server.

  If an upgrade is indicated, by the response to the updater-heartbeat request, the following happens:

    1.  The iipzy-service-a or iipzy-service-b folder that is not currently in use, is removed, and a new, 
        empty, folder is created in its place.  For sake of discussion, let's say iipzy-service-b is the 
        folder where the install takes place.

    2.  Using credentials returned in the updater-heartbeat response, updater git clones the following folders:
          cd ~/iipzy-service-b
          git clone http://.../iipzy-shared.git
          git clone http://.../iipzy-client-shared.git
          git clone http://.../iipzy-pi.git

    3.  The three new folders are npm installed
          cd ~/iipzy-service-b/iipzy-shared
          npm i
          cd ~/iipzy-service-b/iipzy-client-shared
          npm i
          cd ~/iipzy-service-b/iipzy-pi
          npm i

    4.  The currenty running iipzy-pi service is stopped

          systemctl stop iipzy-pi-a

    5.  The newly installed iipzy-pi service is started

          systemctl start iipzy-pi-b

    6.  ...TODO... more info.
*/
const express = require("express");
const app = express();
const http_ = require("http");
const fs = require("fs");

const Defs = require("iipzy-shared/src/defs");
const { log, logInit, setLogLevel } = require("iipzy-shared/src/utils/logFile");
const logPath = process.platform === "win32" ? "c:/temp/" : "/var/log/iipzy";
logInit(logPath, "iipzy-updater");
const http = require("iipzy-shared/src/services/httpService");
const { ConfigFile } = require("iipzy-shared/src/utils/configFile");
const { set_os_id } = require("iipzy-shared/src/utils/globals");
const { spawnAsync } = require("iipzy-shared/src/utils/spawnAsync");
const { processErrorHandler, sleep } = require("iipzy-shared/src/utils/utils");

const { updaterInit } = require("./backgroundServices/updater");
const {
  updaterHeartbeatInit
} = require("./backgroundServices/updaterHeartbeat");

require("./startup/routes")(app);

const userDataPath = "/etc/iipzy";
let configFile = null;

let serverAddress = undefined;
let clientToken = undefined;
let logLevel = undefined;

let server = null;

// function createServer() {
//   try {
//     const port = 8003;
//     server = https
//       .createServer(
//         {
//           key: fs.readFileSync(__dirname + "/certificate/server.key"),
//           cert: fs.readFileSync(__dirname + "/certificate/server.cert")
//         },
//         app
//       )
//       .listen(port, () => {
//         log(`Listening on port ${port}...`, "strt");
//       });
//   } catch (ex) {
//     log("(Exception) main: " + ex, "strt", "info");
//     return false;
//   }
//   return true;
// }

let createServerTries = 6;
function createServer() {
  log("createServer", "strt", "info");
  const port = 8003;
  // server = https
  //   .createServer(
  //     {
  //       key: fs.readFileSync(__dirname + "/certificate/server.key"),
  //       cert: fs.readFileSync(__dirname + "/certificate/server.cert")
  //     },
  //     app
  //   )
  //   .listen(port, () => {
  //     log(`Listening on port ${port}...`, "strt");
  //   })

  server = http_
    .createServer(app)
    .listen(port, () => {
      log(`Listening on port ${port}...`, "main", "info");
    })
    .on("error", async err => {
      log("(Exception) createServer: code = " + err.code, "strt", "info");
      if (err.code === "EADDRINUSE") {
        // port is currently in use
        createServerTries--;
        if (createServerTries === 0) {
          log(
            "main: too many createServer failures. Exiting in 5 seconds",
            "strt",
            "info"
          );
          await sleep(5 * 1000);
          process.exit(0);
        }
        // try again in 5 seconds.
        await sleep(5 * 1000);
        createServer();
      }
    });
}

async function main() {
  configFile = new ConfigFile(userDataPath, Defs.configFilename);
  await configFile.init();

  serverAddress = configFile.get("serverAddress");
  http.setBaseURL(serverAddress);

  clientToken = configFile.get("clientToken");

  logLevel = configFile.get("logLevel");
  if (logLevel) setLogLevel(logLevel);
  else configFile.set("logLevel", "info");

  const { stdout, stderr } = await spawnAsync("os-id", []);
  if (stderr)
      log("(Error) os-id: stderr = " + stderr, "preq", "error");
  else
  {
    log("main: os_id = " + stdout, "preq", "info");
    set_os_id(stdout);
  }

  configFile.watch(configWatchCallback);

  await updaterHeartbeatInit(configFile);
  await updaterInit();

  createServer();
}

processErrorHandler();

main();

function configWatchCallback() {
  log("configWatchCallback", "main", "info");

  // handle server address change.
  const serverAddress_ = configFile.get("serverAddress");
  if (serverAddress_ !== serverAddress) {
    log(
      "configWatchCallback: serverAddress change: old = " +
        serverAddress +
        ", new = " +
        serverAddress_,
      "main",
      "info"
    );

    if (serverAddress_) {
      serverAddress = serverAddress_;
      http.setBaseURL(serverAddress);
    }
  }

  clientToken_ = configFile.get("clientToken");
  if (clientToken_ !== clientToken) {
    log(
      "configWatchCallback: clientToken change: old = " +
        clientToken +
        ", new = " +
        clientToken_,
      "main",
      "info"
    );

    if (clientToken_) {
      clientToken = clientToken_;
      http.setClientTokenHeader(clientToken);
    }
  }

  // handle log level change.
  const logLevel_ = configFile.get("logLevel");
  if (logLevel_ !== logLevel) {
    log(
      "configWatchCallback: logLevel change: old = " +
        logLevel +
        ", new = " +
        logLevel_,
      "main",
      "info"
    );
  }
  if (logLevel_) {
    // tell log.
    logLevel = logLevel_;
    setLogLevel(logLevel);
  }
}

// process.on("uncaughtException", function(err) {
//   log("(Exception) uncaught exception: " + err, "strt", "error");
//   log("stopping in 2 seconds", "strt", "info");
//   setTimeout(() => {
//     process.exit(1);
//   }, 2 * 1000);
// });

module.exports = server;
