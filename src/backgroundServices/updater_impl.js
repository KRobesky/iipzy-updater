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
const { sleep } = require("iipzy-shared/src/utils/utils");

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

    /*
  configFile = new ConfigFile(
    //"/home/pi/iipzy-updater-config",
    "/etc/iipzy",
    "iipzyUpdaterConfig"
  );
  await configFile.init();
  */

  os_id = get_os_id();

  versionInfo.iipzyPi = await getIipzyPiVersionInfo();
  versionInfo.iipzySentinelAdmin = await getIipzySentinelAdminVersionInfo();
  versionInfo.iipzySentinelWeb = await getIipzySentinelWebVersionInfo();
  versionInfo.iipzyUpdater = await getIipzyUpdaterVersionInfo();
  log("updaterInit: " + JSON.stringify(versionInfo, null, 2), "updt", "info");

  await sendUpdateVersionInfo();
  await sendUpdateStatus();

  log("<<<updaterInit", "updt", "info");
}

function isEmpty(object) {
  return (JSON.stringify(object) === '{}');
}

async function getServiceSuffixes(service) {
  log("getServiceSuffixes: service = " + service, "updt", "info");

  const baseDir = "/home/pi/" + service + "-";
  // e.g.: /home/pi/iipzy-sentinel-admin-",
  log("getServiceSuffixes: baseDir = " + baseDir, "updt", "info");
  const stat_a = await fileStatAsync(baseDir + "a");
  log("getServiceSuffixes - stat_a: " + JSON.stringify(stat_a, null, 2), "updt", "info");
  const stat_b = await fileStatAsync(baseDir + "b");
  log("getServiceSuffixes - stat_b: " + JSON.stringify(stat_b, null, 2), "updt", "info");
  let stat_a_timestampEpoch = 0;
  if (!isEmpty(stat_a)) stat_a_timestampEpoch = stat_a.birthtimeMs;
  let stat_b_timestampEpoch = 0;
  if (!isEmpty(stat_b)) stat_b_timestampEpoch = stat_b.birthtimeMs;
  log("getServiceSuffixes: a_ts = " + stat_a_timestampEpoch + ", b_ts = " + stat_b_timestampEpoch, "updt", "info");
  return {
    curServiceSuffix : (stat_a_timestampEpoch > stat_b_timestampEpoch) ? "a" : "b",
    nextServiceSuffix : (stat_a_timestampEpoch > stat_b_timestampEpoch) ? "b" : "a"
  }
}

async function getServiceVersionInfo(service, modules) {
  log("getServiceVersionInfo: service = " + service + ", modules = " + JSON.stringify(modules), "updt", "info");
  
  let version = null;
  let sharedVersion = null;
  let updateTime = null;

  try{
  const suffixes = await getServiceSuffixes(service);
    log("getServiceVersionInfo: suffixes = " + JSON.stringify(suffixes));

    const baseDir = "/home/pi/" + service + "-" + suffixes.curServiceSuffix + "/";
    log("getServiceVersionInfo: baseDir = " + baseDir, "updt", "info");
    // e.g. /home/pi/iipzy-service-a

    for (let i = 0; i < modules.length; i++) {
      const modulePath = baseDir + modules[i] + "/package.json";
      //e.g.,  /home/pi/iipzy-service-a/iipzy-pi/packages.json
      log("getServiceVersionInfo: modulePath = " + modulePath, "updt", "info");  
      
      const packageDotJson = JSON.parse(await fileReadAsync(modulePath));
      if (packageDotJson) {
        if (modulePath.includes("shared"))
          sharedVersion = packageDotJson.version;
        else {
          version = packageDotJson.version;
          try {
            const stat = await fileStatAsync(modulePath);
            updateTime = Math.round(stat.ctimeMs);
          } catch (ex) {}
        } 
      }
    }
  } catch (ex) {
    log( "(Exception) getServiceVersionInfo: " + ex);
  }

  log( "getServiceVersionInfo: version = " + version + ", sharedVersion = " + sharedVersion);

  return {
    version,
    sharedVersion,
    updateTime
  };
}


async function getIipzyPiVersionInfo() {
  log("getIipzyPiVersionInfo", "updt", "info");
   // iipzy Sentinel
  return await getServiceVersionInfo("iipzy-service", ["iipzy-pi", "iipzy-shared"]);
}

async function getIipzySentinelAdminVersionInfo() {
  log("getIipzySentinelAdminVersionInfo", "updt", "info");
  // iipzySentinelAdmin
  return await getServiceVersionInfo("iipzy-sentinel-admin", ["iipzy-sentinel-admin", "iipzy-shared"]);
}

async function getIipzySentinelWebVersionInfo() {
  log("getIipzySentinelWebVersionInfo", "updt", "info");
  // iipzySentinelWeb
  return await getServiceVersionInfo("iipzy-sentinel-web", ["iipzy-sentinel-web", "iipzy-shared"]);
}

async function getIipzyUpdaterVersionInfo(serviceSuffix) {
  log("getIipzyUpdaterVersionInfo", "updt", "info");
  // iipzyUpdater
  return await getServiceVersionInfo("iipzy-updater", ["iipzy-updater", "iipzy-shared"]);
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

async function setUpdateStatus(step) {
  updateStatus.step = step;
  updateStatus.timestamp = new Date().toLocaleString();
  if (step === "done") updateStatus.inProgress = false;
  await sendUpdateStatus();
}

//TODO send to server
async function setUpdateStatusFailed() {
  updateStatus.failed = true;
  updateStatus.timestamp = new Date().toLocaleString();
  updateStatus.error = execError;
  updateStatus.inProgress = false;
  await sendUpdateStatus();
}

async function updateIipzyPi(credentials) {
  return await updateHelper(
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
  return await updateHelper(
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
  /*
  // install serve if necessary.
  if (!(await fileExistsAsync("/usr/bin/serve"))) {
    setUpdateStatus("installing serve");
    if (!(await doExec("sudo", ["npm", "i", "serve", "-g"], {}, 40)))
      return setUpdateStatusFailed();
  }
  */

  return await updateHelper(
    credentials,
    "iipzy-sentinel-web",
    "iipzySentinelWebSuffix",
    "/home/pi/iipzy-sentinel-web-",
    ["iipzy-sentinel-web"],
    async serviceSuffix => {
      versionInfo.iipzySentinelWeb = await getIipzySentinelWebVersionInfo(
        serviceSuffix
      );
    },
    true // skipNpmInit
  );
}

async function updateIipzyUpdater(credentials) {
  return await updateHelper(
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
  skipNpmInit,
  seppukuStopOldService
) {
  log(
    "updateHelper " +
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

  // determine target of update
  const suffixes = await getServiceSuffixes(serviceName);
  const oldServiceSuffix = suffixes.curServiceSuffix;
  const newServiceSuffix = suffixes.nextServiceSuffix;

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
  await setUpdateStatus("removing old " + baseDir);
  if (!(await doExec("rm", ["-r", "-f", baseDir], {}, 10)))
    return await setUpdateStatusFailed();

  // create baseDir
  await setUpdateStatus("creating new " + baseDir);
  if (!(await doExec("mkdir", [baseDir], {}, 10)))
    return await setUpdateStatusFailed();

  // credentials look like. "http://<username>:<password>@<url>/Bonobo.Git.Server/"

  // install modules
  for (let i = 0; i < modules.length; i++) {
    const module = modules[i];
    // clone
    await setUpdateStatus("cloning " + module);
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
      return await setUpdateStatusFailed();

    // disable package-lock
    await setUpdateStatus("disabling " + module + " package-lock");
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
      return await setUpdateStatusFailed();

    // install
    if (!skipNpmInit) {
      await setUpdateStatus("installing " + module);
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
        return await setUpdateStatusFailed();
    }
  }

  const oldServiceName = serviceName + "-" + oldServiceSuffix;
  const newServiceName = serviceName + "-" + newServiceSuffix;

    /*
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
  */

  // check for old service
  await setUpdateStatus("checking old service " + oldServiceName);
  const oldServiceExists = await doExec(
    "sudo",
    ["systemctl", "status", oldServiceName],
    {},
    5
  );

  if (oldServiceExists) {
    // stop old service
    if (!seppukuStopOldService) {
      await setUpdateStatus("stopping old service " + oldServiceName);
      if (
        !(await doExec("sudo", ["systemctl", "stop", oldServiceName], {}, 10))
      )
        return await setUpdateStatusFailed();
    }

    // disable old service
    await setUpdateStatus("disabling old service " + oldServiceName);
    if (
      !(await doExec("sudo", ["systemctl", "disable", oldServiceName], {}, 10))
    ) {
      // roll back
      await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

      return await setUpdateStatusFailed();
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
  await setUpdateStatus("copying new service file for " + newServiceName);
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

    return await setUpdateStatusFailed();
  }

  // daemon-reload
  await setUpdateStatus("executing daemon-reload on services");
  if (!(await doExec("sudo", ["systemctl", "daemon-reload"], {}, 10))) {
    // roll back
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return await setUpdateStatusFailed();
  }

  // enable new service
  await setUpdateStatus("enabling new service " + newServiceName);
  if (
    !(await doExec("sudo", ["systemctl", "enable", newServiceName], {}, 10))
  ) {
    // roll back
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return await setUpdateStatusFailed();
  }

  // start new service
  await setUpdateStatus("starting new service " + newServiceName);
  if (!(await doExec("sudo", ["systemctl", "start", newServiceName], {}, 10))) {
    // roll back
    await doExec("sudo", ["systemctl", "disable", newServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return await setUpdateStatusFailed();
  }

  // get status of new service
  await setUpdateStatus("get status of new service " + newServiceName);
  if (
    !(await doExec("sudo", ["systemctl", "status", newServiceName], {}, 10))
  ) {
    // roll back
    await doExec("sudo", ["systemctl", "stop", newServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "disable", newServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "enable", oldServiceName], {}, 10);
    await doExec("sudo", ["systemctl", "start", oldServiceName], {}, 10);

    return await setUpdateStatusFailed();
  }

  /*
  // update config file
  await configFile.set(configFileKey, newServiceSuffix);
  */

  await updateVersionInfoCB(newServiceSuffix);

  await sendUpdateVersionInfo();

  await setUpdateStatus("done");

  // NB: special case for updater.  Updater cannot be stopped during update.
  if (oldServiceExists && seppukuStopOldService) {
    log("stopping old service - Seppuku!", "updt", "info");
    await setUpdateStatus("stopping old service " + oldServiceName);
    if (!(await doExec("sudo", ["systemctl", "stop", oldServiceName], {}, 10)))
      return await setUpdateStatusFailed();
  }
}

async function update(updateParams) {
  log(
    "update - updateParams: " + JSON.stringify(updateParams, null, 2),
    "updt",
    "info"
  );
  log(
    "update - updateStatus: " + JSON.stringify(updateStatus, null, 2),
    "updt",
    "info"
  );

  if (updateStatus.step !== "done" && !updateStatus.failed)
    return { status: Defs.statusUpdateInProgress };

  log("update - starting", "updt", "info");

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

  await sendUpdateStatus();

  switch (updateParams.updateType) {
    case "iipzy-pi": {
      await updateIipzyPi(updateParams.credentials);
      break;
    }
    case "iipzy-sentinel-admin": {
      await updateIipzySentinelAdmin(updateParams.credentials);
      break;
    }
    case "iipzy-sentinel-web": {
      await updateIipzySentinelWeb(updateParams.credentials);
      break;
    }
    case "iipzy-updater": {
      await updateIipzyUpdater(updateParams.credentials);
      break;
    }
    default:
      return { status: Defs.statusInvalidUpdateType };
  }
  return { status: Defs.statusOk };
}

async function sendUpdateStatus() {
  log("sendUpdateStatus: " + JSON.stringify(updateStatus, null, 2), "updt", "info");
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
  log("getUpdateStatus: " + JSON.stringify(updateStatus, null, 2), "updt", "info");
  return updateStatus;
}

function getVersionInfo() {
  return versionInfo;
}

module.exports = { getUpdateStatus, getVersionInfo, update, updaterInit };
