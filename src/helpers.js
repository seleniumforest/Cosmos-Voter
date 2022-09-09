const proto_signing = require("@cosmjs/proto-signing");
const { Registry } = require("@cosmjs/proto-signing");
const stargate = require("@cosmjs/stargate");
const { generateEndpointAccount } = require('@tharsis/provider');
const axios = require("axios");
const config = require("../config.json");

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

exports.getSenderChaindata = async (url, address) => {
    const options = {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    };

    let addrRaw = await axios.get(
        `${url}${generateEndpointAccount(address)}`,
        options
    );
    
    let baseAcc = addrRaw.data.account.base_account;
    return {
        accountAddress: baseAcc.address,
        sequence: baseAcc.sequence,
        accountNumber: baseAcc.account_number,
        pubkey: baseAcc.pub_key.key
    };
}

exports.getConfig = () => {
    return {
        ...config,
        networks: config.networks.map(net => require(net))
    }
}

exports.getBalance = async (lcdUrl, address, denom) => {
    let balanceUrl = `${lcdUrl}/cosmos/bank/v1beta1/balances/${address}`;
    let { data: { balances } } = await axios.get(balanceUrl);
    return balances?.find(x => x.denom === denom)?.amount
}

exports.getRewards = async (lcdUrl, address) => {
    let rewardsUrl = `${lcdUrl}/cosmos/distribution/v1beta1/delegators/${address}/rewards`;
    let rewards = (await axios.get(rewardsUrl)).data.rewards;
    return rewards;
}

let minute = 1000 * 60;
let hour = minute * 60;
let day = hour * 24;
exports.intervals = {
    minute, 
    hour,
    day
}