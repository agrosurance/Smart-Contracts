const fs = require("fs")

// Loads environment variables from .env.enc file (if it exists)
require("@chainlink/env-enc").config()

const Location = {
  Inline: 0,
  Remote: 1,
}

const CodeLanguage = {
  JavaScript: 0,
}

const ReturnType = {
  uint: "uint256",
  uint256: "uint256",
  int: "int256",
  int256: "int256",
  string: "string",
  bytes: "Buffer",
  Buffer: "Buffer",
}

// Configure the request by setting the fields below
const requestConfig = {
  // Location of source code (only Inline is currently supported)
  codeLocation: Location.Inline,
  // Code language (only JavaScript is currently supported)
  codeLanguage: CodeLanguage.JavaScript,
  // String containing the source code to be executed
  source: fs.readFileSync("./calculate-premium.js").toString(),
  //source: fs.readFileSync('./API-request-example.js').toString(),
  // Secrets can be accessed within the source code with `secrets.varName` (ie: secrets.apiKey). The secrets object can only contain string values.
  secrets: {
    POSITIONSTACK_API_KEY: process.env.POSITIONSTACK_API_KEY ?? "",
    WEATHER_API_KEY: process.env.WEATHER_API_KEY ?? "",
  },
  // Per-node secrets objects assigned to each DON member. When using per-node secrets, nodes can only use secrets which they have been assigned.
  perNodeSecrets: [],
  // ETH wallet key used to sign secrets so they cannot be accessed by a 3rd party
  walletPrivateKey: process.env["PRIVATE_KEY"],
  // Args (string only array) can be accessed within the source code with `args[index]` (ie: args[0]).
  args: ["27175255", "78009816", "Maize", "1000000000000000000000", "1686307629"],
  // Expected type of the returned value
  expectedReturnType: ReturnType.uint256,
  // Redundant URLs which point to encrypted off-chain secrets
  secretsURLs: [
    "https://gist.githubusercontent.com/yashgo0018/b60de01cec5e11e2f5f5b03007d8a013/raw/08413bd12f9d564331073c8dc9b9a65ecd439192/offchain-secrets.json",
  ],
}

module.exports = requestConfig
