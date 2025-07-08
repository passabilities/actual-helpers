const api = require('@actual-app/api');
const { chromium } = require('playwright');  // Or 'firefox' or 'webkit'.
const { formatEther, formatGwei, fromHex } = require('viem');
const { closeBudget, getAccountNote, setAccountNote, updateAccountBalance, openBudget, escapeRegExp } = require('./utils')
const { fetchCryptoValue } = require('./utils/fetchCryptoPrice')
require("dotenv").config();

module.exports = async () => {
  await openBudget()

  await wrapFunctions([
    checkValidators,
    checkEth,
    checkDebank,
  ])

  await closeBudget();
}

/**
 * @param {Array<(account: any, note: string, newNote: string[]) => Promise<{matched: boolean, regex: RegExp}>>} fns
 */
async function wrapFunctions(fns) {
  const startComment = `[comment]: <> (== START HELPER ==)`;
  const endComment = `[comment]: <> (== END HELPER ==)`;

  const accounts = await api.getAccounts();
  for (const account of accounts) {
    if (!account.closed && account.name.startsWith('Crypto - ')) {
      /** @type {string} */
      const note = await getAccountNote(account);
      if (!note) continue;

      for (const fn of fns) {
        const newNote = [];
        newNote.push('');
        newNote.push(startComment);
        newNote.push('');

        try {
          const { matched, regex } = await fn(account, note, newNote);
          if (matched) {
            newNote.push('');
            newNote.push(endComment);
            newNote.push('');

            const beforeNotes = note.match(new RegExp(`([\\s\\S]*)\\n\\n(?=${escapeRegExp(startComment)})`))?.[1];
            const afterNotes = note.match(new RegExp(`(?<=${escapeRegExp(endComment)})\\n\\n?([\\s\\S]*)`))?.[1];
            if (beforeNotes) {
              newNote.splice(0, 0, beforeNotes);
            }
            if (afterNotes) {
              newNote.push(afterNotes);
            }
            if (!beforeNotes && !afterNotes) {
              const negatedNote = note.replace(new RegExp(`\\n?\\n?${regex.source}\\n?\\n?`, regex.flags), '');
              newNote.splice(0, 0, negatedNote);
            }

            await setAccountNote(account, newNote.join('\n'));
            break;
          }
        } catch (error) {
          console.error(error.message);
        }
      }
    }
  }
}

/**
 * @param {any} account
 * @param {string} note
 * @param {string[]} newNote
 * @returns {Promise<{matched: boolean, regex: RegExp}>}
 */
async function checkValidators(account, note, newNote) {
  const regex = /validator:(\d+):(1|0?\.\d+)/g;
  const validatorsMatch = note.match(regex);
  if (validatorsMatch) {
    const validators = [];
    const percents = [];
    for (const validatorStr of validatorsMatch) {
      const [_, index, percent] = validatorStr.match(/validator:(\d+):(1|0?\.\d+)/);
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

    newNote.push(`[comment]: <> (Only edit the comments below!)`);
    for (const i in validators) {
      const index = validators[i];
      const percent = percents[i];
      newNote.push(`[comment]: <> (validator:${index}:${percent})`);
    }
    newNote.push('');
    newNote.push('| Validator | Balance |')
    newNote.push('|-|-:|');
    let total = 0n;
    for (const i in validators) {
      const index = validators[i];
      const balance = balances[i] * BigInt(percents[i] * 1_000_000) / 1_000_000n;
      total += balance;
      newNote.push(`| ${index} | ${formatGwei(balance)} |`);
    }
    const totalFormatted = formatGwei(total);

    newNote.push('');
    newNote.push(`ETH Balance: ${totalFormatted}`);

    const value = await fetchCryptoValue(totalFormatted, 'ETH');
    await updateAccountBalance(account, value)
  }

  return { matched: !!validatorsMatch, regex };
}

/**
 * @param {any} account
 * @param {string} note
 * @param {string[]} newNote
 * @returns {Promise<{matched: boolean, regex: RegExp}>}
 */
async function checkEth(account, note, newNote) {
  const regex = /eth:(0x[a-fA-F0-9]{40})/;
  const ethMatch = note.match(regex);
  if (ethMatch) {
    const addr = ethMatch[1];

    const balanceResponse = await fetch(process.env.EXECUTION_HOST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [addr, 'latest'],
        id: 1
      }),
    });
    const json = await balanceResponse.json();
    const balance = formatEther(fromHex(json.result, 'bigint'));

    newNote.push(`eth:${addr}`);
    newNote.push(`ETH Balance: ${balance}`);

    const value = await fetchCryptoValue(balance, 'ETH');
    await updateAccountBalance(account, value)
  }

  return { matched: !!ethMatch, regex };
}

/**
 * @param {any} account
 * @param {string} note
 * @param {string[]} newNote
 * @returns {Promise<{matched: boolean, regex: RegExp}>}
 */
async function checkDebank(account, note, newNote) {
  const regex = /debank:(0x[a-fA-F0-9]{40})/;
  const debankMatch = note.match(regex);
  if (debankMatch) {
    const addr = debankMatch[1];
    newNote.push(`debank:${addr}`);

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`https://debank.com/profile/${addr}`);
    await page.locator('.UpdateButton_refresh__vkj2W').and(page.getByText('Data updated')).waitFor();
    const elementText = await page.locator('.HeaderInfo_totalAssetInner__HyrdC').innerText();
    await browser.close();

    const balanceMatch = elementText.match(/^\$([0-9,]+)\n/);
    if (!balanceMatch) {
      throw new Error(`Could not find balance on page for ${addr}`);
    }

    const debankBalance = parseFloat(balanceMatch[1].replace(/,/g, ''));
    await updateAccountBalance(account, debankBalance)
  }

  return { matched: !!debankMatch, regex };
}

module.exports()
