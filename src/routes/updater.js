const express = require("express");
const router = express.Router();

const Defs = require("iipzy-shared/src/defs");
const { log, timestampToString } = require("iipzy-shared/src/utils/logFile");

const {
  update,
  getUpdateStatus,
  getVersionInfo
} = require("../backgroundServices/updater");

router.get("/", async (req, res) => {
  log(
    "GET - updater: timestamp = " +
      timestampToString(req.header("x-timestamp")),
    "rout",
    "info"
  );

  const data = {
    versionInfo: getVersionInfo(),
    updateStatus: getUpdateStatus()
  };

  log(
    "GET updater: response = " + JSON.stringify(data, null, 2),
    "rout",
    "info"
  );

  res.status(Defs.httpStatusOk).send(data);
});

// request from client.
// router.post("/", async (req, res) => {
//   log(
//     "POST - updater: timestamp = " +
//       timestampToString(req.header("x-timestamp")),
//     "rout",
//     "info"
//   );
//   log("POST - updater: " + JSON.stringify(req.body, null, 2), "rout", "info");

//   const updateRequest = req.body;
//   if (!updateRequest || !updateRequest.params)
//     return res
//       .status(Defs.httpStatusBadRequest)
//       .send({ data: "update params" });
//   if (!updateRequest.params.credentials)
//     return res
//       .status(Defs.httpStatusBadRequest)
//       .send({ data: "missing credentials" });
//   if (!updateRequest.params.updateType)
//     return res
//       .status(Defs.httpStatusBadRequest)
//       .send({ data: "missing update type" });
//   if (!updateRequest.params.updateUuid)
//     return res
//       .status(Defs.httpStatusBadRequest)
//       .send({ data: "missing update uuid" });

//   const data = await update(updateRequest.params);
//   res.status(Defs.httpStatusOk).send({ data });
// });

module.exports = router;
