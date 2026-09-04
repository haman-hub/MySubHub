// utils/ton.js
const TonWeb = require('tonweb');

async function verifyPayment(boc, expectedAddress, expectedAmountNano, expectedMemo) {
  try {
    const tonweb = new TonWeb(new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC', {
      apiKey: process.env.TONCENTER_API_KEY
    }));

    console.log('Verifying payment:');
    console.log('Expected address:', expectedAddress);
    console.log('Expected amount (nano):', expectedAmountNano.toString());

    // 1. Send BOC to get transaction hash
    const txHash = await tonweb.provider.sendBocReturnHash(boc);
    console.log('Transaction hash:', txHash);

    // 2. Poll for the transaction (max 15 attempts, 2 sec each = 30 sec)
    const maxAttempts = 15;
    const delayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));

      const txs = await tonweb.provider.getTransactions(expectedAddress, 10);
      if (!txs || !txs.length) continue;

      const tx = txs.find(t => t.transaction_id.hash === txHash);
      if (!tx || !tx.in_msg) continue;

      const inMsg = tx.in_msg;

      // Parse addresses to raw hex for comparison
      const expectedRaw = TonWeb.utils.Address.parse(expectedAddress).toRawString();
      const destRaw = TonWeb.utils.Address.parse(inMsg.destination).toRawString();

      console.log('Found transaction:');
      console.log('Destination raw:', destRaw);
      console.log('Expected raw:', expectedRaw);
      console.log('Amount received (nano):', inMsg.value.toString());
      console.log('Amount expected (nano):', expectedAmountNano.toString());

      if (destRaw === expectedRaw && inMsg.value.toString() === expectedAmountNano.toString()) {
        return { success: true, txHash };
      } else {
        console.error('Mismatch in address or amount');
        return { success: false, error: 'Mismatch in address or amount' };
      }
    }

    console.error('Transaction not found after polling');
    return { success: false, error: 'Transaction not found after polling' };
  } catch (e) {
    console.error('Payment verification exception:', e);
    return { success: false, error: e.message };
  }
}

module.exports = { verifyPayment };
