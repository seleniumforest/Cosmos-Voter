const crypto = require("@cosmjs/crypto");
const stargate = require("@cosmjs/stargate");
const { getClient, getConfig, getRewards, getBalance, intervals, shortAddress } = require("./helpers");
const { MsgWithdrawDelegatorReward } = require("cosmjs-types/cosmos/distribution/v1beta1/tx");
const { MsgDelegate } = require("cosmjs-types/cosmos/staking/v1beta1/tx");
const { processEvmosWallet } = require("./restakeEvmos");
const config = getConfig();

const claim = async (network, client, addr) => {
    let {
        minRestakeAmount,
        claimFee,
        denom: restakeDenom
    } = network.restakeOptions;

    let delegations = await getRewards(network.lcdUrl, addr);
    let totalRewards = delegations.reduce((acc, del) =>
        Number(del.reward.find(rew => rew.denom === restakeDenom)?.amount) + acc, 0);

    if (totalRewards <= minRestakeAmount) {
        console.log([
            `restakeJob ${shortAddress(addr)}`,
            ` totalRewards ${totalRewards.toFixed(2)} < minRestakeAmount ${minRestakeAmount}`
        ].join(''));
        return;
    }

    let feeAmount = claimFee.amount.find(am => am.denom === restakeDenom).amount;
    let totalClaimFee = {
        gas: (claimFee.gas * delegations.length).toString(),
        amount: [
            {
                denom: restakeDenom,
                amount: (feeAmount * delegations.length).toString()
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

    console.log(`restakeJob ${shortAddress(addr)} claimed ${totalRewards.toFixed(2)}`);
    return {
        totalRewards,
        validator: delegations[0].validator_address
    };
}

const stake = async (network, client, addr, validator) => {
    let {
        delegateFee,
        denom: restakeDenom,
        minWalletBalance
    } = network.restakeOptions;

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

    console.log(`restakeJob ${shortAddress(addr)} restaked ${restakeAmount.toFixed(2)}`);
}

const processWallet = async (wallet, network) => {
    let derivationPaths = wallet.indexes
        .map(x => crypto.stringToPath(network.derivationPath + x.toString()));

    let client = await getClient(network.rpcUrl, wallet.mnemonic, derivationPaths, network.prefix);
    let addresses = await client.wallet.getAccounts();

    for (let { address } of addresses) {
        try {
            let claimed = await claim(network, client, address);
            if (!claimed)
                continue;

            await stake(network, client, address, claimed.validator);
        }
        catch (err) { console.error(err?.message) }
    }
}

const main = () => {
    console.log(`${new Date().toLocaleString()} Running restake job`);

    Promise.all(config.networks.flatMap(network => {
        return config.wallets.map(w => {
            if (network.prefix === "evmos")
                return processEvmosWallet(w, network);
            else
                return processWallet(w, network);
        })
    })).then(() => console.log("finished"));
};

main();
setInterval(main, intervals.day);