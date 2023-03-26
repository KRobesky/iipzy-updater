const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { ConfigFile } = require("iipzy-shared/src/utils/configFile");
const Defs = require("iipzy-shared/src/defs");
const {
  fileExistsAsync,
  fileReadAsync,
  fileStatAsync
} = require("iipzy-shared/src/utils/fileIO");
const { get_os_id } = require("iipzy-shared/src/utils/globals");
const http = require("iipzy-shared/src/services/httpService");
const { log } = require("iipzy-shared/src/utils/logFile");

let configFile = null;

let exec = null;
let execTimeout = null;
let execError = "";
let updateStatus = { inProgress: false, step: "done", failed: false };
let os_id = "";

let versionInfo = {
  iipzyPi: {},
  iipzySentinelAdmin: {},
  iipzySentinelWeb: {},
  iipzyUpdater: {}
};

async function updaterInit() {
  log(">>>updaterInit", "updt", "info");

  configFile = new ConfigFile(
    "/home/pi/iipzy-updater-config",
    "iipzyUpdaterConfig"
  );
  await configFile.init();

  os_id = get_os_id();

  let serviceSuffix = configFile.get("iipzyPiSuffix");
  if (!serviceSuffix) serviceSuffix = "a";
  versionInfo.iipzyPi = await getIipzyPiVersionInfo(serviceSuffix);

  serviceSuffix = configFile.get("iipzySentinelAdminSuffix");
  if (!serviceSuffix) serviceSuffix = "a";
  versionInfo.iipzySentinelAdmin = await getIipzySentinelAdminVersionInfo(
    serviceSuffix
  );

  serviceSuffix = configFile.get("iipzySentinelWebSuffix");
  if (!serviceSuffix) serviceSuffix = "a";
  versionInfo.iipzySentinelWeb = await getIipzySentinelWebVersionInfo(
    serviceSuffix
  );

  serviceSuffix = configFile.get("iipzyUpdaterSuffix");
  if (!serviceSuffix) serviceSuffix = "a";
  versionInfo.iipzyUpdater = await getIipzyUpdaterVersionInfo(serviceSuffix);

  log("updaterInit: " + JSON.stringify(versionInfo, null, 2), "updt", "info");
  await sendUpdateVersionInfo();
  sendUpdateStatus();

  log("<<<updaterInit", "updt", "info");
}

async function getIipzyPiVersionInfo(serviceSuffix) {
  log("getIipzyPiVersionInfo: suffix = " + serviceSuffix, "updt", "info");
  // iipzy Sentinel
  let version = null;
  let sharedVersion = null;

  let packageDotJson = null;

  const baseDir = "/home/pi/iipzy-service-" + serviceSuffix;

  packageDotJson = JSON.parse(
    await fileReadAsync(baseDir + "/iipzy-pi/package.json")
  );
  if (packageDotJson) version = packageDotJson.version;
  packageDotJson = JSON.parse(
    await fileReadAsync(baseDir + "/iipzy-shared/package.json")
  );
  if (packageDotJson) sharedVersion = packageDotJson.version;
  const stat = await fileStatAsync(baseDir + "/iipzy-pi/package.json");
  return {
    version,
    sharedVersion,
    updateTime: Math.round(stat.ctimeMs)
  };
}

async function getIipzySentinelAdminVersionInfo(serviceSuffix) {
  log(
    "getIipzySentinelAdminVersionInfo: suffix = " + serviceSuffix,
    "updt",
    "info"
  );
  // iipzySentinelAdmin
  let version = null;
  let sharedVersion = null;

  let packageDotJson = null;

  const baseDir = "/home/pi/iipzy-sentinel-admin-" + serviceSuffix;

  packageDotJson = JSON.parse(
    await fileReadAsync(baseDir + "/iipzy-sentinel-admin/package.json")
  );
  if (packageDotJson) version = packageDotJson.version;
  packageDotJson = JSON.parse(
    await fileReadAsync(baseDir + "/iipzy-shared/package.json")
  );
  if (packageDotJson) sharedVersion = packageDotJson.version;
  const stat = await fileStatAsync(
    baseDir + "/iipzy-sentinel-admin/package.json"
  );
  return {
    version,
    sharedVersion,
    updateTime: Math.round(stat.ctimeMs)
  };
}

async function getIipzySentinelWebVersionInfo(serviceSuffix) {
  log(
    "getIipzySentinelWebVersionInfo: suffix = " + serviceSuffix,
    "updt",
    "info"
  );
  // iipzySentinelWeb
  let version = null;
  let sharedVersion = null;

  let packageDotJson = null;

  const baseDir = "/home/pi/iipzy-sentinel-web-" + serviceSuffix;

  packageDotJson = JSON.parse(
    await fileReadAsync(baseDir + "/iipzy-sentinel-web/package.json")
  );
  if (packageDotJson) version = packageDotJson.version;
  packageDotJson = JSON.parse(
    await fileReadAsync(baseDir + "/iipzy-shared/package.json")
  );
  if (packageDotJson) sharedVersion = packageDotJson.version;
  const stat = await fileStatAsync(
    baseDir + "/iipzy-sentinel-web/package.json"
  );
  return {
    version,
    sharedVersion,
    updateTime: Math.round(stat.ctimeMs)
  };
}

async function getIipzyUpdaterVersionInfo(serviceSuffix) {
  log("getIipzyUpdaterVersionInfo: suffix = " + serviceSuffix, "updt", "info");
  // iipzyUpdater
  let version = null;
  let sharedVersion = null;

  let packageDotJson = null;

  const baseDir = "/home/pi/iipzy-updater-" + serviceSuffix;

  packageDotJson = JSON.parse(
    await fileReadAsync(baseDir + "/iipzy-updater/package.json")
  );
  if (packageDotJson) version = packageDotJson.version;
  packageDotJson = JSON.parse(
    await fileReadAsync(baseDir + "/iipzy-shared/package.json")
  );
  if (packageDotJson) sharedVersion = packageDotJson.version;
  const stat = await fileStatAsync(baseDir + "/iipzy-updater/package.json");
  return {
    version,
    sharedVersion,
    updateTime: Math.round(stat.ctimeMs)
  };
}

function doExecHelper(command, params, options, timeoutMins, callback) {
  // ip -j -4  addr show dev eth0
  log(
    "exec: command = " +
      command +
      ", params = " +
      JSON.stringify(params) +
      ", options = " +
      JSON.stringify(options),
    "updt",
    "info"
  );

  execError = "";

  exec = spawn(command, params, options);
  if (!exec) {
    execError = "spawn failed";
    return callback(1);
  }

  execTimeout = setTimeout(() => {
    if (exec) {
      log("(Error) exec timeout", "updt", "info");
      execError = "operation cancelled after " + timeoutMins + " minutes";
      exec.kill(9);
    }
  }, timeoutMins * 60 * 1000);

  exec.stdout.on("data", data => {
    const str = data.toString();
    log("stdout: " + str, "updt", "info");
  });

  exec.stderr.on("data", data => {
    const str = data.toString();
    log("stderr: " + str, "updt", "info");
    execError = str;
  });

  exec.on("exit", code => {
    log(`${command} exited with code ${code}`, "updt", "info");
    exec = null;
    clearTimeout(execTimeout);
    execTimeout = null;
    callback(code);
  });
}

// returns true if success, false if not.
function doExec(command, params, options, timeoutMins) {
  return new Promise((resolve, reject) => {
    doExecHelper(command, params, options, timeoutMins, code => {
      resolve(code !== undefined && code !== null && code === 0);
    });
  });
}

//??TODO send to server
async function setUpdateStatus(step) {
  updateStatus.step = step;
  updateStatus.timestamp = new Date().toLocaleString();
  if (step === "done") updateStatus.inProgress = false;
  await sendUpdateStatus();
}

//TODO send to server
function setUpdateStatusFailed() {
  updateStatus.failed = true;
  updateStatus.timestamp = new Date().toLocaleString();
  updateStatus.error = execError;
  updateStatus.inProgress = false;
}

async function updateIipzyPi(credentials) {
  return updateHelper(
    credentials,
    "iipzy-pi",
    "iipzyPiSuffix",
    "/home/pi/iipzy-service-",
    ["iipzy-shared", "iipzy-pi"],
    async serviceSuffix => {
      versionInfo.iipzyPi = await getIipzyPiVersionInfo(serviceSuffix);
    }
  );
}

async function updateIipzySentinelAdmin(credentials) {
  return updateHelper(
    credentials,
    "iipzy-sentinel-admin",
    "iipzySentinelAdminSuffix",
    "/home/pi/iipzy-sentinel-admin-",
    ["iipzy-shared", "iipzy-sentinel-admin"],
    async serviceSuffix => {
      versionInfo.iipzySentinelAdmin = await getIipzySentinelAdminVersionInfo(
        serviceSuffix
      );
    }
  );
}

async function updateIipzySentinelWeb(credentials) {
  // install serve if necessary.
  if (!(await fileExistsAsync("/usr/bin/serve"))) {
    setUpdateStatus("installing serve");
    if (!(await doExec("sudo", ["npm", "i", "serve", "-g"], {}, 40)))
      return setUpdateStatusFailed();
  }

  return updateHelper(
    credentials,
    "iipzy-sentinel-web",
    "iipzySentinelWebSuffix",
    "/home/pi/iipzy-sentinel-web-",
    ["iipzy-shared", "iipzy-sentinel-web"],
    async serviceSuffix => {
      versionInfo.iipzySentinelWeb = await getIipzySentinelWebVersionInfo(
        serviceSuffix
      );
    },
    true // doBuild
  );
}

async function updateIipzyUpdater(credentials) {
  return updateHelper(
    credentials,
    "iipzy-updater",
    "iipzyUpdaterSuffix",
    "/home/pi/iipzy-updater-",
    ["iipzy-shared", "iipzy-updater"],
    async serviceSuffix => {
      versionInfo.iipzyUpdater = await getIipzyUpdaterVersionInfo(
        serviceSuffix
      );
    },
    false,
    true // seppukuStopOldService
  );
}

/*
  modules = ["iipzy-shared", "iipzy-pi"]
*/

async function updateHelper(
  credentials,
  serviceName,
  configFileKey,
  baseDir_,
  modules,
  updateVersionInfoCB,
  doBuild,
  seppukuStopOldService
) {
  log(
    "update " +
      serviceName +
      " - credentials: " +
      credentials +
      ", configKey: " +
      configFileKey +
      ", baseDir: " +
      baseDir_ +
      ", modules: " +
      JSON.stringify(modules) +
      ", seppuku: " +
      seppukuStopOldService,
    "updt",
    "info"
  );

  let oldServiceSuffix = configFile.get(configFileKey);
  log("---update oldServiceSuffix = " + oldServiceSuffix);
  if (!oldServiceSuffix) oldServiceSuffix = "a";
  const newServiceSuffix = oldServiceSuffix === "a" ? "b" : "a";
  const baseDir = baseDir_ + newServiceSuffix;
  log(
    serviceName +
      ": oldServiceSuffix = " +
      oldServiceSuffix +
      ", newServiceSuffix = " +
      newServiceSuffix,
    "updt",
    "info"
  );

  updateStatus.target = baseDir;
  setUpdateStatus("removing old " + baseDir);
  if (!(await doExec("rm", ["-r", "-f", baseDir], {}, 10)))
    return setUpdateStatusFailed();

  // create baseDir
  setUpdateStatus("creating new " + baseDir);
  if (!(await doExec("mkdir", [baseDir], {}, 10)))
    return setUpdateStatusFailed();

  // credentials look like. "http://<username>:<password>@<url>/Bonobo.Git.Server/"

  // install modules
  for (let i = 0; i < modules.length; i++) {
    const module = modules[i];
    // clone
    setUpdateStatus("cloning " + module);
    if (
      !(await doExec(
        "git",
        ["clone", credentials + module + ".git"],
        {
          cwd: baseDir
        },
        40
      ))
    )
      return setUpdateStatusFailed();

    // disable package-lock
    setUpdateStatus("disabling " + module + " package-lock");
    if (
      !(await doExec(
        "npm",
        ["config", "set", "package-lock", "false"],
        {
          cwd: baseDir + "/" + module
        },
        5
      ))
    )
      return setUpdateStatusFailed();

    // install
    setUpdateStatus("installing " + module);
    if (
      !(await doExec(
        "npm",
        ["i"],
        {
          cwd: baseDir + "/" + module
        },
        40
      ))
    )
      return setUpdateStatusFailed();
  }

  const oldServiceName = serviceName + "-" + oldServiceSuffix;
  const newServiceName = serviceName + "-" + newServiceSuffix;

  // npm run build if necessary
  if (doBuild) {
    setUpdateStatus("building " + newServiceName);
    if (
      !(await doExec(
        "npm",
        ["run", "build"],
        {
          cwd: baseDir + "/" + serviceName
        },
        60
      ))
    )
      return setUpdateStatusFailed();
  }

  // check for old service
  setUpdateStatus("checking old service " + oldServiceName);
  const oldServiceExists = await doExec(
    "sudo",
    ["systemctl", "status", oldServiceName],
    {},
    5
  );

  if (oldServiceExists) {
    // stop old service
    if (!seppukuStopOldService) {
      setUpdateStatus("stopping old service " + oldServiceName);
      if (
        !(await doExec("sudo", ["systemctl", "stop", oldServiceName], {}, 10))
      )
        return setUpdateStatusFailed();
    }

    // disable old service
    setUpdateStatus("disabling old service " + oldServiceName);
    if (
      !(await doExec("sudo", ["systemctl", "disable", oldServiceName], {}, 10))
    ) {
      // roll back
      await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

      return setUpdateStatusFailed();
    }
  }

  /*
  [
    "cp",
    "/home/pi/iipzy-service-a/src/extraResources/iipzy-pi-a.service",
    "/etc/systemd/system/."
  ],
    (options = {});
  */

  // copy new service file
  setUpdateStatus("copying new service file for " + newServiceName);
  let newServiceNameOSSpecific = newServiceName
  if (os_id === "openwrt") {
    newServiceNameOSSpecific += "-openwrt";
  }

  const copyCmdFrom =
    baseDir +
    "/" +
    serviceName +
    "/src/extraResources/" +
    newServiceNameOSSpecific +
    ".service";
  let copyCmdTo;
  if (os_id === "openwrt") {
    copyCmdTo = "/etc/init.d/" + newServiceName + ".service";
  } else {
    copyCmdTo = "/etc/systemd/system/.";
  }
  
  if (!(await doExec("sudo", ["cp", copyCmdFrom, copyCmdTo], {}, 10))) {
    // roll back
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return setUpdateStatusFailed();
  }

  // daemon-reload
  setUpdateStatus("executing daemon-reload on services");
  if (!(await doExec("sudo", ["systemctl", "daemon-reload"], {}, 10))) {
    // roll back
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return setUpdateStatusFailed();
  }

  // enable new service
  setUpdateStatus("enabling new service " + newServiceName);
  if (
    !(await doExec("sudo", ["systemctl", "enable", newServiceName], {}, 10))
  ) {
    // roll back
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return setUpdateStatusFailed();
  }

  // start new service
  setUpdateStatus("starting new service " + newServiceName);
  if (!(await doExec("sudo", ["systemctl", "start", newServiceName], {}, 10))) {
    // roll back
    await doExec("sudo", ["systemctl", "disable", newServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return setUpdateStatusFailed();
  }

  // get status of new service
  setUpdateStatus("get status of new service " + newServiceName);
  if (
    !(await doExec("sudo", ["systemctl", "status", newServiceName], {}, 10))
  ) {
    // roll back
    await doExec("sudo", ["systemctl", "stop", newServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "disable", newServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return setUpdateStatusFailed();
  }

  // update config file
  await configFile.set(configFileKey, newServiceSuffix);

  await updateVersionInfoCB(newServiceSuffix);

  await sendUpdateVersionInfo();

  await setUpdateStatus("done");

  // NB: special case for updater.  Updater cannot be stopped during update.
  if (oldServiceExists && seppukuStopOldService) {
    log("stopping old service - Seppuku!", "updt", "info");
    setUpdateStatus("stopping old service " + oldServiceName);
    if (!(await doExec("sudo", ["systemctl", "stop", oldServiceName], {}, 10)))
      return setUpdateStatusFailed();
  }
}

function update(updateParams) {
  log(
    "update - updateStatus: " + JSON.stringify(updateStatus, null, 2),
    "updt",
    "info"
  );

  if (updateStatus.step !== "done" && !updateStatus.failed)
    return { status: Defs.statusUpdateInProgress };

  updateStatus = {
    inProgress: true,
    step: "starting",
    startTimestamp: new Date().toLocaleString(),
    timestamp: new Date().toLocaleString(),
    updateType: updateParams.updateType,
    updateUuid: updateParams.updateUuid,
    target: "",
    failed: false
  };

  sendUpdateStatus();

  switch (updateParams.updateType) {
    case "iipzy-pi": {
      updateIipzyPi(updateParams.credentials);
      break;
    }
    case "iipzy-sentinel-admin": {
      updateIipzySentinelAdmin(updateParams.credentials);
      break;
    }
    case "iipzy-sentinel-web": {
      updateIipzySentinelWeb(updateParams.credentials);
      break;
    }
    case "iipzy-updater": {
      updateIipzyUpdater(updateParams.credentials);
      break;
    }
    default:
      return { status: Defs.statusInvalidUpdateType };
  }
  return { status: Defs.statusOk };
}

async function sendUpdateStatus() {
  log("sendUpdateStatus: " + updateStatus.step, "updt", "info");
  const { data, status } = await http.post("/updater/status", {
    data: {
      updateStatus
    }
  });
}

async function sendUpdateVersionInfo() {
  log(
    "sendUpdateVersionInfo: " + JSON.stringify(versionInfo, null, 2),
    "updt",
    "info"
  );
  const { data, status } = await http.post("/updater/versioninfo", {
    data: {
      versionInfo
    }
  });
}

function getUpdateStatus() {
  return updateStatus;
}

function getVersionInfo() {
  return versionInfo;
}

module.exports = { getUpdateStatus, getVersionInfo, update, updaterInit };
