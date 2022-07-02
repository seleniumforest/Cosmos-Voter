const axios = require("axios");
const config = require("../config.json");
const crypto = require("@cosmjs/crypto");
const stargate = require("@cosmjs/stargate");
const { createLogger, getClient, getSenderChaindata } = require("./helpers");
const { MsgWithdrawDelegatorReward } = require("cosmjs-types/cosmos/distribution/v1beta1/tx");
const { MsgDelegate } = require("cosmjs-types/cosmos/staking/v1beta1/tx");
const { Wallet } = require("@ethersproject/wallet");
const { createTxMsgWithdrawDelegatorReward, createTxMsgDelegate } = require("@tharsis/transactions");
const {
    broadcast,
    signTransaction,
} = require("@hanchon/evmos-ts-wallet");
const { ethToEvmos } = require('@tharsis/address-converter');
const big = require("big.js");
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
        .map(x => crypto.stringToPath(network.derivationPath + x.toString()));

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

const processEvmosWallet = async (wallet, network) => {
    let wallets = wallet
        .indexes
        .map(index => {
            let derivationPath = network.derivationPath + index.toString();
            let ethWallet = Wallet.fromMnemonic(wallet.mnemonic, derivationPath);

            return {
                address: ethToEvmos(ethWallet.address),
                wallet: ethWallet
            };
        });

    //params section
    let restakeOpts = network.restakeOptions;
    let minRestakeAmount = restakeOpts.minRestakeAmount;
    let restakeDenom = restakeOpts.denom;

    let claimFee = {
        gas: restakeOpts.claimFee.gas,
        ...restakeOpts.claimFee.amount[0]
    }
    let chain = {
        chainId: 9001,
        cosmosChainId: "evmos_9001-2"
    };
    let delegatefee = {
        gas: restakeOpts.delegateFee.gas,
        ...restakeOpts.delegateFee.amount[0]
    }

    for (let wallet of wallets) {
        let addr = wallet.address;

        let delegations = await getRewards(network.lcdUrl, addr);
        let totalRewards = Number(delegations.reduce((acc, del) =>
            Number(del.reward.find(rew => rew.denom === restakeDenom)?.amount) + acc, 0));

        if (totalRewards <= minRestakeAmount) {
            log.info(`restakeJob address ${addr} totalRewards ${totalRewards} < minRestakeAmount ${minRestakeAmount}`);
            return;
        }

        let senderOnchainData;

        //claim delegations section
        for (let del of delegations) {
            senderOnchainData = await getSenderChaindata(network.lcdUrl, addr);
            let claimTx = createTxMsgWithdrawDelegatorReward(
                chain,
                senderOnchainData,
                claimFee, "",
                { validatorAddress: del.validator_address });
            let signedTx = await signTransaction(wallet.wallet, claimTx);
            let broadcastRes = await broadcast(signedTx, network.lcdUrl);
            let claimedAmount = del.reward.find(x => x.denom === restakeDenom)?.amount;
            if (broadcastRes?.tx_response?.code === 0) 
                log.info(`restakeJob account ${addr} claimed ${claimedAmount}`);
            else
                log.error(`evmos claim error: ${JSON.stringify(broadcastRes)}`);

            await new Promise(res => setTimeout(res, 5000));
        }

        //delegate section
        let balance = Number(await getBalance(network.lcdUrl, addr, restakeOpts.denom));
        let restakeAmount = big(balance).minus(restakeOpts.minWalletBalance).toString();

        let delegateParams = {
            validatorAddress: delegations[0].validator_address,
            amount: restakeAmount,
            denom: restakeDenom
        }

        senderOnchainData = await getSenderChaindata(network.lcdUrl, addr);
        let delegateTx = createTxMsgDelegate(chain,
            senderOnchainData,
            delegatefee,
            "",
            delegateParams);
        let deledateTxSigned = await signTransaction(wallet.wallet, delegateTx);
        let broadcastRes = await broadcast(deledateTxSigned, network.lcdUrl);
        if (broadcastRes?.tx_response?.code === 0)
            log.info(`restakeJob account ${addr} restaked ${restakeAmount}`);
        else
            log.error(`evmos restaking error: ${JSON.stringify(broadcastRes)}`)

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
        for (let w of wallets) {
            if (n.prefix === "evmos")
                await processEvmosWallet(w, n);
            else
                await processWallet(w, n);
        }
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