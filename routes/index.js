const express = require("express");
const asyncHandler = require("express-async-handler");
const twitch = require("../api/twitch");

const router = express.Router();

router.get("/", (req, res, next) => {
  res.render("index");
});

router.post("/", asyncHandler(async (req, res, next) => {
  if (!req.body?.username) { res.redirect("/"); }
  const { username } = req.body; // TODO validate form data
  try {
    const user = await twitch.getUser(username);
    res.render("index", { user });
  } catch (error) {
    if (error.status === 404) {
      res.render("index", { error });
    } else {
      throw error;
    }
  }
}));

module.exports = router;
