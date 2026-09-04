// utils/ton.js
const TonWeb = require('tonweb');

async function verifyPayment(boc, expectedAddress, expectedAmountNano, expectedMemo) {
  try {
    const tonweb = new TonWeb(new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC', {
      apiKey: process.env.TONCENTER_API_KEY
    }));

    // 1. Send BOC to get transaction hash
    const result = await tonweb.provider.sendBocReturnHash(boc);
    const txHash = result; // result is a string hash

    // 2. Poll for the transaction until it appears or timeout
    const maxAttempts = 10;
    const delayMs = 2000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));

      const txInfo = await tonweb.provider.getTransactions(expectedAddress, 10);
      const txs = txInfo || [];

      const tx = txs.find(t => t.transaction_id.hash === txHash);
      if (tx && tx.in_msg) {
        const inMsg = tx.in_msg;

        // Parse addresses as raw hex (0:...) for comparison
        const expectedRaw = TonWeb.utils.Address.parse(expectedAddress).toRawString();
        const destRaw = TonWeb.utils.Address.parse(inMsg.destination).toRawString();

        // Compare amounts (as strings)
        const expectedAmountStr = expectedAmountNano.toString();
        const receivedAmountStr = inMsg.value.toString();

        if (destRaw === expectedRaw && receivedAmountStr === expectedAmountStr) {
          return { success: true, txHash };
        }
        return { success: false, error: 'Amount or destination mismatch' };
      }
    }
    return { success: false, error: 'Transaction not found or too many attempts' };
  } catch (e) {
    console.error('Payment verification error:', e);
    return { success: false, error: e.message };
  }
}

module.exports = { verifyPayment };
