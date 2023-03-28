const Defs = require("iipzy-shared/src/defs");
const http = require("iipzy-shared/src/services/httpService");
const { log } = require("iipzy-shared/src/utils/logFile");
const { sleep } = require("iipzy-shared/src/utils/utils");

const { getUpdateStatus, getVersionInfo, update } = require("./updater");

let configFile = null;
let clientToken = null;

async function updaterHeartbeatInit(configFile_) {
  log("updaterHeartbeatInit", "htbt", "info");

  configFile = configFile_;

  setTimeout(async () => {
    updaterHeartbeat();
  }, 20 * 1000);

  //await updaterHeartbeat_helper();
}

async function updaterHeartbeat() {
  while (true) {
    const res = await updaterHeartbeat_helper();
    log("after calling updateHeartbeat_helper: res = " + res, "htbt", "info");
    if (!res) await sleep(20 * 1000);
  }
}

let inUpdaterHeartbeatHelper = false;

async function updaterHeartbeat_helper() {
  try {
    log(">>>updaterHeartbeat_helper", "htbt", "info");
    if (inUpdaterHeartbeatHelper) return true;

    inUpdaterHeartbeatHelper = true;
    if (!clientToken) {
      clientToken = configFile.get("clientToken");
      if (clientToken) http.setClientTokenHeader(clientToken);
      // no client token yet.
      else return false;
    }

    log("updaterHeartbeat: sending heartbeat", "htbt", "info");
    const { data: updateResponse, status: statusResponse } = await http.post(
      "/updater/heartbeat",
      {
        data: {
          versionInfo: getVersionInfo(),
          updateStatus: getUpdateStatus()
        }
      }
    );
    log(
      "updaterHeartbeat: AFTER sending heartbeat: status = " + statusResponse + ", response = " + JSON.stringify(updateResponse, null, 2),
      "htbt",
      "info"
    );

    if (updateResponse && updateResponse.starting) {
      await update(updateResponse.params);
    }

    return statusResponse === Defs.httpStatusOk;
  } catch(ex) {
    log("Exception) updaterHeartbeat_helper: " + ex, "updt", "error");
  } finally {
    inUpdaterHeartbeatHelper = false;
    log("<<<updaterHeartbeat_helper", "updt", "info");    
  }
}

module.exports = { updaterHeartbeatInit };
