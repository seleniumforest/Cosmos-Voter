const axios = require("axios");
const crypto = require("@cosmjs/crypto");
const stargate = require("@cosmjs/stargate");
const { getClient, getConfig, getRewards, getBalance, intervals } = require("./helpers");
const { MsgWithdrawDelegatorReward } = require("cosmjs-types/cosmos/distribution/v1beta1/tx");
const { MsgDelegate } = require("cosmjs-types/cosmos/staking/v1beta1/tx");
const { processEvmosWallet } = require("./restakeEvmos");
const config = getConfig();

const claim = async (network, client, addr, claimFee, restakeDenom, minRestakeAmount) => {
    let delegations = await getRewards(network.lcdUrl, addr);
    let totalRewards = delegations.reduce((acc, del) =>
        Number(del.reward.find(rew => rew.denom === restakeDenom)?.amount) + acc, 0);

    if (totalRewards <= minRestakeAmount) {
        console.log(`restakeJob address ${addr} totalRewards ${totalRewards} < minRestakeAmount ${minRestakeAmount}`);
        return;
    }

    let totalClaimFee = {
        gas: (Number(claimFee.gas) * delegations.length).toString(),
        amount: [
            {
                denom: restakeDenom,
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

    let claimResult = await client.signer.signAndBroadcast(addr, claimmsgs, totalClaimFee);
    stargate.assertIsDeliverTxSuccess(claimResult);

    console.log(`restakeJob account ${addr} claimed ${totalRewards}`);
    return {
        totalRewards,
        validator: delegations[0].validator_address
    };
}

const stake = async (network, client, addr, delegateFee, restakeDenom, minWalletBalance, totalRewards, validator) => {
    let balance = Number(await getBalance(network.lcdUrl, addr, restakeDenom));

    let restakeAmount = balance - minWalletBalance;
    if (restakeAmount < 0) {
        console.error("restakeJob restakeAmount < 0");
        return;
    }

    let restakeMsg = {
        typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
        value: MsgDelegate.fromPartial({
            delegatorAddress: addr,
            validatorAddress: validator,
            amount: {
                denom: restakeDenom,
                amount: Math.round(restakeAmount).toString()
            }
        })
    }

    stargate.assertIsDeliverTxSuccess(
        await client.signer.signAndBroadcast(addr, [restakeMsg], delegateFee));

    console.log(`restakeJob account ${addr} restaked ${restakeAmount}`);
}

const processWallet = async (wallet, network) => {
    let derivationPaths = wallet.indexes
        .map(x => crypto.stringToPath(network.derivationPath + x.toString()));

    let client = await getClient(network.rpcUrl, wallet.mnemonic, derivationPaths, network.prefix);
    let addresses = await client.wallet.getAccounts();

    let {
        minRestakeAmount,
        denom: restakeDenom,
        claimFee,
        delegateFee,
        minWalletBalance
    } = network.restakeOptions;

    for (let addr of addresses.map(addr => addr.address)) {
        try {
            let clamed = await claim(network, client, addr, claimFee, restakeDenom, minRestakeAmount);
            if (!clamed)
                continue;
            await stake(network, client, addr, delegateFee, restakeDenom, minWalletBalance, clamed.totalRewards, clamed.validator);
        }
        catch (err) { console.error(err?.message )}
    }
}

let main = async () => {
    console.log(`${new Date().toLocaleString()} Running restake job`);

    for (let network of config.networks) {
        try {
            for (let w of config.wallets) {
                if (network.prefix === "evmos")
                    await processEvmosWallet(w, network);
                else
                    await processWallet(w, network);
            }
        }
        catch (e) {
            console.error(e);
        }
    }
};
main();
setInterval(main, intervals.day);