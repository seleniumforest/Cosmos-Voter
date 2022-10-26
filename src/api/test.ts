// import { Block, Indexer } from ".";
// import { ApiManager } from "./apiManager";
// import { RecieveData, Network } from "./constants";

// //todo make jest tests
// Indexer
//     .create()
//     .addNetwork(Network.COSMOS)
//     .recieve(RecieveData.HEADERS_AND_TRANSACTIONS, (block: Block) => {
//         console.log(block);
//     })
//     .run();

// (async () => { 
//     let m = await ApiManager.createApiManager(Network.COSMOS);
//     let p = await m.getActiveProposals();
//     if (p !== null) {
//         let t = await m.getVoteTally(p[0].proposal_id);
//         console.log(t)
//     }

//     console.log(p);
   
// })();
