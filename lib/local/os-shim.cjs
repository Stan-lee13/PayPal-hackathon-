// The in-browser gateway bundles code written for Node (PayPal's Agent Toolkit names the operating system in its
// User-Agent). In a tab there is no operating system to name, so this answers "browser".
module.exports = { platform: () => "browser", release: () => "", arch: () => "", type: () => "Browser", homedir: () => "/", tmpdir: () => "/tmp", hostname: () => "localhost", cpus: () => [], EOL: "\n" };
