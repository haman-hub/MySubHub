// bot/utils/ton.js
const TonWeb = require('tonweb');
const tonweb = new TonWeb(new TonWeb.HttpProvider('https://toncenter.com/api/v2/jsonRPC', {
  apiKey: process.env.TONCENTER_API_KEY
}));

/**
 * Verify a payment transaction sent to the admin wallet.
 * @param {string} boc - Signed transaction BOC from TON Connect.
 * @param {string} expectedAddress - Admin wallet in raw form (e.g., UQ...)
 * @param {number} expectedAmount - Amount in nanoTON.
 * @param {string} expectedMemo - Memo string expected.
 * @returns {object} { success, txHash, message }
 */
async function verifyPayment(boc, expectedAddress, expectedAmount, expectedMemo) {
  try {
    const cell = TonWeb.boc.Cell.oneFromBoc(TonWeb.utils.base64ToBytes(boc));
    const extMsg = await tonweb.contracts.createExternalMessage(cell);
    const result = await tonweb.provider.sendBocReturnHash(boc);
    const txHash = result; // hex string

    // Wait for transaction to appear
    await new Promise(resolve => setTimeout(resolve, 8000));

    const txList = await tonweb.provider.getTransactions(expectedAddress, 5);
    const tx = txList.find(t => t.transaction_id.hash === txHash);
    if (!tx) {
      const latest = txList[0];
      if (!latest) throw new Error('No transaction found');
      if (latest.in_msg) {
        const inMsg = latest.in_msg;
        const destination = inMsg.destination;
        const value = inMsg.value;
        const msgBody = inMsg.message;

        let comment = '';
        try {
          const bodyCell = TonWeb.boc.Cell.oneFromBoc(TonWeb.utils.base64ToBytes(msgBody));
          let slice = bodyCell.beginParse();
          let op = slice.loadUint(32);
          if (op === 0) {
            comment = slice.loadStringTail();
          }
        } catch (e) {}

        if (destination !== expectedAddress ||
            value !== expectedAmount.toString() ||
            comment !== expectedMemo) {
          return { success: false, message: 'Transaction details do not match' };
        }
        return { success: true, txHash: txHash || latest.transaction_id.hash };
      }
      return { success: false, message: 'No incoming message detected' };
    }
    return { success: true, txHash };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function payout(address, amountNano) {
  // Placeholder for actual payout using admin wallet private key
  return null;
}

module.exports = { verifyPayment, payout };