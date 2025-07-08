const api = require('@actual-app/api');
const { chromium } = require('playwright');  // Or 'firefox' or 'webkit'.
const { formatEther, formatGwei, fromHex } = require('viem');
const { closeBudget, ensureCategory, ensureCategoryGroup, ensurePayee, getAccountBalance, getAccountNote, setAccountNote, getTransactions, getLastTransaction, openBudget } = require('./utils')
require("dotenv").config();

module.exports = async () => {
  await openBudget();

  const payeeId = await ensurePayee(process.env.INVESTMENT_PAYEE_NAME || 'Investment');
  const categoryGroupId = await ensureCategoryGroup(process.env.INVESTMENT_CATEGORY_GROUP_NAME || 'Income');
  const categoryId = await ensureCategory(process.env.INVESTMENT_CATEGORY_NAME || 'Investment', categoryGroupId, true);

  const accounts = await api.getAccounts();
  for (const account of accounts) {
    if (account.closed || !account.name.startsWith('Crypto - ')) {
      continue;
    }

    const note = await getAccountNote(account);
    if (!note) continue;

    const currentBalance = await getAccountBalance(account);

    const validatorsMatch = note.match(/validator:(\d+):(1|0?\.\d+)/g);
    if (validatorsMatch) {
      const validatorStartComment = `[comment]: <> (== START VALIDATORS ==)`;
      const validatorEndComment = `[comment]: <> (== END VALIDATORS ==)`;

      const validators = [];
      const percents = [];
      for (const validatorStr of validatorsMatch) {
        const [_, index, percent]  = validatorStr.match(/validator:(\d+):(1|0?\.\d+)/);
        validators.push(index);
        percents.push(percent);
      }
      const balanceResponse = await fetch(`${process.env.CONSENSUS_HOST}/eth/v1/beacon/states/finalized/validator_balances?id=${validators.join(',')}`)
      const json = await balanceResponse.json();

      const balances = [];
      for (const index of validators) {
        const balance = BigInt(json.data.find(v => v.index === index).balance);
        balances.push(balance);
      }

      const newNote = [];
      newNote.push(validatorStartComment);
      newNote.push(`[comment]: <> (Only edit the comments below!)`);
      for (const i in validators) {
        const index = validators[i];
        const percent = percents[i];
        newNote.push(`[comment]: <> (validator:${index}:${percent})`);
      }
      newNote.push('');
      newNote.push('| Validator | Balance | Value |')
      newNote.push('|-|-:|-:|');
      let total = 0n;
      for (const i in validators) {
        const index = validators[i];
        const balance = balances[i] * BigInt(percents[i] * 1_000_000) / 1_000_000n;
        total += balance;
        const value = 0;
        newNote.push(`| ${index} | ${formatGwei(balance)} | $${value} |`);
      }
      newNote.push('');
      newNote.push(`ETH:${formatGwei(total)}`);
      newNote.push('');
      newNote.push(validatorEndComment);

      const existingNotesMatch = note.match(new RegExp(`(.+)${validatorStartComment}(.+)`));
      if (existingNotesMatch) {
        newNote.splice(0, 0, existingNotesMatch[1]);
        newNote.push(existingNotesMatch[2]);
      }

      await setAccountNote(account, newNote.join('\n'));
    }

    const ethMatch = note.match(/eth:(0x[a-fA-F0-9]{40})/);
    if (ethMatch) {
      const addr = ethMatch[1];
      const balanceResponse = await fetch(process.env.EXECUTION_HOST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [addr, 'latest'],
          id:1
        }),
      });
      const json = await balanceResponse.json();
      const balance = fromHex(json.result, 'bigint');
      let newNote = `eth:${addr}\n`;
      newNote += `ETH:${formatEther(balance)}`;
      await setAccountNote(account, newNote);
    }

    const debankMatch = note.match(/debank:(0x[a-fA-F0-9]{40})/);
    if (debankMatch) {
      const addr = debankMatch[1];

      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(`https://debank.com/profile/${addr}`);

      await page.locator('.UpdateButton_refresh__vkj2W').and(page.getByText('Data updated')).waitFor();

      const elementText = await page.locator('.HeaderInfo_totalAssetInner__HyrdC').innerText();
      const balanceMatch = elementText.match(/^\$([0-9,]+)\n/);
      if (!balanceMatch) {
        console.log(`Could not find balance on page for ${addr}`);
        continue;
      }
      const debankBalance = parseFloat(balanceMatch[1].replace(/,/g, '')) * 100;
      await browser.close();

      const diff = debankBalance - currentBalance;

      if (diff) {
        const lastTx = await getLastTransaction(account, undefined,true, { $like: 'Update balance to %' })
        const shouldUpdateTx = lastTx && new RegExp(`^${lastTx.date}T`).test(new Date().toISOString())

        const newNote = `Update balance to ${debankBalance / 100}`

        if (shouldUpdateTx) {
          await api.updateTransaction(lastTx.id, {
            amount: +lastTx.amount + diff,
            notes: newNote,
          })
        } else {
          await api.importTransactions(account.id, [{
            date: new Date(),
            payee: payeeId,
            amount: diff,
            cleared: true,
            reconciled: true,
            category: categoryId,
            notes: newNote,
          }]);
        }
      }
    }
  }
}

module.exports()
