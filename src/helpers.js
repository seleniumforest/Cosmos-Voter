const sln = require('simple-node-logger');
const proto_signing = require("@cosmjs/proto-signing");
const { Registry } = require("@cosmjs/proto-signing");
const stargate = require("@cosmjs/stargate");

exports.createLogger = (filename) => {
    return sln.createSimpleLogger({
        logFilePath: filename,
        timestampFormat: 'MM-DD HH:MM'
    });
}

exports.getClient = async (rpc, mnemonic, hdPaths, prefix) => {
    const wallet = await proto_signing.DirectSecp256k1HdWallet.fromMnemonic(
        mnemonic,
        { hdPaths, prefix }
    );

    const signer = await stargate.SigningStargateClient.connectWithSigner(
        rpc,
        wallet,
        { registry: new Registry(stargate.defaultRegistryTypes) }
    );

    return { signer, wallet }
}