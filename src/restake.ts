import { ApiManager } from "./api/apiManager";
import { Network } from "./api/constants";
import { getConfig, NetworkConfig, Wallet, toFeeObject } from "./config";
import { getSigner, Intervals, shortAddress } from "./helpers";
import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet as HdWallet } from "@cosmjs/proto-signing";
import { MsgWithdrawDelegatorReward } from "cosmjs-types/cosmos/distribution/v1beta1/tx";
import big from "big.js";
import { EndpointType } from "./api/networkManager";
import { assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx";

const claim = async (network: NetworkConfig, address: string, manager: ApiManager, wallet: HdWallet) => {
    let {
        minRestakeAmount,
        denom: restakeDenom
    } = network.restakeOptions;
    let claimFee = toFeeObject(network.restakeOptions.claimFee);

    let delegations = await manager.getRewards(address);
    let totalRewards = delegations.reduce((acc, del) => {
        return big(del.reward.find(rew => rew.denom === restakeDenom)!.amount).plus(acc)
    }, big(0));

    if (totalRewards.lte(minRestakeAmount)) {
        console.log([
            `restakeJob ${shortAddress(address)}`,
            ` totalRewards ${totalRewards.toFixed(2)} < minRestakeAmount ${minRestakeAmount}`
        ].join(''));
        return;
    }

    let feeAmount = big(claimFee.amount.find(am => am.denom === restakeDenom)!.amount);
    let totalClaimFee = {
        gas: (big(claimFee.gas).mul(delegations.length)).toString(),
        amount: [
            {
                denom: restakeDenom,
                amount: (feeAmount.mul(delegations.length)).toString()
            }
        ]
    };

    let claimmsgs = delegations.map(d => ({
        typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        value: MsgWithdrawDelegatorReward.fromPartial({
            delegatorAddress: address,
            validatorAddress: d.validator_address
        })
    }));

    let endpoints = manager.manager.getEndpoints(EndpointType.RPC);
    for (let endp of endpoints) {
        let signer = await getSigner(endp, wallet);
        let claimResult = await signer.signAndBroadcast(address, claimmsgs, totalClaimFee);
        assertIsDeliverTxSuccess(claimResult);

        console.log(`restakeJob ${shortAddress(address)} claimed ${totalRewards.toFixed(2)}`);
        return {
            totalRewards: totalRewards.toString(),
            validator: delegations[0].validator_address
        };
    }
}

const stake = async (network: NetworkConfig, address: string, manager: ApiManager, wallet: HdWallet, claimed: { totalRewards: string, validator: string }) => {
    let {
        denom: restakeDenom,
        minWalletBalance
    } = network.restakeOptions;
    let delegateFee = toFeeObject(network.restakeOptions.delegateFee);

    let balance = big(await manager.getBalance(address, restakeDenom) || 0);

    let restakeAmount = balance.minus(big(minWalletBalance));
    if (restakeAmount.lt(big(0))) {
        console.error("restakeJob restakeAmount < 0");
        return;
    }

    let restakeMsg = {
        typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
        value: MsgDelegate.fromPartial({
            delegatorAddress: address,
            validatorAddress: claimed.validator,
            amount: {
                denom: restakeDenom,
                amount: restakeAmount.toString()
            }
        })
    }


    let endpoints = manager.manager.getEndpoints(EndpointType.RPC);
    for (let endp of endpoints) {
        let signer = await getSigner(endp, wallet);
        let result = await signer.signAndBroadcast(address, [restakeMsg], delegateFee);
        if (result.code === 0) {
            console.log(`restakeJob ${shortAddress(address)} restaked ${restakeAmount.toFixed(2)}`);
            return;
        }
        
        console.log(`restakeJob ${shortAddress(address)} error code ${result.code}`);
    }
}

const processWallet = async (network: NetworkConfig, wallet: Wallet, apiManager: ApiManager) => {
    let derivationPaths = wallet.indexes.map(x => stringToPath(network.derivationPath + x));
    let walletObj = await HdWallet.fromMnemonic(wallet.mnemonic, { hdPaths: derivationPaths, prefix: network.prefix });
    let addresses = await walletObj.getAccounts();

    for (let { address } of addresses) {
        try {
            let claimed = await claim(network, address, apiManager, walletObj);
            if (!claimed)
                continue;

            await stake(network, address, apiManager, walletObj, claimed);
        }
        catch (err: any) { console.error(err?.message) }
    }
}

const main = async () => {
    console.log(`${new Date().toLocaleString()} Running restake job`);
    let config = await getConfig();

    for (let network of config.networks) {
        let apiManager = await ApiManager.createApiManager(network.name as Network);

        for (let wallet of config.wallets) {
            if (network.name === Network.EVMOS)
                continue;
            else
                await processWallet(network, wallet, apiManager);
        }
    }
};

main();
setInterval(main, Intervals.day);