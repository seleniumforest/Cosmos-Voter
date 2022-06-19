const axios = require("axios");
const config = require("../config.json");
const crypto = require("@cosmjs/crypto");
const stargate = require("@cosmjs/stargate");
const { createLogger, getClient } = require("./helpers");
const { MsgWithdrawDelegatorReward } = require("cosmjs-types/cosmos/distribution/v1beta1/tx");
const { MsgDelegate } = require("cosmjs-types/cosmos/staking/v1beta1/tx");

const log = createLogger("restake.log");

const getBalance = async (lcdUrl, address, denom) => {
    let balanceUrl = `${lcdUrl}/cosmos/bank/v1beta1/balances/${address}`;
    let balances = (await axios.get(balanceUrl)).data.balances;
    return balances?.find(x => x.denom === denom)?.amount
}

const getRewards = async (lcdUrl, address) => {
    let rewardsUrl = `${lcdUrl}/cosmos/distribution/v1beta1/delegators/${address}/rewards`;
    let rewards = (await axios.get(rewardsUrl)).data.rewards;
    return rewards;
}

const processWallet = async (wallet, network) => {
    let derivationPaths = wallet
        .indexes
        .map(x => crypto.stringToPath(network.derivationPath + x));
    let client = await
        getClient(network.rpcUrl, wallet.mnemonic, derivationPaths, network.prefix);
    let addresses = (await client.wallet.getAccounts()).map(addr => addr.address);
    let restakeOpts = network.restakeOptions;
    let minRestakeAmount = restakeOpts.minRestakeAmount;
    let restakeDenom = restakeOpts.denom;
    let claimFee = restakeOpts.claimFee;
    let delegateFee = restakeOpts.delegateFee;

    for (let addr of addresses) {
        let balance = Number(await getBalance(network.lcdUrl, addr, restakeOpts.denom));

        let delegations = await getRewards(network.lcdUrl, addr);
        let totalRewards = Number(delegations.reduce((acc, del) =>
            Number(del.reward.find(rew => rew.denom === restakeDenom)?.amount) + acc, 0));

        if (totalRewards <= minRestakeAmount) {
            log.info(`restakeJob address ${addr} totalRewards ${totalRewards} < minRestakeAmount ${minRestakeAmount}`);
            continue;
        }

        let totalClaimFee = {
            gas: (Number(claimFee.gas) * delegations.length).toString(),
            amount: [
                {
                    denom: restakeOpts.denom,
                    amount: (Number(claimFee.amount.find(am => am.denom === restakeDenom).amount) * delegations.length).toString()
                }
            ]
        };

        let claimmsgs = delegations.map(d => ({
            typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
            value: MsgWithdrawDelegatorReward.fromPartial({
                delegatorAddress: addr,
                validatorAddress: d.validator_address
            })
        }));

        stargate.assertIsDeliverTxSuccess(
            await client.signer.signAndBroadcast(addr, claimmsgs, totalClaimFee));

        log.info(`restakeJob account ${addr} claimed ${totalRewards}`);

        let restakeAmount = totalRewards + balance - restakeOpts.minWalletBalance;
        if (restakeAmount < 0) {
            log.error("restakeJob restakeAmount < 0");
            continue;
        }

        let restakeMsg = {
            typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
            value: MsgDelegate.fromPartial({
                delegatorAddress: addr,
                validatorAddress: delegations[0].validator_address,
                amount: {
                    denom: restakeDenom,
                    amount: Math.round(restakeAmount).toString()
                }
            })
        }

        stargate.assertIsDeliverTxSuccess(
            await client.signer.signAndBroadcast(addr, [restakeMsg], delegateFee));

        log.info(`restakeJob account ${addr} restaked ${restakeAmount}`);
    }
}

const main = async () => {
    let wallets = config.wallets;
    let networks = config.networks;

    if (!(wallets instanceof Array) || wallets.length === 0)
        log.error("no wallets found");
    if (!(networks instanceof Array) || networks.length === 0)
        log.error("no networks found");

    for (let n of networks) {
        for (let w of wallets)
            await processWallet(w, n);
    }
}

const _main = async () => {
    try {
        await main();
    }
    catch (e) {
        log.error(e);
    }
}

_main();
const hourMs = 60 * 60 * 1000;
const dayMs = hourMs * 24;
setInterval(_main, dayMs);