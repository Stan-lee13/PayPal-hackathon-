// PayPal's Agent Toolkit is published as CommonJS and calls require("axios"). Requiring it the same way
// here yields the very instance the toolkit uses, so the gateway can decide what that instance may send.
module.exports = require("axios");
