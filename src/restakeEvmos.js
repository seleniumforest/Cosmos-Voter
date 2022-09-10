const { Wallet } = require("@ethersproject/wallet");
const { createTxMsgWithdrawDelegatorReward, createTxMsgDelegate } = require("@tharsis/transactions");
const {
    broadcast,
    signTransaction,
} = require("@hanchon/evmos-ts-wallet");
const { ethToEvmos } = require('@tharsis/address-converter');
const { Big } = require("big.js");
const { getSenderChaindata, getRewards, getBalance, shortAddress } = require("./helpers");

exports.processEvmosWallet = async (wallet, network) => {
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
    let minRestakeAmount = new Big(restakeOpts.minRestakeAmount);
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
        let totalRewards = delegations.reduce((acc, del) => {
            let amount = del.reward.find(rew => rew.denom === restakeDenom)?.amount;
            //if !amount then redelegate to another validator
            if (!amount)
                return acc;

            return new Big(amount).plus(acc);
        }, new Big(0));

        if (totalRewards.lte(minRestakeAmount)) {
            console.log(`restakeJob address ${shortAddress(addr)} totalRewards ${totalRewards.toFixed(2)} < minRestakeAmount ${minRestakeAmount}`);
            continue;
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
                console.log(`restakeJob account ${shortAddress(addr)} claimed ${claimedAmount.toFixed(2)}`);
            else
                console.error(`evmos claim error: ${JSON.stringify(broadcastRes)}`);

            await new Promise(res => setTimeout(res, 5000));
        }

        //delegate section
        let balance = new Big(await getBalance(network.lcdUrl, addr, restakeOpts.denom));
        let restakeAmount = balance.minus(new Big(restakeOpts.minWalletBalance));

        let delegateParams = {
            validatorAddress: delegations[0].validator_address,
            amount: restakeAmount.toString(),
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
            console.log(`restakeJob account ${shortAddress(addr)} restaked ${restakeAmount.toFixed(2)}`);
        else
            console.error(`evmos restaking error: ${JSON.stringify(broadcastRes)}`)

    }
}