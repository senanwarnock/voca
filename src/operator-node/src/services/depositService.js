// File: src/services/depositService.js

const ethers = require('ethers');
const AccountTree = require('../utils/accountTree');
const treeHelper = require('../utils/treeHelper');
const { poseidon } = require('circomlibjs');
const abi = require('../utils/Rollup.json').abi;
const Account = require('../models/Account');
const { stringifyBigInts, unstringifyBigInts } = require('../utils/stringifybigint');

const privateKey = process.env.PRIVATE_KEY;
const provider = new ethers.WebSocketProvider(process.env.PROVIDER_URL);
const signer = new ethers.Wallet(privateKey, provider);

const txProvder = new ethers.JsonRpcProvider(process.env.DEPLOY_PROVIDER_URL);
const txSigner = new ethers.Wallet(privateKey, txProvder);
const depositTx = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, txSigner);

class DepositService {
    constructor(contractAddress, abi, accountTree) {
        this.contract = new ethers.Contract(contractAddress, abi, signer);
        this.pendingDeposits = [];
        this.subtreeHashes = [];
        this.accountIdx = 0;
        this.batchIdx = 0;
        this.BAL_DEPTH = 4;
        this.accountTree = accountTree;
        this.zeroCache = this.initializeZeroCache();
        this.listenForDepositEvents();
    }

    initializeZeroCache() {
        const zeroAccount = new Account();
        const zeroHash = zeroAccount.hashAccount();
        const numLeaves = 2 ** this.BAL_DEPTH;
        const zeroLeaves = new Array(numLeaves).fill(zeroAccount);
        const zeroTree = new AccountTree(zeroLeaves);
        console.log('zero root:', stringifyBigInts(zeroTree.root));
        let zeroCache = [stringifyBigInts(zeroHash)];
        for (let i = this.BAL_DEPTH - 1; i >= 0; i--) {
            zeroCache.unshift(stringifyBigInts(zeroTree.innerNodes[i][0]));
        }
        console.log('Initialized zeroCache:', zeroCache);
        return zeroCache;
    }



    listenForDepositEvents() {
        try {
            this.contract.on('RequestDeposit', (pubKey, amount, tokenType) => {
                console.log(`Deposit received: pubKey[${pubKey}], amount[${amount}], tokenType[${tokenType}]`);
                this.handleDeposit({ pubKey, amount, tokenType }).catch(console.error);
            });
        } catch (error) {
            console.error('Error occurred while listening for deposit events:', error);
        }
    }

    async handleDeposit({ pubKey, amount, tokenType }) {
        this.pendingDeposits.push({ pubKey, amount, tokenType });

        // Process in batches of 4 (for BAL_DEPTH of 4)
        if (this.pendingDeposits.length >= 4) {
            await this.processDepositsBatch();
        }
    }

    async processDepositsBatch() {

        const numLeaves = 2 ** this.BAL_DEPTH;

        const pendingDeposits = this.pendingDeposits.splice(0, 4);
        const pendingDepositsAccounts = [];
        const accounts = this.accountTree.accounts.slice(0, this.accountIdx);
        for (let i = 0; i < pendingDeposits.length; i++) {
            const { pubKey, amount, tokenType } = pendingDeposits[i];
            const acc = new Account(this.accountIdx++, pubKey[0], pubKey[1], Number(amount), 0, Number(tokenType));
            accounts[acc.index] = acc;
            pendingDepositsAccounts.push(acc);
        }
        const subtree = new AccountTree(pendingDepositsAccounts);
        const subtreeRoot = subtree.root;
        this.subtreeHashes.push(subtreeRoot);
        // after we have the proof, we should check the batch index to determine how many subtrees we need to fill
        // we should probably store each subtree hash in an array so we can progressively build the tree
        const subtreeProof = this.zeroCache.slice(1, this.BAL_DEPTH - Math.log2(4) + 1).reverse();
        if (this.batchIdx > 0) {
            for (let i = 0; i < this.batchIdx; i++) {
                subtreeProof[i] = this.subtreeHashes[i];
            }
        }
        const paddedAccounts = treeHelper.padArray(accounts, new Account(), numLeaves);
        console.log('root before processing deposits: ', this.accountTree.root.toString());
        console.log('contract root before: ', await depositTx.currentRoot());
        this.accountTree.accounts = paddedAccounts;
        this.accountTree.leafNodes = paddedAccounts.map(acc => acc.hashAccount());
        this.accountTree.innerNodes = this.accountTree.treeFromLeafNodes();
        this.accountTree.root = this.accountTree.innerNodes[0][0];
        console.log('accounts: ', this.accountTree.accounts);
        console.log('contract root1: ', await depositTx.currentRoot());
        const pos = treeHelper.idxToBinaryPos(this.batchIdx++, this.BAL_DEPTH - Math.log2(4));
        console.log('Processing deposits for batch:', this.batchIdx - 1, 'with pos:', pos, 'and subtreeProof:', subtreeProof);
        try {
            console.log('Processing deposits...');
            const txResponse = await depositTx.processDeposits(2, pos, subtreeProof, {gasLimit: 1000000});
            const txReceipt = await txResponse.wait();  // waits for the transaction to be mined
        
            if (txReceipt.status === 1) {
                console.log('Transaction successful:', txResponse.hash); // Correctly log the transaction hash from the response
                console.log('root from contract equals root calculated? : ', this.accountTree.root, await depositTx.currentRoot());
            } else {
                console.log('Transaction failed without throwing an error, receipt:', txReceipt);
            }
        } catch (error) {
            console.error('Error processing deposits:', error);
        }
        
    }


}



module.exports = DepositService;
