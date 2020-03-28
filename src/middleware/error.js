const { log } = require("iipzy-shared/src/utils/logFile");

module.exports = function(err, req, res, next) {
  log(err.message, "error ", "midl", "error");
  res.status(500).send("Somthing failed.");
};
