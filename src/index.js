/*
iipzy-updater.
  For updating iipzy npm modules.

  There are eight iipzy related folders under the /home/pi directory:
    iipzy-sentinel-admin-a
    iipzy-sentinel-admin-b
    iipzy-sentinel-web-a
    iipzy-sentinel-web-b
    iipzy-service-a
    iipzy-service-b
    iipzy-updater-a
    iipzy-updater-b

  The purpose of the of "-a" and "-b" folders is to provide a means to stage an upgrade 
  while maintaining a running copy of the service.

  There are also eight /etc/init.d/ or /etc/systemd/system service files:
    iipzy-sentinel-admin-a.service
    iipzy-sentinel-admin-b.service
    iipzy-sentinel-web-a.service
    iipzy-sentinel-web-b.service
    iipzy-pi-a.service
    iipzy-p-b.service
    iipzy-updater-a.service
    iipzy-updater-b.service

    Each points to the corresponding /home/pi/...-[a|b] folder.

  The updater service sends a updater-heartbeat request to the iipzy-server.   This occurs every 20 seconds;
  the time period is controlled by the server.

  If an upgrade is indicated, by the response to the updater-heartbeat request, the following happens:

    1.  The selection of the "-a" or "-b" folder to install to is determined as follows: if a folder is empty,
        that folder is used, otherwise the folder with the older contents is used.

    2.  The contents of the folder selected for installation is removed, and a new, empty, folder is created in its place.  
        
        For sake of discussion, let's say iipzy-service-b is the folder where the install takes place.

    3.  Using credentials returned in the updater-heartbeat response, updater git clones the following folders:
          cd ~/iipzy-service-b
          git clone http://.../iipzy-shared.git
          git clone http://.../iipzy-pi.git

    4.  The two new folders are npm installed
          cd ~/iipzy-service-b/iipzy-shared
          npm i
          cd ~/iipzy-service-b/iipzy-pi
          npm i

    5.  The currenty running iipzy-pi service is stopped and disabled

          systemctl stop iipzy-pi-a

    6.  The newly installed iipzy-pi service is enabled and started

          systemctl start iipzy-pi-b

    7.  If the update fails, the service for the newly installed version is stopped and disabled.  
        The service for the previous version is enabled and started.
        The newly installed folders are deleted.

    For iipzy-sentinel-web, the runnable build directory from iipzy-sentinel-web-build is cloned.
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
