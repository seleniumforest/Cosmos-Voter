import { Wallet as EvmosWallet } from "@ethersproject/wallet";
import { createTxMsgWithdrawDelegatorReward, createTxMsgDelegate } from "@tharsis/transactions";
import {
    signTransaction,
} from "@hanchon/evmos-ts-wallet";
import { ethToEvmos } from '@tharsis/address-converter';
import { Big } from "big.js";
import { shortAddress } from "./helpers";
import { NetworkConfig, toEvmosFee, Wallet } from "./config";
import { ApiManager } from "./api/apiManager";
import big from "big.js";

export const processEvmosWallet = async (network: NetworkConfig, wallet: Wallet, apiManager: ApiManager) => {
    let wallets = wallet
        .indexes
        .map(index => {
            let derivationPath = network.derivationPath + index.toString();
            let ethWallet = EvmosWallet.fromMnemonic(wallet.mnemonic, derivationPath);

            return {
                address: ethToEvmos(ethWallet.address),
                wallet: ethWallet
            };
        });

    //params section
    let restakeOpts = network.restakeOptions;
    let minRestakeAmount = new Big(restakeOpts.minRestakeAmount);
    let restakeDenom = restakeOpts.denom;
    let claimFee = toEvmosFee(restakeOpts.claimFee);

    let chain = {
        chainId: 9001,
        cosmosChainId: "evmos_9001-2"
    };

    let delegatefee = toEvmosFee(restakeOpts.delegateFee);

    for (let wallet of wallets) {
        let addr = wallet.address;
        let delegations = await apiManager.getRewards(addr);
        let totalRewards = delegations.reduce((acc, del) => {
            let amount = del.reward.find(rew => rew.denom === restakeDenom)?.amount;
            //if !amount then redelegate to another validator
            if (!amount)
                return acc;

            return big(amount).plus(acc)
        }, big(0));

        if (totalRewards.lte(minRestakeAmount)) {
            console.log(`restakeJob address ${shortAddress(addr)} totalRewards ${totalRewards.toFixed(2)} < minRestakeAmount ${minRestakeAmount}`);
            continue;
        }

        let senderOnchainData;

        //claim delegations section
        for (let del of delegations) {
            senderOnchainData = await apiManager.getSenderChaindata(addr);
            let claimTx = createTxMsgWithdrawDelegatorReward(
                chain,
                senderOnchainData,
                claimFee, 
                "",
                { validatorAddress: del.validator_address });
            let signedTx = await signTransaction(wallet.wallet, claimTx);
            let broadcastRes = await apiManager.broadcastTx(JSON.parse(signedTx).tx_bytes);
            let claimedAmount = del.reward.find(x => x.denom === restakeDenom)?.amount!;
            if (!claimedAmount)
                continue;

            if (broadcastRes.code === 0)
                console.log(`restakeJob account ${shortAddress(addr)} claimed ${new Big(claimedAmount).toFixed(2)}`);
            else
                console.error(`evmos claim error: ${JSON.stringify(broadcastRes)}`);

            await new Promise(res => setTimeout(res, 5000));
        }

        //delegate section
        let balanceAfterClaim = await apiManager.getBalance(addr, restakeDenom);
        if (!balanceAfterClaim)
            Promise.reject(`Cannot get balance on ${addr}`);

        let balance = new Big(balanceAfterClaim || 0);
        let restakeAmount = balance.minus(new Big(restakeOpts.minWalletBalance));

        let delegateParams = {
            validatorAddress: delegations[0].validator_address,
            amount: restakeAmount.toString(),
            denom: restakeDenom
        }

        senderOnchainData = await apiManager.getSenderChaindata(addr);
        let delegateTx = createTxMsgDelegate(chain,
            senderOnchainData,
            delegatefee,
            "",
            delegateParams);
        let deledateTxSigned = await signTransaction(wallet.wallet, delegateTx);
        let broadcastRes = await apiManager.broadcastTx(JSON.parse(deledateTxSigned).tx_bytes);
        if (broadcastRes.code === 0)
            console.log(`restakeJob account ${shortAddress(addr)} restaked ${restakeAmount.toFixed(2)}`);
        else
            console.error(`evmos restaking error code: ${broadcastRes.code}`)

    }
}